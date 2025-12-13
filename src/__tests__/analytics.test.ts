import { strict as assert } from "assert";
import { recordMessageEvent } from "../analytics/events.js";
import {
  aggregateUserDaily,
  buildWrappedSnapshotForUser,
} from "../analytics/aggregations.js";
import { createChannelMessage } from "../services/messages.js";

console.debug("[PasusDebug:backend/src/__tests__/analytics.test] Loaded");

class FakeConnection {
  public queries: { sql: string; params: any[] }[] = [];
  public responses: any[];
  public committed = false;
  public rolledBack = false;
  constructor(responses: any[] = []) {
    this.responses = responses;
  }
  async query(sql: string, params: any[] = []) {
    this.queries.push({ sql: sql.trim(), params });
    const next = this.responses.shift();
    return next ?? [[], []];
  }
  async beginTransaction() {}
  async commit() {
    this.committed = true;
  }
  async rollback() {
    this.rolledBack = true;
  }
  async release() {}
}

class FakePool extends FakeConnection {
  async getConnection() {
    return this;
  }
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

await test("recordMessageEvent falls back to channel server lookup", async () => {
  const fake = new FakePool([
    [[{ serverId: "server-1" }], []],
    [[], []],
  ]);
  await recordMessageEvent(
    {
      userId: "u1",
      channelId: "c1",
      isDm: false,
    },
    fake as any
  );
  assert.equal(fake.queries.length, 2);
  assert.ok(fake.queries[0].sql.toLowerCase().startsWith("select serverid"));
  assert.ok(
    fake.queries[1].sql.toLowerCase().startsWith("insert into message_events")
  );
  assert.equal(fake.queries[1].params[1], "server-1");
});

await test("createChannelMessage writes message and event in a transaction", async () => {
  const fake = new FakePool([[[], []], [[], []]]);
  await createChannelMessage(
    { channelId: "chan-1", senderId: "alice", body: "hi", serverId: "srv1" },
    fake as any
  );
  assert.equal(fake.queries.length, 2);
  assert.ok(fake.queries[0].sql.includes("channel_messages"));
  assert.ok(fake.queries[1].sql.includes("message_events"));
  assert.ok(fake.committed);
  assert.ok(!fake.rolledBack);
});

await test("aggregateUserDaily builds expected date window", async () => {
  const fake = new FakePool();
  const day = new Date(Date.UTC(2026, 0, 2));
  await aggregateUserDaily(day, fake as any);
  assert.equal(fake.queries.length, 1);
  const params = fake.queries[0].params;
  assert.equal(params[0], "2026-01-02 00:00:00.000");
  assert.equal(params[1], "2026-01-03 00:00:00.000");
});

await test("buildWrappedSnapshotForUser composes and persists payload", async () => {
  const fake = new FakePool([
    [[{ total: 42 }], []],
    [[{ id: "u2", messageCount: 30 }], []],
    [[{ id: "s1", messageCount: 12 }], []],
    [[], []],
  ]);
  const result = await buildWrappedSnapshotForUser("u1", 2026, {
    persist: true,
    db: fake as any,
  });
  assert.ok(result);
  assert.equal(result!.totalMessages, 42);
  assert.equal(result!.topContacts[0].id, "u2");
  assert.equal(result!.topServers[0].id, "s1");
  assert.ok(fake.queries[3].sql.includes("wrapped_snapshots"));
});
