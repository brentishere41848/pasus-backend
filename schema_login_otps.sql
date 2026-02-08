CREATE TABLE IF NOT EXISTS login_otps (
  id VARCHAR(191) PRIMARY KEY,
  token VARCHAR(191) NOT NULL UNIQUE,
  userId VARCHAR(191) NOT NULL,
  codeHash VARCHAR(255) NOT NULL,
  purpose VARCHAR(50) NOT NULL DEFAULT 'LOGIN',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiresAt DATETIME NOT NULL,
  usedAt DATETIME,
  attemptCount INT NOT NULL DEFAULT 0,
  lastSentAt DATETIME,
  resendCount INT NOT NULL DEFAULT 0,
  ipAddress VARCHAR(64),
  INDEX idx_loginotp_user (userId),
  INDEX idx_loginotp_created (createdAt),
  CONSTRAINT fk_loginotp_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
