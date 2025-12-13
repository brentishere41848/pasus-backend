import { pool } from '../src/db.js';

const sql = `
CREATE TABLE IF NOT EXISTS friends (
    id VARCHAR(36) PRIMARY KEY,
    userA VARCHAR(36) NOT NULL,
    userB VARCHAR(36) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userA) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (userB) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_friendship (userA, userB)
);

CREATE TABLE IF NOT EXISTS voice_participants (
    channelId VARCHAR(36) NOT NULL,
    userId VARCHAR(36) NOT NULL,
    peerId VARCHAR(100) NOT NULL,
    muted BOOLEAN DEFAULT FALSE,
    deafened BOOLEAN DEFAULT FALSE,
    joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    lastKeepAlive DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channelId, userId),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
`;

async function migrate() {
    console.log('Running migration...');
    const statements = sql.split(';').filter(s => s.trim());
    for (const statement of statements) {
        if (!statement.trim()) continue;
        try {
            await pool.query(statement);
            console.log('Executed:', statement.substring(0, 50) + '...');
        } catch (err: any) {
            console.error('Failed to execute:', statement.substring(0, 50) + '...', err.message);
        }
    }
    console.log('Migration complete.');
    process.exit(0);
}

migrate();
