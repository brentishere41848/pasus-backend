import { Router } from "express";
import { pool } from "../db.js";
import { v4 as uuid } from "uuid";
import { resendClient } from "../services/resend.js";

const router = Router();

const validateOneTimeCode = async (code?: string, maxMinutes = 10) => {
  if (!code) return { ok: false, message: "Access code required" };
  try {
    const [rows] = await pool.query(
      "SELECT code, used, expiresAt, createdAt FROM access_codes WHERE code=? LIMIT 1",
      [code]
    );
    const row = (rows as any[])[0];
    if (!row) return { ok: false, message: "Invalid access code" };
    if (row.used) return { ok: false, message: "Access code already used" };
    const expBase = row.expiresAt ? new Date(row.expiresAt) : new Date(row.createdAt || Date.now());
    const hardExpiry = new Date(expBase.getTime() + maxMinutes * 60 * 1000);
    if (new Date() > hardExpiry) return { ok: false, message: "Access code expired" };
    return { ok: true };
  } catch (err) {
    console.warn("[Pasus] access code lookup failed", err);
    return { ok: false, message: "Access code check failed" };
  }
};

router.post("/access-code/request", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ success: false, message: "Email required" });
  try {
    const code = Math.random().toString().slice(2, 8); // 6-digit
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      "INSERT INTO access_codes (code, email, expiresAt, used, notes) VALUES (?, ?, ?, 0, ?)",
      [code, email, expires, "signup access"]
    );
    if (resendClient) {
      const base = process.env.APP_BASE_URL || "https://pasus.site";
      const brand = "Pasus";
      const html = `<p>Your ${brand} access code:</p><p style="font-size:20px;font-weight:700;">${code}</p><p>This code expires in 10 minutes.</p>`;
      await resendClient.emails.send({
        from: process.env.FROM_EMAIL || "noreply@pasus.site",
        to: email,
        subject: `${brand} access code`,
        html
      });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Failed to issue code" });
  }
});

router.post("/access-code/validate", async (req, res) => {
  const { code } = req.body as { code?: string };
  const check = await validateOneTimeCode(code, 10);
  if (!check.ok) return res.status(403).json({ success: false, message: check.message });
  try {
    await pool.query("UPDATE access_codes SET used=1, usedAt=NOW() WHERE code=?", [code]);
    return res.json({ success: true, data: { accessToken: uuid() } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Failed to lock code" });
  }
});

export default router;
