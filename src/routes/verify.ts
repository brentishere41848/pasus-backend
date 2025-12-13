import { Router } from "express";
import { pool } from "../db.js";

export const router = Router();

router.post("/", async (req, res) => {
  const token = (req.body as { token?: string })?.token || (req.query as any)?.token;
  if (!token) return res.status(400).json({ success: false, message: "Missing token" });

  try {
    const [rows] = await pool.query(
      "SELECT id, userId, expiresAt, used FROM email_verifications WHERE token=? LIMIT 1",
      [token]
    );
    const row = (rows as any[])[0];
    if (!row) return res.status(404).json({ success: false, message: "Invalid token" });
    if (row.used) return res.status(400).json({ success: false, message: "Token already used" });
    if (new Date(row.expiresAt) < new Date()) return res.status(400).json({ success: false, message: "Token expired" });

    await pool.query("UPDATE users SET emailVerified=1 WHERE id=?", [row.userId]);
    await pool.query("UPDATE email_verifications SET used=1 WHERE id=?", [row.id]);

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Verification failed" });
  }
});

export default router;
