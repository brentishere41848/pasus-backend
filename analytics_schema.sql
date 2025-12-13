-- Analytics schema for Pasus (idempotent, MySQL)
-- Message events + aggregates to power Wrapped and server insights.

CREATE TABLE IF NOT EXISTS message_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(191) NOT NULL,
  server_id VARCHAR(191) NULL,
  channel_id VARCHAR(191) NOT NULL,
  is_dm BOOLEAN NOT NULL DEFAULT FALSE,
  dm_partner_id VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  INDEX idx_message_events_user_day (user_id, created_at),
  INDEX idx_message_events_server_day (server_id, created_at),
  INDEX idx_message_events_channel_day (channel_id, created_at),
  INDEX idx_message_events_dm_partner (user_id, dm_partner_id, created_at)
);

CREATE TABLE IF NOT EXISTS stats_user_daily (
  user_id VARCHAR(191) NOT NULL,
  day DATE NOT NULL,
  messages_total INT NOT NULL,
  messages_dm INT NOT NULL,
  messages_server INT NOT NULL,
  servers_touched INT NOT NULL,
  channels_touched INT NOT NULL,
  PRIMARY KEY (user_id, day),
  INDEX idx_stats_daily_day (day)
);

CREATE TABLE IF NOT EXISTS stats_user_contact_yearly (
  user_id VARCHAR(191) NOT NULL,
  year INT NOT NULL,
  contact_id VARCHAR(191) NOT NULL,
  message_count INT NOT NULL,
  PRIMARY KEY (user_id, year, contact_id),
  INDEX idx_stats_contact_year (year)
);

CREATE TABLE IF NOT EXISTS stats_user_server_yearly (
  user_id VARCHAR(191) NOT NULL,
  year INT NOT NULL,
  server_id VARCHAR(191) NOT NULL,
  message_count INT NOT NULL,
  PRIMARY KEY (user_id, year, server_id),
  INDEX idx_stats_server_year (year)
);

CREATE TABLE IF NOT EXISTS wrapped_snapshots (
  user_id VARCHAR(191) NOT NULL,
  year INT NOT NULL,
  total_messages INT NOT NULL,
  top_contacts JSON NOT NULL,
  top_servers JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, year),
  INDEX idx_wrapped_year (year)
);

-- Optional per-user opt-out flag (safe to rerun)
ALTER TABLE users ADD COLUMN IF NOT EXISTS analytics_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
