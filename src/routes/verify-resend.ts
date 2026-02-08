import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";
import { resendClient, sendVerificationCodeEmail } from "../services/resend.js";
import { createVerifyOtp } from "../services/otp.js";

const router = Router();

router.post("/", async (req, res) => {
  const { email, token: existingToken } = req.body as { email?: string; token?: string };
  try {
    const targetEmail = email;
    if (!targetEmail) return res.status(400).json({ success: false, message: "Missing email" });
    const [rows] = await pool.query("SELECT id, emailVerified FROM users WHERE email=? LIMIT 1", [targetEmail]);
    const user = (rows as any[])[0];
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.emailVerified) return res.json({ success: true, data: { alreadyVerified: true } });

    const { code } = await createVerifyOtp(user.id, targetEmail, req.ip);
    if (resendClient) {
      await sendVerificationCodeEmail(targetEmail, code);
    } else {
      console.warn("[Pasus] RESEND_API_KEY not set; verification code not sent");
    }
    return res.json({ success: true, data: { sent: true } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Failed to resend verification" });
  }
});

export default router;
