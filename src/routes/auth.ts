import { Router } from "express";
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";
import crypto from "crypto";
import { pool } from "../db.js";
import { fetchModerationState } from "../middleware/auth.js";
import { getReasonText } from "../shared/moderation.js";
import { resendClient, sendVerificationCodeEmail, sendVerificationEmail } from "../services/resend.js";
import {
  createLoginOtp,
  createVerifyOtp,
  resendLoginOtp,
  sendLoginCodeEmail,
  verifyLoginOtp,
  OTP_VERIFY_MAX_ATTEMPTS,
  verifyEmailOtp,
} from "../services/otp.js";
import { authenticator } from "otplib";

console.debug("[PasusDebug:backend/src/routes/auth] Loaded");
dotenv.config();
const ALLOW_MOCKS = process.env.ALLOW_MOCKS === 'true';
const SKIP_EMAIL_VERIFICATION = process.env.SKIP_EMAIL_VERIFICATION === 'true';
const SKIP_LOGIN_OTP = process.env.SKIP_LOGIN_OTP === 'true';

const router = Router();
const PROFILE_TOKEN_MINUTES = 30;
const TFA_TOKEN_MINUTES = 10;

const hashRecovery = (code: string) => crypto.createHash("sha256").update(code).digest("hex");
const generateRecoveryCodes = (count = 10) => {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const buf = crypto.randomBytes(6).toString("hex");
    codes.push(buf);
  }
  return codes;
};

const ensureUniqueUsername = async (preferred: string) => {
  let candidate = preferred || `user${Date.now()}`;
  let n = 0;
  while (n < 25) {
    const [rows] = await pool.query("SELECT id FROM users WHERE username=? LIMIT 1", [candidate]);
    if (!(rows as any[]).length) return candidate;
    n += 1;
    candidate = `${preferred}_${n}`;
  }
  return `${preferred}_${crypto.randomBytes(3).toString("hex")}`;
};

const issueProfileToken = async (userId: string) => {
  const token = uuid();
  const expiresAt = new Date(Date.now() + PROFILE_TOKEN_MINUTES * 60 * 1000);
  await pool.query(
    `INSERT INTO login_otps (id, token, userId, codeHash, purpose, createdAt, expiresAt, usedAt, attemptCount, lastSentAt, resendCount, ipAddress)
     VALUES (?, ?, ?, ?, 'PROFILE', NOW(), ?, NULL, 0, NOW(), 0, NULL)`,
    [uuid(), token, userId, "profile", expiresAt]
  );
  return token;
};

const issueTfaToken = async (userId: string) => {
  const token = uuid();
  const expiresAt = new Date(Date.now() + TFA_TOKEN_MINUTES * 60 * 1000);
  await pool.query(
    `INSERT INTO login_otps (id, token, userId, codeHash, purpose, createdAt, expiresAt, usedAt, attemptCount, lastSentAt, resendCount, ipAddress)
     VALUES (?, ?, ?, ?, 'TFA', NOW(), ?, NULL, 0, NOW(), 0, NULL)`,
    [uuid(), token, userId, "tfa", expiresAt]
  );
  return token;
};

