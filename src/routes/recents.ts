import { Router, Response } from "express";
import { pool } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";

console.debug("[PasusDebug:backend/src/routes/recents] Loaded");

export const router = Router();

export const handleRecents = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    // --- Direct messages (DM conversations) ---
    const [dmRows] = await pool.query(
      `
      SELECT c.id as conversationId,
             COALESCE(MAX(m.createdAt), c.updatedAt) as lastMessageAt,
             other.userId as friendId,
             SUM(CASE WHEN m.senderId != ? THEN 1 ELSE 0 END) as unreadCount
      FROM conversations c
      JOIN conversation_participants me ON me.conversationId = c.id AND me.userId = ?
      JOIN conversation_participants other ON other.conversationId = c.id AND other.userId != me.userId
      LEFT JOIN messages m ON m.conversationId = c.id
      WHERE c.type = 'DM'
      GROUP BY c.id, friendId
      ORDER BY lastMessageAt DESC
      LIMIT 20
      `,
      [userId, userId]
    );

    // --- Group recents (only small groups) ---
    const [groupRows] = await pool.query(
      `
      SELECT s.id as groupId,
             s.name,
             COALESCE(MAX(cm.createdAt), s.updatedAt) as lastMessageAt,
             COUNT(cm.id) as messageCount
      FROM servers s
      JOIN server_memberships sm ON sm.serverId = s.id AND sm.userId = ?
      LEFT JOIN channels c ON c.serverId = s.id
      LEFT JOIN channel_messages cm ON cm.channelId = c.id
      WHERE s.type = 'GROUP'
      GROUP BY s.id
      ORDER BY lastMessageAt DESC
      LIMIT 20
      `,
      [userId]
    );

    const dms = (dmRows as any[]).map((r) => ({
      type: "DM",
      friendId: r.friendId,
      lastMessageAt: r.lastMessageAt,
      unreadCount: Number(r.unreadCount) || 0,
    }));

    const groups = (groupRows as any[]).map((r) => ({
      type: "GROUP",
      groupId: r.groupId,
      lastMessageAt: r.lastMessageAt,
      unreadCount: 0,
    }));

    res.json({ success: true, data: [...dms, ...groups].sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()) });
  } catch (err: any) {
    console.error('[recents] failed', err);
    // Normalize transient DB issues to a friendly response so UI doesn’t crash
    if (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST') {
      return res.status(503).json({ success: false, message: "Database temporarily unavailable" });
    }
    res.status(500).json({ success: false, message: "Failed to load recents" });
  }
};

router.get("/", requireAuth, handleRecents);

export default router;
