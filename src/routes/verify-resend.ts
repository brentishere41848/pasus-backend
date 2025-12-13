import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";
import { resendClient, sendVerificationEmail } from "../services/resend.js";

const router = Router();

router.post("/", async (req, res) => {
  const { email, token: existingToken } = req.body as { email?: string; token?: string };
  try {
    let targetEmail = email;
    let userId: string | undefined;

    if (!targetEmail && existingToken) {
      const [trows] = await pool.query(
        "SELECT ev.userId, u.email, u.emailVerified FROM email_verifications ev JOIN users u ON ev.userId=u.id WHERE ev.token=? LIMIT 1",
        [existingToken]
      );
      const row = (trows as any[])[0];
      if (row) {
        targetEmail = row.email;
        userId = row.userId;
        if (row.emailVerified) return res.json({ success: true, data: { alreadyVerified: true } });
      }
    }

    if (!targetEmail) return res.status(400).json({ success: false, message: "Missing email" });

    if (!userId) {
      const [rows] = await pool.query("SELECT id, emailVerified FROM users WHERE email=? LIMIT 1", [targetEmail]);
      const user = (rows as any[])[0];
      if (!user) return res.status(404).json({ success: false, message: "User not found" });
      if (user.emailVerified) return res.json({ success: true, data: { alreadyVerified: true } });
      userId = user.id;
    }

    const newToken = uuid();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      "INSERT INTO email_verifications (id, userId, token, expiresAt, used) VALUES (?, ?, ?, ?, 0)",
      [uuid(), userId, newToken, expires]
    );
    if (resendClient) {
      await sendVerificationEmail(targetEmail, newToken);
    } else {
      console.warn("[Pasus] RESEND_API_KEY not set; resend verification email not sent");
    }
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Failed to resend verification" });
  }
});

export default router;
