import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id as serverId, s.name, s.iconUrl as icon, s.ownerId,
             c.id as channelId, c.name as channelName, c.type
      FROM servers s
      LEFT JOIN channels c ON c.serverId = s.id
    `);
    const map: Record<string, any> = {};
    (rows as any[]).forEach(r => {
      if (!map[r.serverId]) {
        map[r.serverId] = { id: r.serverId, name: r.name, icon: r.icon, ownerId: r.ownerId, channels: [] };
      }
      if (r.channelId) {
        map[r.serverId].channels.push({ id: r.channelId, name: r.channelName, type: (r.type || 'text').toLowerCase() });
      }
    });
    res.json({ success: true, data: Object.values(map) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

router.post("/", (req, res) => {
  const { name, icon, ownerId } = req.body as {
    name?: string;
    icon?: string;
    ownerId?: string;
  };

  if (!name || !ownerId) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const serverId = uuid();
  const generalId = uuid();
  const loungeId = uuid();

  pool.getConnection().then(async (conn) => {
    try {
      await conn.beginTransaction();
      await conn.query('INSERT INTO servers (id,name,iconUrl,ownerId,createdAt,updatedAt) VALUES (?,?,?,?,NOW(),NOW())', [
        serverId, name, icon || "https://picsum.photos/seed/server/200", ownerId
      ]);
      await conn.query('INSERT INTO channels (id,serverId,name,type,createdById,createdAt,updatedAt) VALUES (?,?,?,?,?,NOW(),NOW())', [
        generalId, serverId, 'general', 'TEXT', ownerId
      ]);
      await conn.query('INSERT INTO channels (id,serverId,name,type,createdById,createdAt,updatedAt) VALUES (?,?,?,?,?,NOW(),NOW())', [
        loungeId, serverId, 'Lounge', 'VOICE', ownerId
      ]);
      await conn.commit();
      return res.json({ success: true, data: {
        id: serverId,
        name,
        icon: icon || "https://picsum.photos/seed/server/200",
        ownerId,
        channels: [
          { id: generalId, name: 'general', type: 'text' },
          { id: loungeId, name: 'Lounge', type: 'voice' }
        ]
      }});
    } catch (err) {
      await conn.rollback();
      console.error(err);
      return res.status(500).json({ success: false, message: "Database error" });
    } finally {
      conn.release();
    }
  }).catch((err) => {
    console.error(err);
    return res.status(500).json({ success: false, message: "Database error" });
  });
});

export default router;

// Analytics endpoint
router.get("/:serverId/analytics", requireAuth, async (req, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  try {
    const [serverRows] = await pool.query('SELECT ownerId FROM servers WHERE id=?', [serverId]);
    if (!(serverRows as any[]).length) return res.status(404).json({ success: false, message: 'Server not found' });
    const server = (serverRows as any[])[0];
    const [membershipRows] = await pool.query('SELECT role FROM server_memberships WHERE serverId=? AND userId=?', [serverId, userId]);
    const role = (membershipRows as any[])[0]?.role || '';
    const isAdmin = server.ownerId === userId || role.toLowerCase() === 'admin' || role.toLowerCase() === 'owner';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });

    const [memberCountRows] = await pool.query('SELECT COUNT(*) as count FROM server_memberships WHERE serverId=?', [serverId]);
    const totalMembers = (memberCountRows as any[])[0]?.count || 0;

    const [channelCountRows] = await pool.query('SELECT COUNT(*) as count FROM channels WHERE serverId=?', [serverId]);
    const totalChannels = (channelCountRows as any[])[0]?.count || 0;

    const [messageCountRows] = await pool.query(
      'SELECT COUNT(*) as count FROM channel_messages cm INNER JOIN channels c ON cm.channelId=c.id WHERE c.serverId=?',
      [serverId]
    );
    const totalMessages = (messageCountRows as any[])[0]?.count || 0;

    const [activeRows] = await pool.query(
      `SELECT COUNT(DISTINCT cm.senderId) as count
       FROM channel_messages cm
       INNER JOIN channels c ON cm.channelId=c.id
       WHERE c.serverId=? AND cm.createdAt >= (NOW() - INTERVAL 1 DAY)`,
      [serverId]
    );
    const activeLast24h = (activeRows as any[])[0]?.count || 0;

    const [topChannels] = await pool.query(
      `SELECT c.id, c.name, COUNT(cm.id) as messages
       FROM channels c
       LEFT JOIN channel_messages cm ON cm.channelId = c.id
       WHERE c.serverId=?
       GROUP BY c.id, c.name
       ORDER BY messages DESC
       LIMIT 5`,
      [serverId]
    );

    res.json({
      success: true,
      data: {
        totalMembers,
        totalChannels,
        totalMessages,
        activeLast24h,
        topChannels,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Analytics query failed' });
  }
});

// Roles listing
router.get("/:serverId/roles", requireAuth, async (req, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  try {
    const [serverRows] = await pool.query('SELECT ownerId FROM servers WHERE id=?', [serverId]);
    if (!(serverRows as any[]).length) return res.status(404).json({ success: false, message: 'Server not found' });
    const server = (serverRows as any[])[0];
    const [membershipRows] = await pool.query('SELECT role FROM server_memberships WHERE serverId=? AND userId=?', [serverId, userId]);
    const role = (membershipRows as any[])[0]?.role || '';
    const isAdmin = server.ownerId === userId || role.toLowerCase() === 'admin' || role.toLowerCase() === 'owner';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });

    const [roles] = await pool.query('SELECT id, name, description, permissions, isDefault, createdAt, updatedAt FROM server_roles WHERE serverId=? ORDER BY name ASC', [serverId]);
    res.json({ success: true, data: roles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load roles' });
  }
});

// Role members
router.get("/:serverId/roles/members", requireAuth, async (req, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  try {
    const [serverRows] = await pool.query('SELECT ownerId FROM servers WHERE id=?', [serverId]);
    if (!(serverRows as any[]).length) return res.status(404).json({ success: false, message: 'Server not found' });
    const server = (serverRows as any[])[0];
    const [membershipRows] = await pool.query('SELECT role FROM server_memberships WHERE serverId=? AND userId=?', [serverId, userId]);
    const role = (membershipRows as any[])[0]?.role || '';
    const isAdmin = server.ownerId === userId || role.toLowerCase() === 'admin' || role.toLowerCase() === 'owner';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });

    const [rows] = await pool.query(
      `SELECT sr.id as roleId, sr.name as roleName, u.id as userId, u.username, u.avatarUrl
       FROM server_membership_roles smr
       INNER JOIN server_roles sr ON smr.roleId = sr.id
       INNER JOIN server_memberships sm ON sm.id = smr.membershipId
       INNER JOIN users u ON u.id = sm.userId
       WHERE sr.serverId = ?
       ORDER BY sr.name ASC, u.username ASC`,
      [serverId]
    );

    const map: Record<string, any> = {};
    (rows as any[]).forEach(r => {
      if (!map[r.roleId]) map[r.roleId] = { roleId: r.roleId, roleName: r.roleName, members: [] };
      map[r.roleId].members.push({ userId: r.userId, username: r.username, avatarUrl: r.avatarUrl });
    });
    res.json({ success: true, data: Object.values(map) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load role members' });
  }
});

// Permission definitions (simple labels)
router.get('/roles/permissions/definition', (_req, res) => {
  const defs = [
    { key: 'ADMIN', label: 'Server admin' },
    { key: 'MANAGE_CHANNELS', label: 'Manage channels' },
    { key: 'MANAGE_ROLES', label: 'Manage roles' },
    { key: 'KICK_MEMBERS', label: 'Kick members' },
    { key: 'BAN_MEMBERS', label: 'Ban members' },
    { key: 'MANAGE_MESSAGES', label: 'Manage messages' },
    { key: 'VIEW_AUDIT', label: 'View audit log' },
  ];
  res.json({ success: true, data: defs });
});

// Invites
router.get('/:serverId/invites', requireAuth, async (req, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  try {
    const [serverRows] = await pool.query('SELECT ownerId FROM servers WHERE id=?', [serverId]);
    if (!(serverRows as any[]).length) return res.status(404).json({ success: false, message: 'Server not found' });
    const server = (serverRows as any[])[0];
    const [membershipRows] = await pool.query('SELECT role FROM server_memberships WHERE serverId=? AND userId=?', [serverId, userId]);
    const role = (membershipRows as any[])[0]?.role || '';
    const isAdmin = server.ownerId === userId || role.toLowerCase() === 'admin' || role.toLowerCase() === 'owner';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });
    const [invites] = await pool.query('SELECT * FROM server_invites WHERE serverId=? ORDER BY createdAt DESC', [serverId]);
    res.json({ success: true, data: invites });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to list invites' });
  }
});

router.post('/:serverId/invites', requireAuth, async (req, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  const { maxUses, expiresAt } = req.body as { maxUses?: number; expiresAt?: string };
  try {
    const [serverRows] = await pool.query('SELECT ownerId FROM servers WHERE id=?', [serverId]);
    if (!(serverRows as any[]).length) return res.status(404).json({ success: false, message: 'Server not found' });
    const server = (serverRows as any[])[0];
    const [membershipRows] = await pool.query('SELECT role FROM server_memberships WHERE serverId=? AND userId=?', [serverId, userId]);
    const role = (membershipRows as any[])[0]?.role || '';
    const isAdmin = server.ownerId === userId || role.toLowerCase() === 'admin' || role.toLowerCase() === 'owner';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });

    const id = uuidv4();
    const code = uuidv4().slice(0, 8);
    await pool.query(
      'INSERT INTO server_invites (id, code, serverId, createdById, maxUses, uses, expiresAt, createdAt) VALUES (?,?,?,?,?,?,?,NOW())',
      [id, code, serverId, userId, maxUses || null, 0, expiresAt ? new Date(expiresAt) : null]
    );
    res.json({ success: true, data: { id, code, serverId, createdById: userId, maxUses: maxUses || null, uses: 0, expiresAt: expiresAt || null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create invite' });
  }
});

router.delete('/:serverId/invites/:inviteId', requireAuth, async (req, res) => {
  const { serverId, inviteId } = req.params;
  const userId = req.user!.id;
  try {
    const [serverRows] = await pool.query('SELECT ownerId FROM servers WHERE id=?', [serverId]);
    if (!(serverRows as any[]).length) return res.status(404).json({ success: false, message: 'Server not found' });
    const server = (serverRows as any[])[0];
    const [membershipRows] = await pool.query('SELECT role FROM server_memberships WHERE serverId=? AND userId=?', [serverId, userId]);
    const role = (membershipRows as any[])[0]?.role || '';
    const isAdmin = server.ownerId === userId || role.toLowerCase() === 'admin' || role.toLowerCase() === 'owner';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });
    await pool.query('DELETE FROM server_invites WHERE id=? AND serverId=?', [inviteId, serverId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to delete invite' });
  }
});

router.post('/invites/:code/use', requireAuth, async (req, res) => {
  const { code } = req.params;
  const userId = req.user!.id;
  try {
    const [rows] = await pool.query('SELECT * FROM server_invites WHERE code=?', [code]);
    const invite = (rows as any[])[0];
    if (!invite) return res.status(404).json({ success: false, message: 'Invite invalid' });
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) return res.status(400).json({ success: false, message: 'Invite expired' });
    if (invite.maxUses && invite.uses >= invite.maxUses) return res.status(400).json({ success: false, message: 'Invite max uses reached' });

    // add membership if not exists
    await pool.query(
      'INSERT INTO server_memberships (id, serverId, userId, role, createdAt) VALUES (UUID(), ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE serverId=serverId',
      [invite.serverId, userId, 'member']
    );
    await pool.query('UPDATE server_invites SET uses = uses + 1 WHERE id=?', [invite.id]);

    // welcome message if configured
    const [serverRows] = await pool.query('SELECT name, welcomeChannelId, welcomeMessageTemplate FROM servers WHERE id=?', [invite.serverId]);
    const server = (serverRows as any[])[0];
    if (server?.welcomeChannelId && server?.welcomeMessageTemplate) {
      const msg = server.welcomeMessageTemplate
        .replace('{user}', userId)
        .replace('{server}', server.name || '');
      await pool.query(
        'INSERT INTO channel_messages (id, channelId, senderId, body, createdAt) VALUES (UUID(), ?, ?, ?, NOW())',
        [server.welcomeChannelId, 'system', msg]
      );
    }

    res.json({ success: true, data: { serverId: invite.serverId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Invite use failed' });
  }
});

// Templates
router.post('/:serverId/templates', requireAuth, async (req, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name) return res.status(400).json({ success: false, message: 'Name required' });
  try {
    const [serverRows] = await pool.query('SELECT ownerId, name FROM servers WHERE id=?', [serverId]);
    if (!(serverRows as any[]).length) return res.status(404).json({ success: false, message: 'Server not found' });
    const server = (serverRows as any[])[0];
    const [membershipRows] = await pool.query('SELECT role FROM server_memberships WHERE serverId=? AND userId=?', [serverId, userId]);
    const role = (membershipRows as any[])[0]?.role || '';
    const isAdmin = server.ownerId === userId || role.toLowerCase() === 'admin' || role.toLowerCase() === 'owner';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });

    const [channels] = await pool.query('SELECT id, name, type, category FROM channels WHERE serverId=?', [serverId]);
    const [roles] = await pool.query('SELECT id, name, description, permissions, isDefault FROM server_roles WHERE serverId=?', [serverId]);
    const [serverSettings] = await pool.query('SELECT welcomeChannelId, welcomeMessageTemplate FROM servers WHERE id=?', [serverId]);
    const serverSettingsRow = (serverSettings as any[])[0] || {};

    const templateData = {
      serverName: server.name,
      channels,
      roles,
      onboarding: serverSettingsRow,
    };

    const id = uuidv4();
    await pool.query(
      'INSERT INTO server_templates (id, ownerUserId, name, description, data, createdAt, updatedAt) VALUES (?,?,?,?,?,NOW(),NOW())',
      [id, userId, name, description || null, JSON.stringify(templateData)]
    );
    res.json({ success: true, data: { id, name, description, createdAt: new Date().toISOString() } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create template' });
  }
});

router.get('/templates', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  try {
    const [rows] = await pool.query('SELECT id, name, description, createdAt, updatedAt FROM server_templates WHERE ownerUserId=? ORDER BY createdAt DESC', [userId]);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to list templates' });
  }
});

router.get('/templates/:templateId', requireAuth, async (req, res) => {
  const { templateId } = req.params;
  const userId = req.user!.id;
  try {
    const [rows] = await pool.query('SELECT id, name, description, data, createdAt FROM server_templates WHERE id=? AND ownerUserId=?', [templateId, userId]);
    if (!(rows as any[]).length) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, data: (rows as any[])[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch template' });
  }
});

router.post('/templates/:templateId/apply', requireAuth, async (req, res) => {
  const { templateId } = req.params;
  const userId = req.user!.id;
  const { serverName } = req.body as { serverName?: string };
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query('SELECT * FROM server_templates WHERE id=? AND ownerUserId=?', [templateId, userId]);
    if (!(rows as any[]).length) {
      connection.release();
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    const template = (rows as any[])[0];
    const data = JSON.parse(template.data || '{}');
    const newServerId = uuidv4();
    const newName = serverName || `${data.serverName || template.name} copy`;

    await connection.beginTransaction();
    await connection.query('INSERT INTO servers (id, name, ownerId, createdAt, updatedAt, welcomeChannelId, welcomeMessageTemplate) VALUES (?,?,?,?,NOW(),NOW(),?,?)', [newServerId, newName, userId, null, data.onboarding?.welcomeChannelId || null, data.onboarding?.welcomeMessageTemplate || null]);
    // create membership for owner
    await connection.query('INSERT INTO server_memberships (id, serverId, userId, role, createdAt) VALUES (UUID(), ?, ?, ?, NOW())', [newServerId, userId, 'owner']);

    // roles
    const roleIdMap: Record<string, string> = {};
    for (const r of data.roles || []) {
      const rid = uuidv4();
      roleIdMap[r.id] = rid;
      await connection.query('INSERT INTO server_roles (id, serverId, name, description, permissions, isDefault, createdAt, updatedAt) VALUES (?,?,?,?,?,?,NOW(),NOW())', [rid, newServerId, r.name, r.description || null, r.permissions || '{}', r.isDefault || false]);
    }
    // assign owner role if exists
    if (Object.values(roleIdMap).length) {
      const ownerRoleId = Object.values(roleIdMap)[0];
      const [membershipRow] = await connection.query('SELECT id FROM server_memberships WHERE serverId=? AND userId=?', [newServerId, userId]);
      const membershipId = (membershipRow as any[])[0]?.id;
      if (membershipId) {
        await connection.query('INSERT INTO server_membership_roles (id, membershipId, roleId) VALUES (UUID(), ?, ?)', [membershipId, ownerRoleId]);
      }
    }

    // channels
    for (const c of data.channels || []) {
      const cid = uuidv4();
      await connection.query('INSERT INTO channels (id, serverId, name, type, createdById, createdAt, updatedAt) VALUES (?,?,?,?,?,NOW(),NOW())', [cid, newServerId, c.name, c.type || 'TEXT', userId]);
    }

    await connection.commit();
    res.json({ success: true, data: { id: newServerId, name: newName } });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to apply template' });
  } finally {
    connection.release();
  }
});

// Onboarding settings
router.get('/:serverId/onboarding', requireAuth, async (req, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  try {
    const [serverRows] = await pool.query('SELECT ownerId, welcomeChannelId, welcomeMessageTemplate FROM servers WHERE id=?', [serverId]);
    if (!(serverRows as any[]).length) return res.status(404).json({ success: false, message: 'Server not found' });
    const server = (serverRows as any[])[0];
    const [membershipRows] = await pool.query('SELECT role FROM server_memberships WHERE serverId=? AND userId=?', [serverId, userId]);
    const role = (membershipRows as any[])[0]?.role || '';
    const isAdmin = server.ownerId === userId || role.toLowerCase() === 'admin' || role.toLowerCase() === 'owner';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });
    res.json({ success: true, data: { welcomeChannelId: server.welcomeChannelId, welcomeMessageTemplate: server.welcomeMessageTemplate } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to load onboarding' });
  }
});

router.post('/:serverId/onboarding', requireAuth, async (req, res) => {
  const { serverId } = req.params;
  const userId = req.user!.id;
  const { welcomeChannelId, welcomeMessageTemplate } = req.body as { welcomeChannelId?: string; welcomeMessageTemplate?: string };
  try {
    const [serverRows] = await pool.query('SELECT ownerId FROM servers WHERE id=?', [serverId]);
    if (!(serverRows as any[]).length) return res.status(404).json({ success: false, message: 'Server not found' });
    const server = (serverRows as any[])[0];
    const [membershipRows] = await pool.query('SELECT role FROM server_memberships WHERE serverId=? AND userId=?', [serverId, userId]);
    const role = (membershipRows as any[])[0]?.role || '';
    const isAdmin = server.ownerId === userId || role.toLowerCase() === 'admin' || role.toLowerCase() === 'owner';
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });

    await pool.query('UPDATE servers SET welcomeChannelId=?, welcomeMessageTemplate=? WHERE id=?', [welcomeChannelId || null, welcomeMessageTemplate || null, serverId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to save onboarding' });
  }
});
