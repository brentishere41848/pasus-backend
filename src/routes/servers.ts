import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";

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
