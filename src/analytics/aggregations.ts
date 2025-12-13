import { Pool } from "mysql2/promise";
import { pool } from "../db.js";
import { isAnalyticsEnabled } from "./events.js";

console.debug("[PasusDebug:backend/src/analytics/aggregations] Loaded");
const DATE_FMT = (d: Date) => d.toISOString().slice(0, 23).replace("T", " ");

const yearBoundsUtc = (year: number) => {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
  return { start, end };
};

export async function aggregateUserDaily(
  day?: Date,
  db: Pool = pool
) {
  if (!isAnalyticsEnabled()) return;
  const target = day
    ? new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))
    : new Date(Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate() - 1
      ));

  const start = target;
  const end = new Date(target.getTime() + 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO stats_user_daily
     (user_id, day, messages_total, messages_dm, messages_server, servers_touched, channels_touched)
     SELECT
       user_id,
       DATE(CONVERT_TZ(created_at, '+00:00', '+00:00')) AS day,
       COUNT(*) AS messages_total,
       SUM(CASE WHEN is_dm THEN 1 ELSE 0 END) AS messages_dm,
       SUM(CASE WHEN is_dm THEN 0 ELSE 1 END) AS messages_server,
       COUNT(DISTINCT server_id) AS servers_touched,
       COUNT(DISTINCT channel_id) AS channels_touched
     FROM message_events
     WHERE created_at >= ? AND created_at < ?
     GROUP BY user_id, DATE(CONVERT_TZ(created_at, '+00:00', '+00:00'))
     ON DUPLICATE KEY UPDATE
       messages_total = VALUES(messages_total),
       messages_dm = VALUES(messages_dm),
       messages_server = VALUES(messages_server),
       servers_touched = VALUES(servers_touched),
       channels_touched = VALUES(channels_touched)`,
    [DATE_FMT(start), DATE_FMT(end)]
  );
}

export async function aggregateUserContactYearly(
  year: number,
  db: Pool = pool
) {
  if (!isAnalyticsEnabled()) return;
  const { start, end } = yearBoundsUtc(year);
  await db.query(
    `INSERT INTO stats_user_contact_yearly (user_id, year, contact_id, message_count)
     SELECT user_id,
            YEAR(CONVERT_TZ(created_at, '+00:00', '+00:00')) AS year,
            dm_partner_id AS contact_id,
            COUNT(*) AS message_count
     FROM message_events
     WHERE is_dm = TRUE
       AND created_at >= ? AND created_at < ?
     GROUP BY user_id, YEAR(CONVERT_TZ(created_at, '+00:00', '+00:00')), dm_partner_id
     ON DUPLICATE KEY UPDATE message_count = message_count + VALUES(message_count)`,
    [DATE_FMT(start), DATE_FMT(end)]
  );
}

export async function aggregateUserServerYearly(
  year: number,
  db: Pool = pool
) {
  if (!isAnalyticsEnabled()) return;
  const { start, end } = yearBoundsUtc(year);
  await db.query(
    `INSERT INTO stats_user_server_yearly (user_id, year, server_id, message_count)
     SELECT user_id,
            YEAR(CONVERT_TZ(created_at, '+00:00', '+00:00')) AS year,
            server_id,
            COUNT(*) AS message_count
     FROM message_events
     WHERE is_dm = FALSE
       AND created_at >= ? AND created_at < ?
     GROUP BY user_id, YEAR(CONVERT_TZ(created_at, '+00:00', '+00:00')), server_id
     ON DUPLICATE KEY UPDATE message_count = message_count + VALUES(message_count)`,
    [DATE_FMT(start), DATE_FMT(end)]
  );
}

export interface WrappedRow {
  totalMessages: number;
  topContacts: { id: string; messageCount: number }[];
  topServers: { id: string; messageCount: number }[];
}

export async function buildWrappedSnapshotForUser(
  userId: string,
  year: number,
  options: { persist?: boolean; db?: Pool } = {}
): Promise<WrappedRow | null> {
  if (!isAnalyticsEnabled()) return null;
  const db = options.db || pool;
  const { start, end } = yearBoundsUtc(year);

  const [totalsRows] = await db.query(
    `SELECT SUM(messages_total) as total
     FROM stats_user_daily
     WHERE user_id=? AND day >= ? AND day < ?`,
    [userId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
  );
  const totalMessages = Number((totalsRows as any[])[0]?.total || 0);

  const [contactsRows] = await db.query(
    `SELECT contact_id as id, message_count AS messageCount
     FROM stats_user_contact_yearly
     WHERE user_id=? AND year=?
     ORDER BY messageCount DESC
     LIMIT 5`,
    [userId, year]
  );

  const [serversRows] = await db.query(
    `SELECT server_id as id, message_count AS messageCount
     FROM stats_user_server_yearly
     WHERE user_id=? AND year=?
     ORDER BY messageCount DESC
     LIMIT 5`,
    [userId, year]
  );

  const payload: WrappedRow = {
    totalMessages,
    topContacts: (contactsRows as any[]).map((r) => ({
      id: r.id,
      messageCount: Number(r.messageCount),
    })),
    topServers: (serversRows as any[]).map((r) => ({
      id: r.id,
      messageCount: Number(r.messageCount),
    })),
  };

  if (options.persist) {
    await db.query(
      `INSERT INTO wrapped_snapshots (user_id, year, total_messages, top_contacts, top_servers, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         total_messages = VALUES(total_messages),
         top_contacts = VALUES(top_contacts),
         top_servers = VALUES(top_servers),
         created_at = VALUES(created_at)`,
      [
        userId,
        year,
        payload.totalMessages,
        JSON.stringify(payload.topContacts),
        JSON.stringify(payload.topServers),
        DATE_FMT(new Date()),
      ]
    );
  }

  return payload;
}

export async function buildWrappedSnapshotsForYear(
  year: number,
  db: Pool = pool
) {
  if (!isAnalyticsEnabled()) return;
  const [usersRows] = await db.query(
    `SELECT DISTINCT user_id
     FROM stats_user_daily
     WHERE day >= ? AND day < ?`,
    [
      `${year}-01-01`,
      `${year + 1}-01-01`
    ]
  );

  for (const row of usersRows as any[]) {
    await buildWrappedSnapshotForUser(row.user_id, year, {
      persist: true,
      db,
    });
  }
}
