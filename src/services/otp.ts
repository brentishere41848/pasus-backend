import crypto from "crypto";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";
import { resendClient } from "./resend.js";

console.debug("[PasusDebug:backend/services/otp] Loaded");

export type OtpPurpose = "LOGIN" | "TFA";
export type VerificationPurpose = "LOGIN" | "VERIFY" | "PROFILE" | "TFA";

export interface LoginOtpRecord {
  id: string;
  token: string;
  userId: string;
  codeHash: string;
  purpose: OtpPurpose;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  attemptCount: number;
  lastSentAt: Date | null;
  resendCount?: number;
}

export const OTP_EXP_MINUTES = 15;
export const OTP_LEN = 6;
export const OTP_VERIFY_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MIN_SECONDS = 30;
export const OTP_RESEND_MAX_PER_HOUR = 5;

export const hashOtp = (code: string) =>
  crypto.createHash("sha256").update(code).digest("hex");

export const generateOtpCode = () => {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(OTP_LEN, "0");
};

export const canRetryVerify = (attemptCount: number) =>
  attemptCount < OTP_VERIFY_MAX_ATTEMPTS;

const recordToModel = (row: any): LoginOtpRecord => ({
  id: row.id,
  token: row.token,
  userId: row.userId,
  codeHash: row.codeHash,
  purpose: row.purpose,
  createdAt: new Date(row.createdAt),
  expiresAt: new Date(row.expiresAt),
  usedAt: row.usedAt ? new Date(row.usedAt) : null,
  attemptCount: Number(row.attemptCount || 0),
  lastSentAt: row.lastSentAt ? new Date(row.lastSentAt) : null,
  resendCount: row.resendCount ? Number(row.resendCount) : 0,
});

