import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { pool } from '../db.js';
import {
  getReasonText,
  MODERATION_REASONS,
  MODERATION_STAGES,
  ModerationStage,
} from '../shared/moderation.js';
import { requireAdmin, requireAuth, fetchModerationState } from '../middleware/auth.js';

const router = Router();

const stageOrder: Record<ModerationStage, number> = {
  NONE: 0,
  WARNING_1: 1,
  WARNING_2: 2,
  WARNING_3: 3,
  WARNING_4: 4,
  TERMINATED: 5,
};

function nextWarningStage(current: ModerationStage): ModerationStage | null {
  switch (current) {
    case 'NONE':
      return 'WARNING_1';
    case 'WARNING_1':
      return 'WARNING_2';
    case 'WARNING_2':
      return 'WARNING_3';
    case 'WARNING_3':
      return 'WARNING_4';
    case 'WARNING_4':
    case 'TERMINATED':
      return null;
    default:
      return 'WARNING_1';
  }
}

function isValidReason(code?: string) {
  return !!code && MODERATION_REASONS.some((r) => r.code === code);
}

async function ensureStatus(userId: string): Promise<ModerationStage> {
  const [rows] = await pool.query('SELECT currentStage FROM moderation_statuses WHERE userId=?', [userId]);
  if ((rows as any[]).length) {
    return (rows as any[])[0].currentStage as ModerationStage;
  }
  await pool.query('INSERT INTO moderation_statuses (userId,currentStage,updatedAt) VALUES (?,?,NOW())', [
    userId,
    'NONE',
  ]);
  return 'NONE';
}

async function getActionsForUser(userId: string) {
  const [actions] = await pool.query(
    'SELECT id, stage, reasonCode, reasonText, notes, createdAt, moderatorId FROM moderation_actions WHERE userId=? ORDER BY createdAt DESC',
    [userId]
  );
  return actions as any[];
}

async function upsertStatus(userId: string, stage: ModerationStage) {
  await pool.query(
    `INSERT INTO moderation_statuses (userId,currentStage,updatedAt)
     VALUES (?,?,NOW())
     ON DUPLICATE KEY UPDATE currentStage=VALUES(currentStage), updatedAt=NOW()`
      .replace(/\s+/g, ' '),
    [userId, stage]
  );
}

async function createAction(
  userId: string,
  moderatorId: string,
  stage: ModerationStage,
  reasonCode: string,
  notes?: string
) {
  const id = uuid();
  const reasonText = getReasonText(reasonCode);
  await pool.query(
    'INSERT INTO moderation_actions (id,userId,moderatorId,stage,reasonCode,reasonText,notes,createdAt) VALUES (?,?,?,?,?,?,?,NOW())',
    [id, userId, moderatorId, stage, reasonCode, reasonText, notes || null]
  );
  return { id, reasonText };
}

async function sendModerationNotification(
  userId: string,
  stage: ModerationStage,
  reasonCode: string,
  notes?: string
) {
  const id = uuid();
  const reasonText = getReasonText(reasonCode);
  const payload = { stage, reasonCode, reasonText, notes };
  await pool.query(
    'INSERT INTO notifications (id,userId,type,payload,createdAt) VALUES (?,?,?,?,NOW())',
    [id, userId, 'moderation', JSON.stringify(payload)]
  );
}

router.get('/reasons', (_req, res) => {
  res.json({ success: true, data: MODERATION_REASONS });
});