router.post("/register", async (req, res) => {
  const { email, password, username } = req.body as {
    email?: string;
    password?: string;
    username?: string;
  };

  if (!email || !password || !username) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
    if ((rows as any[]).length) {
      return res.status(409).json({ success: false, message: "Email exists" });
    }

    const id = uuid();
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;
    await pool.query(
      'INSERT INTO users (id,email,username,displayName,role,isPremium,passwordHash,status,bio,avatarUrl,accountStatus,lastSeen,createdAt,updatedAt,emailVerified) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),NOW(),?)',
      [id, email, username, username, 'USER', 0, password, 'online', null, avatar, 'good', 0]
    );
    await pool.query(
      'INSERT INTO moderation_statuses (userId,currentStage,updatedAt) VALUES (?,?,NOW()) ON DUPLICATE KEY UPDATE currentStage=currentStage',
      [id, 'NONE']
    );
    const [userRows] = await pool.query('SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified,totpEnabled FROM users WHERE id=?', [id]);
    const user = (userRows as any[])[0];
    if (user) user.twoFactorEnabled = Boolean(user.totpEnabled);
    const moderation = await fetchModerationState(id);

    // queue verification code (15 min) without blocking response
    (async () => {
      try {
        const { otpToken: _, code } = await createVerifyOtp(id, email, req.ip);
        if (resendClient) await sendVerificationCodeEmail(email, code);
        else console.warn("[Pasus] RESEND_API_KEY not set; verification code not sent");
      } catch (err) {
        console.warn("[Pasus] Failed to queue verification code email", err);
      }
    })();

    return res.json({ success: true, data: { token: 'session-placeholder', user, moderation, requiresEmailVerification: true } });
  } catch (err) {
    console.error(err);
    if (ALLOW_MOCKS) {
      // Fallback: allow mock registration when DB unreachable (local testing)
      const mockUser = {
        id: `mock_${Date.now()}`,
        email: email || 'mock@example.com',
        username: username || 'MockUser',
        displayName: username || 'Mock User',
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username || 'Mock')}`,
        status: 'online',
        role: 'USER',
        isPremium: 0,
        accountStatus: 'good',
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return res.json({ success: true, data: { token: 'dev-mock-token', user: mockUser, moderation: { stage: 'NONE', lastAction: null } } });
    }
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Missing credentials" });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified,passwordHash,totpEnabled FROM users WHERE email=?',
      [email]
    );
    const user = (rows as any[])[0];
    if (user) {
      user.twoFactorEnabled = Boolean(user.totpEnabled);
    }
    let otpToken = uuid(); // opaque token even when credentials fail (avoid enumeration)

    if (user && user.passwordHash === password) {
      if (!user.emailVerified && !SKIP_EMAIL_VERIFICATION) {
        return res.status(401).json({ success: false, message: "Email not verified. Please verify your email first." });
      }
      const moderation = await fetchModerationState(user.id);
      if (moderation.stage === 'TERMINATED') {
        // Keep response generic to avoid leaking moderation status during login enumeration
        return res.json({ success: true, data: { requiresOtp: true, otpToken } });
      }

      if (user.twoFactorEnabled && !SKIP_LOGIN_OTP) {
        const tfaToken = await issueTfaToken(user.id);
        return res.json({
          success: true,
          data: { requires2fa: true, tfaToken, message: "Enter the 6-digit code from your authenticator app." },
        });
      }
      // In dev, optionally skip OTP flow entirely
      if (SKIP_LOGIN_OTP) {
        await pool.query("UPDATE users SET lastSeen=NOW(), status='online' WHERE id=?", [user.id]);
        const token = user.id;
        return res.json({ success: true, data: { token, user, moderation } });
      }

      // Create OTP (and invalidate previous ones) but don't finalize session yet
      try {
        const { otpToken: realToken, code } = await createLoginOtp(user.id, user.email, req.ip);
        otpToken = realToken;
        // send email async
        (async () => {
          try {
            await sendLoginCodeEmail(user.email, code);
            console.info("[auth] OTP created for user", user.id);
          } catch (err) {
            console.error("[auth] Failed to send OTP email", err);
          }
        })();
      } catch (err: any) {
        if (err?.message?.startsWith("RATE_LIMIT")) {
          return res.status(429).json({
            success: false,
            message: "Too many requests. Please wait before retrying.",
          });
        }
        console.error("[auth] OTP creation failed", err);
        return res.status(500).json({ success: false, message: "Unable to start verification" });
      }
    } else {
      // invalid credentials path still returns a generic response to avoid enumeration
      await new Promise((r) => setTimeout(r, 120));
    }

    return res.json({
      success: true,
      data: {
        requiresOtp: true,
        otpToken,
        message: "If the credentials were correct, we've sent a 6-digit code to your email.",
      },
    });
  } catch (err) {
    console.error(err);
    if (ALLOW_MOCKS) {
      // Fallback mock login if DB not reachable
      const mockUser = {
        id: `mock_${Date.now()}`,
        email: email || 'mock@example.com',
        username: 'MockUser',
        displayName: 'Mock User',
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=MockUser`,
        status: 'online',
        role: 'USER',
        isPremium: 0,
        accountStatus: 'good',
        lastSeen: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return res.json({ success: true, data: { token: 'dev-mock-token', user: mockUser, moderation: { stage: 'NONE', lastAction: null } } });
    }
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Simple reset endpoint (stub email send)
router.post("/reset", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ success: false, message: "Email required" });
  // In production, send reset email token here.
  return res.json({ success: true });
});

