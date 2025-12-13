import { Pool, PoolConnection } from "mysql2/promise";
import { pool } from "../db.js";

console.debug("[PasusDebug:backend/src/analytics/events] Loaded");
const ANALYTICS_ENABLED = process.env.ANALYTICS_ENABLED !== "false";
const RESPECT_OPT_OUT = process.env.ANALYTICS_RESPECT_OPT_OUT === "true";

export interface MessageEventInput {
  userId: string;
  channelId: string;
  isDm: boolean;
  dmPartnerId?: string | null;
  serverId?: string | null;
  createdAt?: Date;
}

type Queryable = Pick<Pool, "query"> & Partial<Pick<Pool, "getConnection">>;

const formatDate = (d: Date) =>
  d.toISOString().slice(0, 23).replace("T", " ");

async function resolveServerId(
  channelId: string,
  db: Pool | PoolConnection
): Promise<string | null> {
  try {
    const [rows] = await db.query(
      "SELECT serverId FROM channels WHERE id=? LIMIT 1",
      [channelId]
    );
    const row = (rows as any[])[0];
    return row?.serverId || null;
  } catch {
    return null;
  }
}

const optOutCache = new Map<string, { value: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function isUserOptedOut(
  userId: string,
  db: Pool | PoolConnection
): Promise<boolean> {
  if (!RESPECT_OPT_OUT) return false;
  const cached = optOutCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const [rows] = await db.query(
      "SELECT analytics_opt_out FROM users WHERE id=? LIMIT 1",
      [userId]
    );
    const val = Boolean((rows as any[])[0]?.analytics_opt_out);
    optOutCache.set(userId, { value: val, expiresAt: now + CACHE_TTL_MS });
    return val;
  } catch {
    return false;
  }
}

/**
 * Record a single message_sent event into message_events.
 * Safe to call inside an existing transaction by passing the same connection.
 */
export async function recordMessageEvent(
  params: MessageEventInput,
  db: Pool | PoolConnection = pool
) {
  if (!ANALYTICS_ENABLED) return;
  if (await isUserOptedOut(params.userId, db)) return;

  const createdAt = params.createdAt || new Date();
  const serverId =
    params.serverId === undefined
      ? await resolveServerId(params.channelId, db)
      : params.serverId;

  await db.query(
    `INSERT INTO message_events (user_id, server_id, channel_id, is_dm, dm_partner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      serverId,
      params.channelId,
      params.isDm ? 1 : 0,
      params.dmPartnerId || null,
      formatDate(createdAt),
    ]
  );
}

export function isAnalyticsEnabled() {
  return ANALYTICS_ENABLED;
}

export function isOptOutRespected() {
  return RESPECT_OPT_OUT;
}
