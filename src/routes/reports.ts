import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { getReasonText } from "../shared/moderation.js";

console.debug("[PasusDebug:backend/src/routes/reports] Loaded");

const router = Router();

// Create report (generic)
router.post("/", requireAuth, async (req, res) => {
  const { targetType, targetId, groupId, channelId, reasonCode, reasonText } = req.body as {
    targetType?: "USER" | "MESSAGE" | "GROUP";
    targetId?: string;
    groupId?: string | null;
    channelId?: string | null;
    reasonCode?: string;
    reasonText?: string;
  };

  if (!targetType || !targetId || !reasonCode) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    const id = uuid();
    const resolvedReasonText = reasonText || getReasonText(reasonCode) || "";
    await pool.query(
      `INSERT INTO reports (id, reporter_id, target_type, target_id, group_id, channel_id, reason_code, reason_text, status, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'OPEN', NOW())`,
      [id, (req as any).user!.id, targetType, targetId, groupId || null, channelId || null, reasonCode, resolvedReasonText]
    );
    res.json({ success: true, data: { id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to submit report" });
  }
});

// List reports (admin)
router.get("/", requireAdmin, async (req, res) => {
  const { status, targetType, reason, limit = "50", offset = "0" } = req.query as any;
  const clauses: string[] = [];
  const params: any[] = [];
  if (status) {
    clauses.push("r.status = ?");
    params.push(status.toString().toUpperCase());
  }
  if (targetType) {
    clauses.push("r.target_type = ?");
    params.push(targetType.toString().toUpperCase());
  }
  if (reason) {
    clauses.push("r.reason_code = ?");
    params.push(reason);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const safeLimit = Math.min(Number(limit) || 50, 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  try {
    const [rows] = await pool.query(
      `
      SELECT r.*,
             rep.username AS reporter_name,
             tu.username AS target_user_name,
             tg.name AS target_group_name,
             cm.body AS target_message_body,
             c.name AS channel_name
      FROM reports r
      LEFT JOIN users rep ON rep.id = r.reporter_id
      LEFT JOIN users tu ON (r.target_type='USER' AND tu.id = r.target_id)
      LEFT JOIN servers tg ON (r.target_type='GROUP' AND tg.id = r.target_id)
      LEFT JOIN channel_messages cm ON (r.target_type='MESSAGE' AND cm.id = r.target_id)
      LEFT JOIN channels c ON c.id = r.channel_id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
      `.replace(/\s+/g, " "),
      [...params, safeLimit, safeOffset]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to list reports" });
  }
});

// Single report detail
router.get("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `
      SELECT r.*,
             rep.username AS reporter_name,
             tu.username AS target_user_name,
             tg.name AS target_group_name,
             cm.body AS target_message_body,
             c.name AS channel_name
      FROM reports r
      LEFT JOIN users rep ON rep.id = r.reporter_id
      LEFT JOIN users tu ON (r.target_type='USER' AND tu.id = r.target_id)
      LEFT JOIN servers tg ON (r.target_type='GROUP' AND tg.id = r.target_id)
      LEFT JOIN channel_messages cm ON (r.target_type='MESSAGE' AND cm.id = r.target_id)
      LEFT JOIN channels c ON c.id = r.channel_id
      WHERE r.id=? LIMIT 1
      `.replace(/\s+/g, " "),
      [id]
    );
    const report = (rows as any[])[0];
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });
    res.json({ success: true, data: report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load report" });
  }
});

// Update status / notes
router.post("/:id/status", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body as { status?: string; notes?: string };
  const valid = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"];
  const normalized = (status || "").toUpperCase();
  if (!valid.includes(normalized)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }
  try {
    await pool.query(
      `UPDATE reports
       SET status=?, notes=?, handled_by=?, handled_at=NOW()
       WHERE id=?`,
      [normalized, notes || null, (req as any).user?.id || null, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update status" });
  }
});

export default router;