router.post("/verify-otp", async (req, res) => {
  const { otpToken, code } = req.body as { otpToken?: string; code?: string };
  if (!otpToken || !code) return res.status(400).json({ success: false, message: "Missing code" });

  try {
    const result = await verifyLoginOtp(otpToken, code);
    const [userRows] = await pool.query(
      "SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified,totpEnabled FROM users WHERE id=? LIMIT 1",
      [result.userId]
    );
    const user = (userRows as any[])[0];
    if (user) user.twoFactorEnabled = Boolean(user.totpEnabled);
    if (!user) return res.status(404).json({ success: false, message: "Account not found" });

    const moderation = await fetchModerationState(user.id);
    if (moderation.stage === 'TERMINATED') {
      return res.status(403).json({
        success: false,
        message: "Account terminated.",
        data: {
          user,
          moderation,
          reasonText: getReasonText(moderation.lastAction?.reasonCode),
        },
      });
    }

    const lastSeen = user.lastSeen ? new Date(user.lastSeen) : new Date();
    const now = new Date();
    const diffDays = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays >= 365) {
      await pool.query('DELETE FROM users WHERE id=?', [user.id]);
      return res.status(401).json({ success: false, message: "Account deleted due to inactivity." });
    }
    if (diffDays >= 30) {
      return res.status(401).json({ success: false, message: "Session expired due to inactivity. Please register/login again." });
    }

    await pool.query("UPDATE users SET emailVerified=1, lastSeen=NOW(), status='online' WHERE id=?", [user.id]);
    user.lastSeen = new Date().toISOString();
    user.emailVerified = true;
    const token = user.id; // placeholder token model

    console.info("[auth] OTP verified for user", user.id);
    return res.json({ success: true, data: { token, user, moderation } });
  } catch (err: any) {
    const codeMsg = err?.message || "";
    if (codeMsg === "OTP_EXPIRED") return res.status(400).json({ success: false, message: "Code expired. Request a new one." });
    if (codeMsg === "OTP_USED") return res.status(400).json({ success: false, message: "Code already used. Request a new one." });
    if (codeMsg === "OTP_LOCKED") return res.status(429).json({ success: false, message: `Too many attempts. Try again after ${OTP_VERIFY_MAX_ATTEMPTS} attempts or request a new code.` });
    if (codeMsg === "OTP_MISMATCH" || codeMsg === "OTP_INVALID") {
      return res.status(400).json({ success: false, message: "Incorrect code. Check and try again." });
    }
    console.error("[auth] verify-otp failed", err);
    return res.status(500).json({ success: false, message: "Verification failed" });
  }
});

router.post("/verify-email/code", async (req, res) => {
  const { email, code } = req.body as { email?: string; code?: string };
  if (!email || !code) return res.status(400).json({ success: false, message: "Missing fields" });
  try {
    const [rows] = await pool.query("SELECT id FROM users WHERE email=? LIMIT 1", [email]);
    const user = (rows as any[])[0];
    if (!user) return res.status(404).json({ success: false, message: "Account not found" });

    await verifyEmailOtp(user.id, code);
    const [userRows] = await pool.query(
      "SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified,totpEnabled FROM users WHERE id=? LIMIT 1",
      [user.id]
    );
    const refreshed = (userRows as any[])[0];
    if (refreshed) refreshed.twoFactorEnabled = Boolean(refreshed.totpEnabled);
    const moderation = await fetchModerationState(user.id);
    const token = refreshed.id;
    return res.json({ success: true, data: { token, user: refreshed, moderation } });
  } catch (err: any) {
    const codeMsg = err?.message || "";
    if (codeMsg === "OTP_EXPIRED") return res.status(400).json({ success: false, message: "Code expired. Request a new one." });
    if (codeMsg === "OTP_USED") return res.status(400).json({ success: false, message: "Code already used. Request a new one." });
    if (codeMsg === "OTP_LOCKED") return res.status(429).json({ success: false, message: `Too many attempts. Request a new code.` });
    if (codeMsg === "OTP_MISMATCH" || codeMsg === "OTP_INVALID") {
      return res.status(400).json({ success: false, message: "Incorrect code. Check and try again." });
    }
    console.error("[auth] verify-email/code failed", err);
    return res.status(500).json({ success: false, message: "Verification failed" });
  }
});

