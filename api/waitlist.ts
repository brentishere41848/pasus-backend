import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const fromEnv = process.env.RESEND_FROM?.trim();
const FROM = fromEnv && fromEnv.length > 0 ? fromEnv : 'Pasus <noreply@pasus.site>';
const NOTIFY = process.env.RESEND_NOTIFY; // optional internal notification address
const BANNER_URL = 'https://pasus.site/assets/logo.png'; // hosted on your domain

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = (req.body?.email || '').trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  try {
    // confirmation to user
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "You're on the Pasus waitlist",
      text: "Thanks for joining! We'll email you when Pasus is ready.",
      html: `
        <div style="font-family:Arial,sans-serif;background:#0b0b14;color:#ffffff;padding:24px;">
          <div style="text-align:center;margin-bottom:16px;">
            <img src="${BANNER_URL}" alt="Pasus" style="display:block;margin:0 auto;border-radius:16px;width:100%;max-width:600px;height:auto;" />
          </div>
          <h1 style="text-align:center;margin:0 0 12px;">You're on the Pasus waitlist</h1>
          <p style="margin:0 0 12px;">Thanks for joining! We'll email you as soon as we open the doors.</p>
        </div>
      `
    });

    // optional internal notification
    if (NOTIFY) {
      await resend.emails.send({
        from: FROM,
        to: NOTIFY,
        subject: 'New waitlist signup',
        text: `Email: ${email}`
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('waitlist error', err?.message || err);
    return res.status(500).json({ error: 'Email send failed' });
  }
}