export const sendLoginCodeEmail = async (toEmail: string, code: string) => {
  if (!resendClient) {
    console.warn("[Pasus] RESEND_API_KEY missing; OTP email not sent");
    return;
  }
  const subject = "Your Pasus login code";
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#e6e6ef;background:#0b0b14;padding:32px;">
      <div style="max-width:520px;margin:0 auto;background:#121528;border:1px solid #1f2640;border-radius:16px;padding:28px;">
        <h2 style="margin:0 0 12px;font-size:24px;color:#fff;">Use this code to continue</h2>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#c7cede;">
          Your Pasus login code is <strong style="font-size:22px;letter-spacing:4px;color:#fff;">${code}</strong>.
        </p>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#c7cede;">
          It expires in 15 minutes and can be used only once.
        </p>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#7f85a3;">If you didn't request this, you can ignore this email.</p>
    </div>
  `;

  await resendClient.emails.send({
    from: process.env.FROM_EMAIL || "noreply@pasus.site",
    to: toEmail,
    subject,
    html,
  });
};

export const createLoginOtp = async (userId: string, email: string, ip?: string, purpose: VerificationPurpose = "LOGIN") => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [lastRows] = await conn.query(
      "SELECT createdAt, lastSentAt FROM login_otps WHERE (userId=? OR ipAddress=?) AND purpose=? ORDER BY createdAt DESC LIMIT 1",
      [userId, ip || null, purpose]
    );
    const last = (lastRows as any[])[0];
    if (last && last.lastSentAt) {
      const elapsed = Date.now() - new Date(last.lastSentAt).getTime();
      if (elapsed < OTP_RESEND_MIN_SECONDS * 1000) {
        throw new Error("RATE_LIMIT_MINUTE");
      }
    }

    const [recentRows] = await conn.query(
      "SELECT COUNT(*) as count FROM login_otps WHERE (userId=? OR ipAddress=?) AND purpose=? AND createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR)",
      [userId, ip || null, purpose]
    );
    const recentCount = Number((recentRows as any[])[0]?.count || 0);
    if (recentCount >= OTP_RESEND_MAX_PER_HOUR) {
      throw new Error("RATE_LIMIT_HOURLY");
    }

    // Invalidate any previous unused login OTPs
    await conn.query(
      "UPDATE login_otps SET usedAt=NOW() WHERE userId=? AND purpose=? AND usedAt IS NULL",
      [userId, purpose]
    );

    const code = generateOtpCode();
    const token = uuid();
    const expiresAt = new Date(Date.now() + OTP_EXP_MINUTES * 60 * 1000);

    await conn.query(
      `INSERT INTO login_otps (id, token, userId, codeHash, purpose, createdAt, expiresAt, usedAt, attemptCount, lastSentAt, resendCount, ipAddress)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, NULL, 0, NOW(), 0, ?)`,
      [uuid(), token, userId, hashOtp(code), purpose, expiresAt, ip || null]
    );

    await conn.commit();
    // email send outside transaction
    return { otpToken: token, code };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

export const verifyLoginOtp = async (otpToken: string, code: string) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT * FROM login_otps WHERE token=? LIMIT 1 FOR UPDATE",
      [otpToken]
    );
    const row = (rows as any[])[0];
    if (!row) {
      throw new Error("OTP_INVALID");
    }
    const record = recordToModel(row);
    if (record.usedAt) throw new Error("OTP_USED");
    if (record.expiresAt.getTime() <= Date.now()) throw new Error("OTP_EXPIRED");
    if (!canRetryVerify(record.attemptCount)) throw new Error("OTP_LOCKED");

    const incomingHash = hashOtp(code);
    if (incomingHash !== record.codeHash) {
      await conn.query(
        "UPDATE login_otps SET attemptCount=attemptCount+1 WHERE id=?",
        [record.id]
      );
      await conn.commit();
      throw new Error("OTP_MISMATCH");
    }

    await conn.query("UPDATE login_otps SET usedAt=NOW() WHERE id=?", [record.id]);
    await conn.commit();
    return { userId: record.userId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

export const resendLoginOtp = async (otpToken: string, ip?: string) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT * FROM login_otps WHERE token=? LIMIT 1 FOR UPDATE",
      [otpToken]
    );
    const row = (rows as any[])[0];
    if (!row) throw new Error("OTP_INVALID");
    const record = recordToModel(row);

    const now = Date.now();
    if (record.lastSentAt && now - record.lastSentAt.getTime() < OTP_RESEND_MIN_SECONDS * 1000) {
      throw new Error("RATE_LIMIT_MINUTE");
    }

    const [recentRows] = await conn.query(
      "SELECT COUNT(*) as count FROM login_otps WHERE (userId=? OR ipAddress=?) AND purpose='LOGIN' AND createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR)",
      [record.userId, ip || null]
    );
    const recentCount = Number((recentRows as any[])[0]?.count || 0);
    if (recentCount >= OTP_RESEND_MAX_PER_HOUR) {
      throw new Error("RATE_LIMIT_HOURLY");
    }

    // Invalidate the current OTP
    await conn.query("UPDATE login_otps SET usedAt=NOW() WHERE id=?", [record.id]);

    const code = generateOtpCode();
    const token = uuid();
    const expiresAt = new Date(Date.now() + OTP_EXP_MINUTES * 60 * 1000);
    await conn.query(
      `INSERT INTO login_otps (id, token, userId, codeHash, purpose, createdAt, expiresAt, usedAt, attemptCount, lastSentAt, resendCount, ipAddress)
       VALUES (?, ?, ?, ?, 'LOGIN', NOW(), ?, NULL, 0, NOW(), ?, ?)`,
      [uuid(), token, record.userId, hashOtp(code), expiresAt, (record.resendCount || 0) + 1, ip || null]
    );

    await conn.commit();
    return { otpToken: token, code, userId: record.userId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

export const createVerifyOtp = async (userId: string, email: string, ip?: string) => {
  return createLoginOtp(userId, email, ip, "VERIFY");
};

export const verifyEmailOtp = async (userId: string, code: string) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT * FROM login_otps WHERE userId=? AND purpose='VERIFY' AND usedAt IS NULL ORDER BY createdAt DESC LIMIT 1 FOR UPDATE",
      [userId]
    );
    const row = (rows as any[])[0];
    if (!row) throw new Error("OTP_INVALID");
    const record = recordToModel(row);
    if (record.expiresAt.getTime() <= Date.now()) throw new Error("OTP_EXPIRED");
    if (!canRetryVerify(record.attemptCount)) throw new Error("OTP_LOCKED");

    if (hashOtp(code) !== record.codeHash) {
      await conn.query("UPDATE login_otps SET attemptCount=attemptCount+1 WHERE id=?", [record.id]);
      await conn.commit();
      throw new Error("OTP_MISMATCH");
    }

    await conn.query("UPDATE login_otps SET usedAt=NOW() WHERE id=?", [record.id]);
    await conn.query("UPDATE users SET emailVerified=1 WHERE id=?", [record.userId]);
    await conn.commit();
    return { userId: record.userId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// Pure helper used in tests
export const evaluateOtpAttempt = (record: LoginOtpRecord, code: string, now = new Date()) => {
  if (record.usedAt) return { ok: false, reason: "used" as const, record };
  if (record.expiresAt.getTime() <= now.getTime())
    return { ok: false, reason: "expired" as const, record };
  if (!canRetryVerify(record.attemptCount))
    return { ok: false, reason: "locked" as const, record };
  if (hashOtp(code) !== record.codeHash) {
    return {
      ok: false,
      reason: "mismatch" as const,
      record: { ...record, attemptCount: record.attemptCount + 1 },
    };
  }
  return {
    ok: true,
    reason: "ok" as const,
    record: { ...record, usedAt: now },
  };
};