router.post("/verify-email/request", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ success: false, message: "Missing email" });
  try {
    const [rows] = await pool.query("SELECT id, emailVerified FROM users WHERE email=? LIMIT 1", [email]);
    const user = (rows as any[])[0];
    if (!user) return res.status(404).json({ success: false, message: "Account not found" });
    if (user.emailVerified) return res.json({ success: true, data: { alreadyVerified: true } });
    const { code } = await createVerifyOtp(user.id, email, req.ip);
    if (resendClient) await sendVerificationCodeEmail(email, code);
    return res.json({ success: true });
  } catch (err) {
    console.error("[auth] verify-email/request failed", err);
    return res.status(500).json({ success: false, message: "Unable to send code" });
  }
});

router.post("/2fa/setup", async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) return res.status(400).json({ success: false, message: "Missing userId" });
  try {
    const secret = authenticator.generateSecret();
    await pool.query("UPDATE users SET totpSecret=?, totpEnabled=0 WHERE id=?", [secret, userId]);
    const otpauth = authenticator.keyuri(userId, "Pasus", secret);
    return res.json({ success: true, data: { secret, otpauth } });
  } catch (err) {
    console.error("[auth] 2fa setup failed", err);
    return res.status(500).json({ success: false, message: "Unable to start 2FA setup" });
  }
});

router.post("/2fa/verify-setup", async (req, res) => {
  const { userId, code } = req.body as { userId?: string; code?: string };
  if (!userId || !code) return res.status(400).json({ success: false, message: "Missing fields" });
  try {
    const [rows] = await pool.query("SELECT totpSecret FROM users WHERE id=? LIMIT 1", [userId]);
    const user = (rows as any[])[0];
    if (!user?.totpSecret) return res.status(400).json({ success: false, message: "2FA not initialized" });
    const ok = authenticator.check(code, user.totpSecret);
    if (!ok) return res.status(400).json({ success: false, message: "Invalid code" });
    const recovery = generateRecoveryCodes();
    const hashed = recovery.map(hashRecovery);
    await pool.query("UPDATE users SET totpEnabled=1, totpRecoveryCodes=? WHERE id=?", [JSON.stringify(hashed), userId]);
    return res.json({ success: true, data: { recoveryCodes: recovery } });
  } catch (err) {
    console.error("[auth] 2fa verify failed", err);
    return res.status(500).json({ success: false, message: "Unable to enable 2FA" });
  }
});

