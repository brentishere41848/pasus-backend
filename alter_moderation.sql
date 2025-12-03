-- MySQL migration for moderation + reports (idempotent)

-- Moderation status per user
CREATE TABLE IF NOT EXISTS moderation_statuses (
  userId VARCHAR(191) PRIMARY KEY,
  currentStage ENUM('NONE','WARNING_1','WARNING_2','WARNING_3','WARNING_4','TERMINATED') NOT NULL DEFAULT 'NONE',
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mod_status_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

-- Actions history
CREATE TABLE IF NOT EXISTS moderation_actions (
  id VARCHAR(191) PRIMARY KEY,
  userId VARCHAR(191) NOT NULL,
  moderatorId VARCHAR(191) NOT NULL,
  stage ENUM('NONE','WARNING_1','WARNING_2','WARNING_3','WARNING_4','TERMINATED') NOT NULL,
  reasonCode VARCHAR(100) NOT NULL,
  reasonText VARCHAR(255) NOT NULL,
  notes TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mod_user (userId),
  INDEX idx_mod_moderator (moderatorId),
  CONSTRAINT fk_mod_action_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mod_action_moderator FOREIGN KEY (moderatorId) REFERENCES users(id) ON DELETE CASCADE
);

-- User reports
CREATE TABLE IF NOT EXISTS user_reports (
  id VARCHAR(191) PRIMARY KEY,
  reporterId VARCHAR(191) NOT NULL,
  reportedUserId VARCHAR(191) NOT NULL,
  reasonCode VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  status ENUM('NEW','REVIEWED','DISMISSED') NOT NULL DEFAULT 'NEW',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_report_reported (reportedUserId),
  INDEX idx_report_reporter (reporterId),
  CONSTRAINT fk_report_reporter FOREIGN KEY (reporterId) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_user FOREIGN KEY (reportedUserId) REFERENCES users(id) ON DELETE CASCADE
);
