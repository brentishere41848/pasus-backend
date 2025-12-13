USE u606616126_databasepasus;
CREATE TABLE IF NOT EXISTS forum_posts (
  id VARCHAR(191) PRIMARY KEY,
  authorId VARCHAR(191) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  tags JSON,
  likes INT NOT NULL DEFAULT 0,
  dislikes INT NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_forum_author (authorId)
);
CREATE TABLE IF NOT EXISTS forum_comments (
  id VARCHAR(191) PRIMARY KEY,
  postId VARCHAR(191) NOT NULL,
  authorId VARCHAR(191) NOT NULL,
  content TEXT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_forum_post (postId),
  INDEX idx_forum_author (authorId)
);
