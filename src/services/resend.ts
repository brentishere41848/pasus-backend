import { Resend } from "resend";
import dotenv from "dotenv";
dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

export const resendClient = RESEND_API_KEY
  ? new Resend(RESEND_API_KEY)
  : null;

export const sendVerificationEmail = async (to: string, token: string) => {
  if (!resendClient) throw new Error("RESEND_API_KEY not configured");
  const base = process.env.APP_BASE_URL || "http://localhost:5173";
  const verifyUrl = `${base.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  console.log("[Pasus] Sending verification email to", to, "token", token);
  const brand = "Pasus";
  // Inline SVG so logo always renders in email clients
  const logoDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg width="96" height="96" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
      <rect width="96" height="96" rx="20" fill="#0f1220"/>
      <circle cx="48" cy="48" r="38" fill="#7c5dff"/>
      <text x="48" y="56" font-size="26" font-family="Arial,Helvetica,sans-serif" font-weight="700" text-anchor="middle" fill="white">PASUS</text>
    </svg>
  `)}`;
  const btn = `<a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;background:#7c5dff;color:#fff;border-radius:10px;font-weight:700;text-decoration:none">Verify email</a>`;
  const html = `
  <table width="100%" bgcolor="#0b0b14" style="padding:32px 0;font-family:Arial,Helvetica,sans-serif;color:#e6e6ef;">
    <tr><td align="center">
      <table width="420" bgcolor="#121528" style="border:1px solid #1f2640;border-radius:16px;padding:28px;">
        <tr><td align="center" style="padding-bottom:12px;">
          <img src="${logoDataUri}" alt="${brand}" width="64" height="64" style="display:block;"/>
        </td></tr>
        <tr><td align="center" style="font-size:22px;font-weight:800;color:#fff;padding-bottom:6px;">Welcome to ${brand}</td></tr>
        <tr><td align="center" style="font-size:14px;color:#bfc5d7;padding-bottom:18px;line-height:1.6;">
          Thanks for signing up. To activate your account, confirm your email within 15 minutes.
        </td></tr>
        <tr><td align="center" style="padding-bottom:22px;">${btn}</td></tr>
        <tr><td align="center" style="font-size:12px;color:#7f85a3;">
          Or paste this link:<br/><span style="color:#9aa2c6;">${verifyUrl}</span>
        </td></tr>
      </table>
      <div style="font-size:11px;color:#6b728e;padding-top:14px;">If you didn’t request this, you can ignore this email. You can report this at <a href="https://pasus.site/support/request" style="color:#9aa2c6;">pasus.site/support/request</a>.</div>
    </td></tr>
  </table>`;

  await resendClient.emails.send({
    from: process.env.FROM_EMAIL || "noreply@pasus.site",
    to,
    subject: `${brand} — Verify your email`,
    html,
  });
  console.log("[Pasus] Verification email queued");
};
