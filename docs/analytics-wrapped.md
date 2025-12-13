# Pasus Analytics / Wrapped

## Schema (MySQL)
- `message_events`: raw immutable stream for every sent message (user_id, server_id, channel_id, is_dm, dm_partner_id, created_at).
- `stats_user_daily`: per-user daily rollup (totals, dm/server splits, distinct servers/channels).
- `stats_user_contact_yearly`: per-user per-contact yearly totals (DM only).
- `stats_user_server_yearly`: per-user per-server yearly totals (server messages only).
- `wrapped_snapshots`: cached yearly payload (`total_messages`, `top_contacts`, `top_servers` JSON arrays) for fast `/api/wrapped/:year`.

Run `mysql < analytics_schema.sql` to create/update tables (idempotent).

## Recording events
Message persistence should go through `createChannelMessage` (or call `recordMessageEvent` directly for DMs):
- `src/services/messages.ts#createChannelMessage` inserts into `channel_messages` and writes a `message_events` row in one transaction.
- `recordDmMessageEvent` can be used by any DM persistence layer to emit the analytics event.
- Existing welcome messages created via server invites have been switched to `createChannelMessage`, so they now emit analytics events too.
- Per-user opt-out: set `users.analytics_opt_out=1` and `ANALYTICS_RESPECT_OPT_OUT=true` to skip recording for that user (cached for 5 minutes).

## Aggregation jobs
Located in `src/analytics/aggregations.ts` and `src/jobs/analytics.ts`.
- Daily: `aggregateUserDaily(day?)` (defaults to yesterday UTC) populates `stats_user_daily`.
- Yearly: `aggregateUserContactYearly(year)` and `aggregateUserServerYearly(year)` roll up DM contacts and servers.
- Wrapped snapshots: `buildWrappedSnapshotsForYear(year)` materializes top contacts/servers and totals into `wrapped_snapshots`.

Scheduling:
- Set `ANALYTICS_JOBS_ENABLED=true` and the server will run daily + yearly + wrapped jobs on startup and every 24h.
- Manual runs:
  - `npm run analytics:daily`
  - `npm run analytics:yearly -- 2026`
  - `npm run analytics:wrapped -- 2026`
- Example cron wrapper: `scripts/cron/analytics.sh` (02:00 UTC recommended).
- One-off backfill from historical `channel_messages`: `npm run backfill:messages` (idempotent-ish via nearest-second match).
- Kubernetes example: `scripts/cron/analytics-cronjob.yaml` runs daily at 02:00 UTC using the built backend image; inject DB credentials via Secret `pasus-db` (keys: host, user, password, name).
- systemd example: `scripts/systemd/pasus-analytics.service` + `pasus-analytics.timer` (runs 02:00 UTC). Set `WorkingDirectory` and `User/Group` to your host paths/users, enable with `systemctl enable --now pasus-analytics.timer`.

Feature flagging: `ANALYTICS_ENABLED=false` will no-op all recording/aggregation.

## Wrapped API
`GET /api/wrapped/:year` (requires auth stub) returns:
```json
{
  "success": true,
  "data": {
    "totalMessages": 123,
    "topContacts": [{ "id": "user-2", "messageCount": 45 }],
    "topServers": [{ "id": "server-1", "messageCount": 60 }]
  }
}
```
- If a snapshot exists, it is served; otherwise the backend computes on demand from aggregate tables and saves it.

## Privacy / Opt-out hooks
- All queries are scoped to the authenticated user.
- Analytics pipeline is gated by `ANALYTICS_ENABLED`; per-user opt-out can be wired by skipping event recording for that user before calling `recordMessageEvent`.