router.post("/2fa/disable", async (req, res) => {
  const { userId, code } = req.body as { userId?: string; code?: string };
  if (!userId || !code) return res.status(400).json({ success: false, message: "Missing fields" });
  try {
    const [rows] = await pool.query("SELECT totpSecret, totpRecoveryCodes FROM users WHERE id=? LIMIT 1", [userId]);
    const user = (rows as any[])[0];
    if (!user?.totpSecret) return res.status(400).json({ success: false, message: "2FA not enabled" });
    const recoveryHashes = user.totpRecoveryCodes ? JSON.parse(user.totpRecoveryCodes || "[]") : [];
    const codeClean = code.trim();
    const ok = authenticator.check(codeClean, user.totpSecret) || recoveryHashes.includes(hashRecovery(codeClean));
    if (!ok) return res.status(400).json({ success: false, message: "Invalid code" });
    await pool.query("UPDATE users SET totpEnabled=0, totpSecret=NULL, totpRecoveryCodes=NULL WHERE id=?", [userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error("[auth] 2fa disable failed", err);
    return res.status(500).json({ success: false, message: "Unable to disable 2FA" });
  }
});

router.post("/2fa/login", async (req, res) => {
  const { tfaToken, code } = req.body as { tfaToken?: string; code?: string };
  if (!tfaToken || !code) return res.status(400).json({ success: false, message: "Missing fields" });
  try {
    const [rows] = await pool.query("SELECT * FROM login_otps WHERE token=? AND purpose='TFA' LIMIT 1", [tfaToken]);
    const row = (rows as any[])[0];
    if (!row) return res.status(400).json({ success: false, message: "Invalid token" });
    if (row.usedAt) return res.status(400).json({ success: false, message: "Token already used" });
    if (new Date(row.expiresAt) < new Date()) return res.status(400).json({ success: false, message: "Token expired" });

    const [userRows] = await pool.query(
      "SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified,totpEnabled,totpSecret FROM users WHERE id=? LIMIT 1",
      [row.userId]
    );
    const user = (userRows as any[])[0];
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const isValid = user.totpSecret ? authenticator.check(code.trim(), user.totpSecret) : false;
    if (!isValid) return res.status(400).json({ success: false, message: "Invalid code" });

    await pool.query("UPDATE login_otps SET usedAt=NOW() WHERE id=?", [row.id]);
    await pool.query('UPDATE users SET lastSeen=NOW(), status=? WHERE id=?', ['online', user.id]);
    user.twoFactorEnabled = Boolean(user.totpEnabled);
    const moderation = await fetchModerationState(user.id);
    const token = user.id;
    return res.json({ success: true, data: { token, user, moderation } });
  } catch (err) {
    console.error("[auth] 2fa login failed", err);
    return res.status(500).json({ success: false, message: "2FA verification failed" });
  }
});

router.post("/resend-otp", async (req, res) => {
  const { otpToken } = req.body as { otpToken?: string };
  if (!otpToken) return res.status(400).json({ success: false, message: "Missing token" });
  try {
    const [otpRows] = await pool.query("SELECT userId FROM login_otps WHERE token=? LIMIT 1", [otpToken]);
    const otpRow = (otpRows as any[])[0];
    const userId = otpRow?.userId;
    const { otpToken: newToken, code } = await resendLoginOtp(otpToken, req.ip);

    if (userId) {
      const [userRows] = await pool.query("SELECT email FROM users WHERE id=? LIMIT 1", [userId]);
      const emailRow = (userRows as any[])[0];
      if (emailRow?.email) {
        (async () => {
          try {
            await sendLoginCodeEmail(emailRow.email, code);
          } catch (err) {
            console.error("[auth] resend OTP email failed", err);
          }
        })();
      }
    }
    return res.json({ success: true, data: { otpToken: newToken } });
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg === "RATE_LIMIT_MINUTE") return res.status(429).json({ success: false, message: "Please wait before resending." });
    if (msg === "RATE_LIMIT_HOURLY") return res.status(429).json({ success: false, message: "Too many requests. Try again later." });
    return res.status(400).json({ success: false, message: "Unable to resend code right now." });
  }
});

router.post("/complete-profile", async (req, res) => {
  const { profileToken, username, password } = req.body as { profileToken?: string; username?: string; password?: string };
  if (!profileToken || !username || !password) return res.status(400).json({ success: false, message: "Missing fields" });
  try {
    const [rows] = await pool.query(
      "SELECT * FROM login_otps WHERE token=? AND purpose='PROFILE' LIMIT 1",
      [profileToken]
    );
    const row = (rows as any[])[0];
    if (!row) return res.status(400).json({ success: false, message: "Invalid profile token" });
    if (row.usedAt) return res.status(400).json({ success: false, message: "Profile token already used" });
    if (new Date(row.expiresAt) < new Date()) return res.status(400).json({ success: false, message: "Profile token expired" });

    const uniqueUsername = await ensureUniqueUsername(username);
    const [existingUsername] = await pool.query("SELECT id FROM users WHERE username=? AND id<>?", [uniqueUsername, row.userId]);
    if ((existingUsername as any[]).length) {
      return res.status(409).json({ success: false, message: "Username taken" });
    }

    await pool.query("UPDATE users SET username=?, displayName=?, passwordHash=?, emailVerified=1, updatedAt=NOW() WHERE id=?", [
      uniqueUsername,
      uniqueUsername,
      password,
      row.userId,
    ]);
    await pool.query("UPDATE login_otps SET usedAt=NOW() WHERE id=?", [row.id]);

    const [userRows] = await pool.query(
      "SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified,totpEnabled FROM users WHERE id=? LIMIT 1",
      [row.userId]
    );
    const user = (userRows as any[])[0];
    if (user) user.twoFactorEnabled = Boolean(user.totpEnabled);
    const moderation = await fetchModerationState(user.id);
    const token = user.id;
    return res.json({ success: true, data: { token, user, moderation } });
  } catch (err) {
    console.error("[auth] complete-profile failed", err);
    return res.status(500).json({ success: false, message: "Unable to complete profile" });
  }
});

const APP_BASE_URL = (process.env.APP_BASE_URL || "https://pasus.site").replace(/\/$/, "");
const API_BASE_URL = (process.env.API_BASE_URL || process.env.APP_API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");

const upsertOauthUser = async (opts: { email: string; name?: string; avatar?: string; provider: "google" | "github" }) => {
  const { email, name, avatar, provider } = opts;
  if (!email) throw new Error("EMAIL_REQUIRED");
  const [rows] = await pool.query(
    "SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified FROM users WHERE email=? LIMIT 1",
    [email]
  );
  let user = (rows as any[])[0];
  if (!user) {
    const id = uuid();
    const base = (name || email.split("@")[0] || "user").replace(/[^\w]/g, "");
    const username = await ensureUniqueUsername(base || `user_${Date.now()}`);
    const avatarUrl = avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
    await pool.query(
      'INSERT INTO users (id,email,username,displayName,role,isPremium,passwordHash,status,bio,avatarUrl,accountStatus,lastSeen,createdAt,updatedAt,emailVerified) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),NOW(),?)',
      [id, email, username, name || username, 'USER', 0, `oauth:${provider}:${crypto.randomUUID()}`, 'online', null, avatarUrl, 'good', 1]
    );
    await pool.query(
      'INSERT INTO moderation_statuses (userId,currentStage,updatedAt) VALUES (?,?,NOW()) ON DUPLICATE KEY UPDATE currentStage=currentStage',
      [id, 'NONE']
    );
    const [freshRows] = await pool.query(
      "SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified FROM users WHERE id=?",
      [id]
    );
    user = (freshRows as any[])[0];
  } else {
    await pool.query(
      "UPDATE users SET avatarUrl=?, displayName=?, emailVerified=1, lastSeen=NOW(), status='online', updatedAt=NOW() WHERE id=?",
      [avatar || user.avatarUrl, name || user.displayName, user.id]
    );
    user = {
      ...user,
      avatarUrl: avatar || user.avatarUrl,
      displayName: name || user.displayName,
      emailVerified: true,
      status: 'online',
      lastSeen: new Date().toISOString(),
    };
  }
  const moderation = await fetchModerationState(user.id);
  return { user, moderation };
};

const redirectWithUser = async (res: any, user: any, moderation: any) => {
  const token = user.id;
  const payload = Buffer.from(JSON.stringify({ token, user, moderation })).toString("base64url");
  const profileToken = await issueProfileToken(user.id);
  const target = `${APP_BASE_URL}/?oauthToken=${encodeURIComponent(token)}&oauthUser=${encodeURIComponent(payload)}&profileToken=${encodeURIComponent(profileToken)}`;
  return res.redirect(target);
};

router.get("/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = (process.env.GOOGLE_REDIRECT_URI || `${API_BASE_URL}/api/auth/google/callback`).replace(/\/$/, "");
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ success: false, message: "Google OAuth not configured" });
  }
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  return res.redirect(authUrl.toString());
});

