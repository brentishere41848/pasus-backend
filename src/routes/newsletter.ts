import express from "express";
import { resendClient } from "../services/resend.js";

console.debug("[PasusDebug:backend/routes/newsletter] Loaded");

const router = express.Router();

router.post("/subscribe", async (req, res) => {
  const email = (req.body?.email || "").toString().trim();
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!isValid) {
    return res.status(400).json({ success: false, error: "Invalid email" });
  }

  if (!resendClient) {
    return res.status(503).json({ success: false, error: "Email service not configured (RESEND_API_KEY missing)" });
  }

  try {
    await resendClient.emails.send({
      from: process.env.FROM_EMAIL || "noreply@pasus.site",
      to: email,
      subject: "Pasus — You’re on the launch list",
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#e6e6ef;background:#0b0b14;padding:32px;">
          <div style="max-width:520px;margin:0 auto;background:#121528;border:1px solid #1f2640;border-radius:16px;padding:28px;">
            <h2 style="margin:0 0 12px;font-size:24px;color:#fff;">Welcome to Pasus</h2>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#c7cede;">
              Thanks for subscribing. We’ll send launch updates and major release notes from <strong>noreply@pasus.site</strong>.
            </p>
            <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#c7cede;">
              Want help now? Reach support at <a href="mailto:support@pasus.site" style="color:#9aa2c6;">support@pasus.site</a>.
            </p>
          </div>
          <p style="margin:16px 0 0;font-size:12px;color:#7f85a3;">If you didn’t request this, you can ignore this email.</p>
        </div>
      `,
    });

    return res.json({ success: true });
  } catch (err: any) {
    console.error("[newsletter] send failed", err);
    const reason = err?.message || "Unable to send email";
    return res.status(500).json({ success: false, error: reason });
  }
});

export default router;
