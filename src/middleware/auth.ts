import { NextFunction, Request, Response } from 'express';
import { pool } from '../db.js';
import { getReasonText, ModerationStage } from '../shared/moderation.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string; username?: string; email?: string };
      moderation?: { stage: ModerationStage; currentStage?: ModerationStage; lastAction?: any };
    }
  }
}

const ADMIN_ROLES = ['ADMIN', 'OWNER', 'SUPERADMIN'];

async function fetchModerationState(userId: string) {
  const [statusRows] = await pool.query(
    'SELECT currentStage, updatedAt FROM moderation_statuses WHERE userId=?',
    [userId]
  );
  const stage = (statusRows as any[])[0]?.currentStage || 'NONE';

  const [actionRows] = await pool.query(
    'SELECT id, stage, reasonCode, reasonText, notes, createdAt, moderatorId FROM moderation_actions WHERE userId=? ORDER BY createdAt DESC LIMIT 1',
    [userId]
  );
  const lastAction = (actionRows as any[])[0];
  return { stage: stage as ModerationStage, currentStage: stage as ModerationStage, lastAction };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = (req.header('x-user-id') || (req.body as any)?.currentUserId || (req.body as any)?.userId) as
    | string
    | undefined;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const [rows] = await pool.query('SELECT id, email, username, role FROM users WHERE id=?', [userId]);
    if (!(rows as any[]).length) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = (rows as any[])[0];
    const moderation = await fetchModerationState(userId);
    req.moderation = moderation;

    next();
  } catch (err) {
    console.error('Auth middleware error', err);
    return res.status(500).json({ success: false, message: 'Auth lookup failed' });
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, async () => {
    if (!req.user || !ADMIN_ROLES.includes((req.user.role || '').toUpperCase())) {
      return res.status(403).json({ success: false, message: 'Admin privileges required' });
    }
    return next();
  });
}

export async function blockTerminated(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    const stage = req.moderation?.stage || 'NONE';
    if (stage === 'TERMINATED') {
      const reasonText = req.moderation?.lastAction?.reasonText || getReasonText(req.moderation?.lastAction?.reasonCode || 'OTHER');
      return res.status(403).json({
        success: false,
        message: 'Account terminated',
        data: {
          stage,
          reasonText,
          notes: req.moderation?.lastAction?.notes,
          actionId: req.moderation?.lastAction?.id,
          createdAt: req.moderation?.lastAction?.createdAt,
        },
      });
    }
    return next();
  });
}

export { fetchModerationState };
