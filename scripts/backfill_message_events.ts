import { pool } from "../src/db.js";

console.debug("[PasusDebug:backend/scripts/backfill_message_events] Loaded");
const BATCH_SIZE = 5000;

async function backfillChannelMessages() {
  console.log("Starting backfill from channel_messages -> message_events");
  let offset = 0;
  let totalInserted = 0;
  while (true) {
    const [rows] = await pool.query(
      `SELECT id, channelId, senderId, createdAt
       FROM channel_messages
       ORDER BY createdAt
       LIMIT ? OFFSET ?`,
      [BATCH_SIZE, offset]
    );
    const batch = rows as any[];
    if (!batch.length) break;

    const selects: string[] = [];
    const values: any[] = [];
    for (const r of batch) {
      selects.push("SELECT ? AS user_id, ? AS server_id, ? AS channel_id, ? AS is_dm, ? AS dm_partner_id, ? AS created_at");
      values.push(
        r.senderId,
        null,
        r.channelId,
        0,
        null,
        new Date(r.createdAt).toISOString().slice(0, 23).replace("T", " ")
      );
    }

    // Avoid duplicate inserts by skipping rows that already have a near-matching event
    // (same user/channel within 1 second).
    await pool.query(
      `INSERT INTO message_events
         (user_id, server_id, channel_id, is_dm, dm_partner_id, created_at)
       SELECT v.user_id, v.server_id, v.channel_id, v.is_dm, v.dm_partner_id, v.created_at
       FROM (
         ${selects.join(" UNION ALL ")}
       ) AS v
       WHERE NOT EXISTS (
         SELECT 1 FROM message_events me
         WHERE me.user_id = v.user_id
           AND me.channel_id = v.channel_id
           AND ABS(TIMESTAMPDIFF(SECOND, me.created_at, v.created_at)) <= 1
       )`,
      values
    );

    totalInserted += batch.length;
    offset += BATCH_SIZE;
    console.log(`Processed ${offset} rows...`);
  }
  console.log("Backfill complete. Rows processed:", offset);
}

backfillChannelMessages()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