router.get("/google/callback", async (req, res) => {
  const code = (req.query as any)?.code;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = (process.env.GOOGLE_REDIRECT_URI || `${API_BASE_URL}/api/auth/google/callback`).replace(/\/$/, "");
  if (!code || !clientId || !clientSecret) {
    return res.status(400).json({ success: false, message: "Google OAuth not configured" });
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code.toString(),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenJson: any = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) throw new Error("Token exchange failed");

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile: any = await profileRes.json();
    const { user, moderation } = await upsertOauthUser({
      email: profile.email,
      name: profile.name || profile.given_name,
      avatar: profile.picture,
      provider: "google",
    });
    return redirectWithUser(res, user, moderation);
  } catch (err) {
    console.error("[auth] Google OAuth failed", err);
    return res.status(500).json({ success: false, message: "Google sign-in failed" });
  }
});

router.get("/github", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = (process.env.GITHUB_REDIRECT_URI || `${API_BASE_URL}/api/auth/github/callback`).replace(/\/$/, "");
  if (!clientId || !process.env.GITHUB_CLIENT_SECRET) {
    return res.status(503).json({ success: false, message: "GitHub OAuth not configured" });
  }
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "read:user user:email");
  return res.redirect(authUrl.toString());
});

router.get("/github/callback", async (req, res) => {
  const code = (req.query as any)?.code;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = (process.env.GITHUB_REDIRECT_URI || `${API_BASE_URL}/api/auth/github/callback`).replace(/\/$/, "");
  if (!code || !clientId || !clientSecret) {
    return res.status(400).json({ success: false, message: "GitHub OAuth not configured" });
  }
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({
        code: code.toString(),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    const tokenJson: any = await tokenRes.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) throw new Error("Token exchange failed");

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "pasus-app" },
    });
    const profile: any = await userRes.json();
    let email = profile.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "pasus-app" },
      });
      const emails: any[] = await emailsRes.json();
      const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0];
      email = primary?.email;
    }
    const { user, moderation } = await upsertOauthUser({
      email,
      name: profile.name || profile.login,
      avatar: profile.avatar_url,
      provider: "github",
    });
    return redirectWithUser(res, user, moderation);
  } catch (err) {
    console.error("[auth] GitHub OAuth failed", err);
    return res.status(500).json({ success: false, message: "GitHub sign-in failed" });
  }
});


