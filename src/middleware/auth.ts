import { Request, Response, NextFunction } from "express";
import { pool } from "../db.js";

console.debug("[PasusDebug:backend/src/middleware/auth] Loaded");
export interface AuthUser { id: string; role?: string }
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

// Dev-only auth stub: injects a demo user
/**
 * In local/dev we rely on a stubbed user. When a real database is available
 * we still need a corresponding row in `users` so that foreign key constraints
 * on channel_messages/server_memberships don't reject writes (which surfaced
 * as 403s when posting messages).
 */
let ensuredDemoUser = false;

const ensureDemoUserExists = async (userId: string) => {
  if (ensuredDemoUser) return;
  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE id=? LIMIT 1', [userId]);
    if ((rows as any[]).length) {
      ensuredDemoUser = true;
      return;
    }
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.query(
      `INSERT IGNORE INTO users (id,email,username,displayName,avatarUrl,status,role,isPremium,accountStatus,lastSeen,createdAt,updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        userId,
        'demo@pasus.local',
        'demo-user',
        'Demo User',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=DemoUser',
        'online',
        'OWNER',
        0,
        'good',
        now,
        now,
        now,
      ],
    );
    ensuredDemoUser = true;
  } catch (err) {
    // If DB is unreachable or has no users table we silently proceed; ALLOW_MOCKS
    // paths will handle fallback responses elsewhere.
    console.warn('Unable to ensure demo user exists', err);
  }
};

export const requireAuth = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  // Dev-friendly token: accept Bearer <userId>
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token) req.user = { id: token, role: 'member' };
  }

  if (!req.user) {
    req.user = { id: 'demo-user', role: 'owner' };
  }

  ensureDemoUserExists(req.user.id).finally(() => next());
};

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) req.user = { id: 'demo-user', role: 'owner' };
  next();
};

export const fetchModerationState = async (userId: string) => {
  try {
    const [rows] = await pool.query('SELECT currentStage, lastAction FROM moderation_statuses WHERE userId=?', [userId]);
    const row = (rows as any[])[0];
    return {
      stage: row?.currentStage || 'NONE',
      lastAction: row?.lastAction || null
    };
  } catch {
    return { stage: 'NONE', lastAction: null };
  }
};
