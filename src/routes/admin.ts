import { Router } from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";

console.debug("[PasusDebug:backend/src/routes/admin] Loaded");

const router = Router();

// List users with filters
router.get("/users", requireAdmin, async (req, res) => {
  const { query, status, limit = "50", offset = "0" } = req.query as any;
  const clauses: string[] = [];
  const params: any[] = [];
  if (query) {
    clauses.push("(u.username LIKE ? OR u.displayName LIKE ? OR u.email LIKE ?)");
    const term = `%${query}%`;
    params.push(term, term, term);
  }
  if (status) {
    clauses.push("u.accountStatus = ?");
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  try {
    const [rows] = await pool.query(
      `
      SELECT u.id, u.username, u.displayName, u.email, u.status, u.accountStatus, u.role,
             u.createdAt, u.lastSeen,
             COALESCE(ms.currentStage, 'NONE') AS moderationStage,
             (SELECT COUNT(*) FROM reports r WHERE r.target_type='USER' AND r.target_id=u.id) as reportsAgainst,
             (SELECT COUNT(*) FROM reports r WHERE r.reporter_id=u.id) as reportsFiled
      FROM users u
      LEFT JOIN moderation_statuses ms ON ms.userId=u.id
      ${where}
      ORDER BY u.createdAt DESC
      LIMIT ? OFFSET ?
      `.replace(/\s+/g, " "),
      [...params, safeLimit, safeOffset]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to list users" });
  }
});

// Update user status / moderation stage
router.post("/users/:id/status", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { accountStatus, moderationStage } = req.body as { accountStatus?: string; moderationStage?: string };
  const updates: string[] = [];
  const params: any[] = [];
  if (accountStatus) {
    updates.push("accountStatus=?");
    params.push(accountStatus);
  }
  try {
    if (updates.length) {
      await pool.query(`UPDATE users SET ${updates.join(",")} WHERE id=?`, [...params, id]);
    }
    if (moderationStage) {
      await pool.query(
        `INSERT INTO moderation_statuses (userId,currentStage,updatedAt)
         VALUES (?,?,NOW())
         ON DUPLICATE KEY UPDATE currentStage=VALUES(currentStage), updatedAt=NOW()`,
        [id, moderationStage]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update user" });
  }
});

// Groups listing (optional)
router.get("/groups", requireAdmin, async (req, res) => {
  const { query, limit = "50", offset = "0" } = req.query as any;
  const clauses: string[] = [];
  const params: any[] = [];
  if (query) {
    clauses.push("s.name LIKE ?");
    params.push(`%${query}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  try {
    const [rows] = await pool.query(
      `
      SELECT s.id, s.name, s.ownerId, s.type, s.createdAt,
             (SELECT COUNT(*) FROM server_memberships sm WHERE sm.serverId=s.id) as memberCount,
             (SELECT COUNT(*) FROM reports r WHERE r.group_id=s.id OR (r.target_type='GROUP' AND r.target_id=s.id)) as reportCount
      FROM servers s
      ${where}
      ORDER BY s.createdAt DESC
      LIMIT ? OFFSET ?
      `.replace(/\s+/g, " "),
      [...params, safeLimit, safeOffset]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to list groups" });
  }
});

export default router;
