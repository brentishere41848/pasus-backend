import { Router } from "express";
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";
import crypto from "crypto";
import { pool } from "../db.js";
import { fetchModerationState } from "../middleware/auth.js";
import { getReasonText } from "../shared/moderation.js";
import { resendClient, sendVerificationEmail } from "../services/resend.js";
import {
  createLoginOtp,
  resendLoginOtp,
  sendLoginCodeEmail,
  verifyLoginOtp,
  OTP_VERIFY_MAX_ATTEMPTS,
} from "../services/otp.js";

console.debug("[PasusDebug:backend/src/routes/auth] Loaded");
dotenv.config();
const ALLOW_MOCKS = process.env.ALLOW_MOCKS === 'true';

const router = Router();

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
    const [userRows] = await pool.query('SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt FROM users WHERE id=?', [id]);
    const user = (userRows as any[])[0];
    const moderation = await fetchModerationState(id);

    // queue verification email (15 min token) without blocking response
    (async () => {
      try {
        const token = uuid();
        const expires = new Date(Date.now() + 15 * 60 * 1000);
        await pool.query(
          "INSERT INTO email_verifications (id, userId, token, expiresAt, used) VALUES (?, ?, ?, ?, 0)",
          [uuid(), id, token, expires]
        );
        if (resendClient) {
          await sendVerificationEmail(email, token);
        } else {
          console.warn("[Pasus] RESEND_API_KEY not set; verification email not sent");
        }
      } catch (err) {
        console.warn("[Pasus] Failed to queue verification email", err);
      }
    })();

    return res.json({ success: true, data: { token: 'session-placeholder', user, moderation } });
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
      'SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified,passwordHash FROM users WHERE email=?',
      [email]
    );
    const user = (rows as any[])[0];
    let otpToken = uuid(); // opaque token even when credentials fail (avoid enumeration)

    if (user && user.passwordHash === password) {
      const moderation = await fetchModerationState(user.id);
      if (moderation.stage === 'TERMINATED') {
        // Keep response generic to avoid leaking moderation status during login enumeration
        return res.json({ success: true, data: { requiresOtp: true, otpToken } });
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
      "SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt,emailVerified FROM users WHERE id=? LIMIT 1",
      [result.userId]
    );
    const user = (userRows as any[])[0];
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

const APP_BASE_URL = (process.env.APP_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const API_BASE_URL = (process.env.API_BASE_URL || process.env.APP_API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");

const ensureUniqueUsername = async (preferred: string) => {
  let candidate = preferred || `user${Date.now()}`;
  let n = 0;
  // safety cap
  while (n < 25) {
    const [rows] = await pool.query("SELECT id FROM users WHERE username=? LIMIT 1", [candidate]);
    if (!(rows as any[]).length) return candidate;
    n += 1;
    candidate = `${preferred}_${n}`;
  }
  return `${preferred}_${crypto.randomBytes(3).toString("hex")}`;
};

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

const redirectWithUser = (res: any, user: any, moderation: any) => {
  const token = user.id;
  const payload = Buffer.from(JSON.stringify({ token, user, moderation })).toString("base64url");
  const target = `${APP_BASE_URL}/?oauthToken=${encodeURIComponent(token)}&oauthUser=${encodeURIComponent(payload)}`;
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
