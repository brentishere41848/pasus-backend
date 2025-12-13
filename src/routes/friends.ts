import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";

console.debug("[PasusDebug:backend/src/routes/friends] Loaded");

export const router = Router();

// Shared handler for reuse
export const handleListFriends = async (req: AuthenticatedRequest, res: any) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    const [rows] = await pool.query(
      `SELECT f.id, f.initiatorId, f.targetId, f.status, f.createdAt, f.updatedAt,
              u.id as userId, u.username, u.displayName, u.avatarUrl, u.status as presence
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.initiatorId = ? THEN f.targetId ELSE f.initiatorId END
       WHERE (f.initiatorId = ? OR f.targetId = ?)
       ORDER BY f.updatedAt DESC`,
      [userId, userId, userId]
    );

    const friends: any[] = [];
    const incomingRequests: any[] = [];
    const outgoingRequests: any[] = [];

    (rows as any[]).forEach((r) => {
      const base = {
        id: r.id,
        user: {
          id: r.userId,
          username: r.username,
          displayName: r.displayName,
          name: r.displayName || r.username,
          avatar: r.avatarUrl || "",
          avatarUrl: r.avatarUrl,
          status: r.presence || "offline",
        },
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };

      if (r.status === "ACCEPTED") {
        friends.push(base);
      } else if (r.status === "PENDING") {
        if (r.targetId === userId) incomingRequests.push(base);
        else outgoingRequests.push(base);
      }
    });

    res.json({ success: true, data: { friends, incomingRequests, outgoingRequests } });
  } catch (err) {
    console.error("[friends] list failed", err);
    const code = (err as any)?.code;
    if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "PROTOCOL_CONNECTION_LOST") {
      return res.status(503).json({ success: false, message: "Database temporarily unavailable" });
    }
    res.status(500).json({ success: false, message: "Failed to load friends" });
  }
};

// GET /api/friends
router.get("/", requireAuth, handleListFriends);

// POST /api/friends/request
router.post("/request", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  const { targetHandle, friendId } = req.body as { targetHandle?: string; friendId?: string };
  if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    let targetId = friendId;
    if (!targetId && targetHandle) {
      const [userRows] = await pool.query(
        "SELECT id FROM users WHERE username = ? OR displayName = ? LIMIT 1",
        [targetHandle, targetHandle]
      );
      targetId = (userRows as any[])[0]?.id;
    }
    if (targetId) {
      const [exists] = await pool.query("SELECT id FROM users WHERE id=? LIMIT 1", [targetId]);
      if (!(exists as any[]).length) return res.status(404).json({ success: false, message: "User not found" });
    }
    if (!targetId) return res.status(404).json({ success: false, message: "User not found" });
    if (targetId === userId) return res.status(400).json({ success: false, message: "Cannot friend yourself" });

    const [existingRows] = await pool.query(
      "SELECT id, status, initiatorId, targetId FROM friendships WHERE (initiatorId=? AND targetId=?) OR (initiatorId=? AND targetId=?) LIMIT 1",
      [userId, targetId, targetId, userId]
    );
    const existing = (existingRows as any[])[0];
    if (existing) {
      if (existing.status === "PENDING" && existing.targetId === userId) {
        // auto-accept reciprocal request
        await pool.query("UPDATE friendships SET status='ACCEPTED', updatedAt=NOW() WHERE id=?", [existing.id]);
        return res.json({ success: true, data: { friendshipId: existing.id, status: "ACCEPTED" } });
      }
      return res.status(409).json({ success: false, message: "Friend request already exists" });
    }

    const friendshipId = uuid();
    await pool.query(
      "INSERT INTO friendships (id, initiatorId, targetId, status, createdAt, updatedAt) VALUES (?, ?, ?, 'PENDING', NOW(), NOW())",
      [friendshipId, userId, targetId]
    );
    res.json({ success: true, data: { friendshipId, status: "PENDING" } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to create request" });
  }
});

// POST /api/friends/accept
router.post("/accept", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  const { friendshipId } = req.body as { friendshipId?: string };
  if (!userId || !friendshipId) return res.status(400).json({ success: false, message: "Missing data" });
  try {
    const [rows] = await pool.query("SELECT targetId, status FROM friendships WHERE id=?", [friendshipId]);
    const row = (rows as any[])[0];
    if (!row) return res.status(404).json({ success: false, message: "Request not found" });
    if (row.targetId !== userId) return res.status(403).json({ success: false, message: "Not your request" });
    if (row.status === "ACCEPTED") return res.json({ success: true, data: { friendshipId, status: "ACCEPTED" } });
    await pool.query("UPDATE friendships SET status='ACCEPTED', updatedAt=NOW() WHERE id=?", [friendshipId]);
    res.json({ success: true, data: { friendshipId, status: "ACCEPTED" } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to accept" });
  }
});

router.post("/decline", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  const { friendshipId } = req.body as { friendshipId?: string };
  if (!userId || !friendshipId) return res.status(400).json({ success: false, message: "Missing data" });
  try {
    const [rows] = await pool.query("SELECT targetId FROM friendships WHERE id=?", [friendshipId]);
    const row = (rows as any[])[0];
    if (!row) return res.status(404).json({ success: false, message: "Request not found" });
    if (row.targetId !== userId) return res.status(403).json({ success: false, message: "Not your request" });
    await pool.query("UPDATE friendships SET status='DECLINED', updatedAt=NOW() WHERE id=?", [friendshipId]);
    res.json({ success: true, data: { friendshipId, status: "DECLINED" } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to decline" });
  }
});

router.post("/block", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.id;
  const { friendshipId } = req.body as { friendshipId?: string };
  if (!userId || !friendshipId) return res.status(400).json({ success: false, message: "Missing data" });
  try {
    const [rows] = await pool.query("SELECT initiatorId, targetId FROM friendships WHERE id=?", [friendshipId]);
    const row = (rows as any[])[0];
    if (!row) return res.status(404).json({ success: false, message: "Request not found" });
    if (row.targetId !== userId && row.initiatorId !== userId) return res.status(403).json({ success: false, message: "Not your request" });
    await pool.query("UPDATE friendships SET status='BLOCKED', updatedAt=NOW() WHERE id=?", [friendshipId]);
    res.json({ success: true, data: { friendshipId, status: "BLOCKED" } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to block" });
  }
});

export default router;
