import { Pool, PoolConnection } from "mysql2/promise";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";
import { recordMessageEvent } from "../analytics/events.js";

console.debug("[PasusDebug:backend/src/services/messages] Loaded");
interface ChannelMessageInput {
  channelId: string;
  senderId: string;
  body: string;
  createdAt?: Date;
  serverId?: string | null;
}

type PoolLike = Pool | PoolConnection;

const asDateTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/**
 * Insert a channel message and emit a message_event in the same transaction.
 */
export async function createChannelMessage(
  input: ChannelMessageInput,
  db: Pool | PoolConnection = pool
) {
  // Support callers that pass either a Pool (typical) or an already-checked-out connection.
  const isPool = typeof (db as Pool).getConnection === "function";
  const conn = isPool ? await (db as Pool).getConnection() : (db as PoolConnection);
  const shouldRelease = isPool; // only release when we grabbed it
  const createdAt = input.createdAt || new Date();
  const messageId = uuid();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO channel_messages (id, channelId, senderId, body, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [messageId, input.channelId, input.senderId, input.body, asDateTime(createdAt)]
    );

    await recordMessageEvent(
      {
        userId: input.senderId,
        channelId: input.channelId,
        serverId: input.serverId,
        isDm: false,
        createdAt,
      },
      conn
    );

    await conn.commit();
    return { id: messageId, createdAt };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    if (shouldRelease) conn.release();
  }
}

/**
 * Utility used by tests to simulate a DM message event without needing
 * a dedicated DM persistence layer in this codebase.
 */
export async function recordDmMessageEvent(
  params: { senderId: string; conversationId: string; partnerId: string; createdAt?: Date },
  db: PoolLike = pool
) {
  const createdAt = params.createdAt || new Date();
  await recordMessageEvent(
    {
      userId: params.senderId,
      channelId: params.conversationId,
      isDm: true,
      dmPartnerId: params.partnerId,
      serverId: null,
      createdAt,
    },
    db
  );
}
