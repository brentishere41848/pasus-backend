import { Router } from "express";
import { v4 as uuid } from "uuid";
import { resendClient, sendVerificationEmail } from "../services/resend.js";

console.debug("[PasusDebug:backend/src/routes/support] Loaded");

const router = Router();

const articles = [
  { id: "acct-reset", title: "Reset your Pasus password", category: "Account & Login", excerpt: "Use the reset link from email to choose a new password." },
  { id: "billing-nitro", title: "Manage Pasus Nitro billing", category: "Billing & Nitro", excerpt: "Update payment methods, invoices, and renewals." },
  { id: "trust-report", title: "Report abuse or safety issues", category: "Trust & Safety", excerpt: "Submit reports with evidence for quicker review." },
];

router.get("/search", (req, res) => {
  const q = (req.query.q as string || "").toLowerCase();
  if (!q) return res.json({ success: true, data: [] });
  const filtered = articles.filter(
    (a) =>
      a.title.toLowerCase().includes(q) ||
      a.excerpt.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
  );
  res.json({ success: true, data: filtered });
});

router.post("/request", async (req, res) => {
  const { email, subject, category, severity, message } = req.body as {
    email?: string;
    subject?: string;
    category?: string;
    severity?: string;
    message?: string;
  };
  if (!email || !subject || !message) return res.status(400).json({ success: false, message: "Missing fields" });
  try {
    const ticketId = uuid();
    if (resendClient) {
      await resendClient.emails.send({
        from: process.env.FROM_EMAIL || "noreply@pasus.site",
        to: process.env.SUPPORT_INBOX || "support@pasus.site",
        subject: `[Support] ${subject}`,
        html: `<p><strong>Ticket:</strong> ${ticketId}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Category:</strong> ${category || 'General'}</p>
               <p><strong>Severity:</strong> ${severity || 'medium'}</p>
               <p><strong>Message:</strong></p><pre style="font-family:monospace;white-space:pre-wrap;">${message}</pre>`
      });
    }
    res.json({ success: true, data: { ticketId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to create support request" });
  }
});

export default router;
