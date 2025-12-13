import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { recordDmMessageEvent } from "../services/messages.js";

console.debug("[PasusDebug:backend/src/routes/dm] Loaded");

const router = Router();

const findOrCreateConversation = async (userId: string, partnerId: string) => {
  const [rows] = await pool.query(
    `SELECT c.id
     FROM conversations c
     JOIN conversation_participants p1 ON p1.conversationId = c.id AND p1.userId = ?
     JOIN conversation_participants p2 ON p2.conversationId = c.id AND p2.userId = ?
     WHERE c.type = 'DM'
     LIMIT 1`,
    [userId, partnerId]
  );
  const existing = (rows as any[])[0]?.id;
  if (existing) return existing as string;

  const conversationId = uuid();
  await pool.query(
    "INSERT INTO conversations (id, type, createdAt, updatedAt) VALUES (?, 'DM', NOW(), NOW())",
    [conversationId]
  );
  await pool.query(
    "INSERT INTO conversation_participants (id, conversationId, userId) VALUES (?, ?, ?), (?, ?, ?)",
    [uuid(), conversationId, userId, uuid(), conversationId, partnerId]
  );
  return conversationId;
};

// List DM messages with a partner
router.get("/:partnerId/messages", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  const partnerId = req.params.partnerId;
  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
  if (!partnerId) return res.status(400).json({ success: false, message: "Missing partner" });
  try {
    const [exists] = await pool.query("SELECT id FROM users WHERE id=? LIMIT 1", [partnerId]);
    if (!(exists as any[]).length) return res.status(404).json({ success: false, message: "User not found" });
    const convId = await findOrCreateConversation(userId, partnerId);
    const [rows] = await pool.query(
      "SELECT id, senderId, body, createdAt FROM messages WHERE conversationId=? ORDER BY createdAt ASC LIMIT 500",
      [convId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load messages" });
  }
});

// Send a DM message
router.post("/:partnerId/messages", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  const partnerId = req.params.partnerId;
  const { body } = req.body as { body?: string };
  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
  if (!partnerId || !body) return res.status(400).json({ success: false, message: "Missing data" });
  if (partnerId === userId) return res.status(400).json({ success: false, message: "Cannot DM yourself" });
  try {
    // ensure partner exists
    const [exists] = await pool.query("SELECT id FROM users WHERE id=? LIMIT 1", [partnerId]);
    if (!(exists as any[]).length) return res.status(404).json({ success: false, message: "User not found" });

    const convId = await findOrCreateConversation(userId, partnerId);
    const messageId = uuid();
    const createdAt = new Date();
    await pool.query(
      "INSERT INTO messages (id, conversationId, senderId, body, createdAt) VALUES (?, ?, ?, ?, ?)",
      [messageId, convId, userId, body, createdAt]
    );
    await pool.query("UPDATE conversations SET updatedAt=NOW() WHERE id=?", [convId]);
    await recordDmMessageEvent({ senderId: userId, conversationId: convId, partnerId });
    res.json({ success: true, data: { id: messageId, conversationId: convId, createdAt } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
});

export default router;
