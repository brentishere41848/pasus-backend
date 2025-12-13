-- One-time access codes for registration
CREATE TABLE IF NOT EXISTS access_codes (
  code VARCHAR(128) PRIMARY KEY,
  email VARCHAR(255),
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiresAt DATETIME,
  used TINYINT(1) NOT NULL DEFAULT 0,
  usedAt DATETIME,
  notes VARCHAR(255)
);
