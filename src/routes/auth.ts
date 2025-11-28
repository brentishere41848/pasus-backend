import { Router } from "express";
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";
import { pool } from "../db.js";

dotenv.config();

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
      'INSERT INTO users (id,email,username,displayName,role,isPremium,passwordHash,status,bio,avatarUrl,accountStatus,lastSeen,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),NOW())',
      [id, email, username, username, 'USER', 0, password, 'online', null, avatar, 'good']
    );
    const [userRows] = await pool.query('SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt FROM users WHERE id=?', [id]);
    const user = (userRows as any[])[0];
    return res.json({ success: true, data: { token: 'session-placeholder', user } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Missing credentials" });
  }

  try {
    const [rows] = await pool.query('SELECT id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt FROM users WHERE email=? AND passwordHash=?', [email, password]);
    if (!(rows as any[]).length) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const user = (rows as any[])[0];
    if (user.accountStatus === 'banned') {
      return res.status(403).json({ success: false, message: "Account banned." });
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

    await pool.query('UPDATE users SET lastSeen=NOW(), status=? WHERE id=?', ['online', user.id]);
    user.lastSeen = new Date().toISOString();
    return res.json({ success: true, data: { token: 'session-placeholder', user } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Database error' });
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