// Heartbeat to mark presence
router.post("/ping", async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) return res.status(400).json({ success: false, message: "Missing userId" });
  try {
    await pool.query('UPDATE users SET lastSeen=NOW() WHERE id=?', [userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    if (ALLOW_MOCKS) {
      // Fallback: succeed silently when DB unavailable
      return res.json({ success: true });
    }
    return res.status(500).json({ success: false, message: "Database error" });
  }
});

// Admin status update (simple admin code)
let adminCodeUsed = false;
let activeAdminCode: string | null = null;
const ADMIN_MASTER = process.env.ADMIN_MASTER || '';

// Generate a one-time admin code (requires master)
router.post('/admin/generate', async (req, res) => {
  const { master } = req.body as { master?: string };
  if (!ADMIN_MASTER) return res.status(403).json({ success: false, message: 'ADMIN_MASTER not configured' });
  if (master !== ADMIN_MASTER) return res.status(401).json({ success: false, message: 'Invalid master code' });
  activeAdminCode = uuid();
  adminCodeUsed = false;
  return res.json({ success: true, code: activeAdminCode });
});

router.post('/admin/status', async (req, res) => {
  const { adminCode, userId, status } = req.body as { adminCode?: string; userId?: string; status?: 'good' | 'warned' | 'banned' };
  if (!ADMIN_MASTER) return res.status(403).json({ success: false, message: 'ADMIN_MASTER not configured' });
  if (!activeAdminCode || adminCode !== activeAdminCode) return res.status(401).json({ success: false, message: 'Invalid admin code' });
  if (adminCodeUsed) return res.status(403).json({ success: false, message: 'Admin code already used this session' });
  if (!userId || !status) return res.status(400).json({ success: false, message: 'Missing userId or status' });
  try {
    await pool.query('UPDATE users SET accountStatus=? WHERE id=?', [status, userId]);
    adminCodeUsed = true;
    activeAdminCode = null;
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

export default router;