router.get('/users', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.email, u.role,
              COALESCE(ms.currentStage, 'NONE') as currentStage,
              (SELECT ma.stage FROM moderation_actions ma WHERE ma.userId=u.id ORDER BY ma.createdAt DESC LIMIT 1) as lastStage,
              (SELECT ma.reasonText FROM moderation_actions ma WHERE ma.userId=u.id ORDER BY ma.createdAt DESC LIMIT 1) as lastReasonText,
              (SELECT ma.createdAt FROM moderation_actions ma WHERE ma.userId=u.id ORDER BY ma.createdAt DESC LIMIT 1) as lastActionAt
       FROM users u
       LEFT JOIN moderation_statuses ms ON ms.userId=u.id
       ORDER BY currentStage DESC, lastActionAt DESC`);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to list moderation users' });
  }
});

router.get('/user/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const actorId = req.user!.id;
  const isSelf = actorId === userId;
  const isAdmin = ['ADMIN', 'OWNER', 'SUPERADMIN'].includes((req.user!.role || '').toUpperCase());
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  try {
    const [userRows] = await pool.query('SELECT id, username, email, role FROM users WHERE id=?', [userId]);
    if (!(userRows as any[]).length) return res.status(404).json({ success: false, message: 'User not found' });

    const { stage, lastAction } = await fetchModerationState(userId);
    const [actions] = await pool.query(
      'SELECT id, stage, reasonCode, reasonText, notes, createdAt, moderatorId FROM moderation_actions WHERE userId=? ORDER BY createdAt DESC',
      [userId]
    );

    return res.json({
      success: true,
      data: {
        user: (userRows as any[])[0],
        currentStage: stage,
        lastAction,
        actions,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch user moderation' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const { stage, lastAction } = await fetchModerationState(req.user!.id);
    const [actions] = await pool.query(
      'SELECT id, stage, reasonCode, reasonText, notes, createdAt, moderatorId FROM moderation_actions WHERE userId=? ORDER BY createdAt DESC',
      [req.user!.id]
    );
    res.json({ success: true, data: { currentStage: stage, lastAction, actions } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load status' });
  }
});

router.post('/user/:userId/warn', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { reasonCode, notes } = req.body as { reasonCode?: string; notes?: string };
  if (!isValidReason(reasonCode)) {
    return res.status(400).json({ success: false, message: 'Invalid reasonCode' });
  }

  try {
    const [userRows] = await pool.query('SELECT id, accountStatus FROM users WHERE id=?', [userId]);
    if (!(userRows as any[]).length) return res.status(404).json({ success: false, message: 'User not found' });

    const currentStage = await ensureStatus(userId);
    const nextStage = nextWarningStage(currentStage);
    if (!nextStage) {
      return res.status(400).json({ success: false, message: 'User already at max warnings or terminated' });
    }

    await createAction(userId, req.user!.id, nextStage, reasonCode!, notes);
    await upsertStatus(userId, nextStage);
    await pool.query('UPDATE users SET accountStatus=? WHERE id=?', [nextStage === 'NONE' ? 'good' : 'warned', userId]);
    await sendModerationNotification(userId, nextStage, reasonCode!, notes);

    const status = await fetchModerationState(userId);
    const actions = await getActionsForUser(userId);
    res.json({ success: true, data: { currentStage: status.stage, lastAction: status.lastAction, actions } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to issue warning' });
  }
});

router.post('/user/:userId/terminate', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  const { reasonCode, notes } = req.body as { reasonCode?: string; notes?: string };
  if (!isValidReason(reasonCode)) {
    return res.status(400).json({ success: false, message: 'Invalid reasonCode' });
  }

  try {
    const [userRows] = await pool.query('SELECT id FROM users WHERE id=?', [userId]);
    if (!(userRows as any[]).length) return res.status(404).json({ success: false, message: 'User not found' });

    await createAction(userId, req.user!.id, 'TERMINATED', reasonCode!, notes);
    await upsertStatus(userId, 'TERMINATED');
    await pool.query('UPDATE users SET accountStatus=? WHERE id=?', ['banned', userId]);
    await sendModerationNotification(userId, 'TERMINATED', reasonCode!, notes);

    const status = await fetchModerationState(userId);
    const actions = await getActionsForUser(userId);
    res.json({ success: true, data: { currentStage: status.stage, lastAction: status.lastAction, actions } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to terminate user' });
  }
});

router.post('/user/:userId/reset', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  try {
    await upsertStatus(userId, 'NONE');
    await pool.query('UPDATE users SET accountStatus=? WHERE id=?', ['good', userId]);
    await createAction(userId, req.user!.id, 'NONE', 'OTHER', 'Status reset by admin');
    const status = await fetchModerationState(userId);
    const actions = await getActionsForUser(userId);
    res.json({ success: true, data: { currentStage: status.stage, lastAction: status.lastAction, actions } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to reset status' });
  }
});

export const reportsRouter = Router();

reportsRouter.post('/', requireAuth, async (req, res) => {
  const { reportedUserId, reasonCode, description } = req.body as {
    reportedUserId?: string;
    reasonCode?: string;
    description?: string;
  };
  if (!reportedUserId || !isValidReason(reasonCode) || !description) {
    return res.status(400).json({ success: false, message: 'Missing or invalid fields' });
  }

  try {
    const id = uuid();
    await pool.query(
      'INSERT INTO user_reports (id,reporterId,reportedUserId,reasonCode,description,status,createdAt) VALUES (?,?,?,?,?,"NEW",NOW())',
      [id, req.user!.id, reportedUserId, reasonCode, description]
    );
    res.json({ success: true, data: { id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to submit report' });
  }
});

reportsRouter.get('/', requireAdmin, async (req, res) => {
  const { status } = req.query as { status?: string };
  const statusFilter = ['NEW', 'REVIEWED', 'DISMISSED'].includes((status || '').toUpperCase())
    ? (status as string).toUpperCase()
    : null;
  try {
    const [rows] = await pool.query(
      `SELECT r.*, u.username as reporterName, t.username as reportedName
       FROM user_reports r
       LEFT JOIN users u ON u.id = r.reporterId
       LEFT JOIN users t ON t.id = r.reportedUserId
       ${statusFilter ? 'WHERE r.status=?' : ''}
       ORDER BY r.createdAt DESC`,
      statusFilter ? [statusFilter] : []
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to list reports' });
  }
});

reportsRouter.post('/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body as { status?: string };
  const normalized = (status || '').toUpperCase();
  if (!['NEW', 'REVIEWED', 'DISMISSED'].includes(normalized)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  try {
    await pool.query('UPDATE user_reports SET status=? WHERE id=?', [normalized, id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update report status' });
  }
});

export default router;
