import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";
import { fetchModerationState } from "../middleware/auth.js";

console.debug("[PasusDebug:backend/src/routes/users] Loaded");

const router = Router();

// GET /api/users/:userId/profile
router.get("/:userId/profile", async (req, res) => {
    const { userId } = req.params;
    try {
        const [rows] = await pool.query(
            'SELECT id, username, displayName, avatarUrl, bio, status, lastSeen, createdAt, isPremium, role FROM users WHERE id = ?',
            [userId]
        );
        const users = rows as any[];
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        return res.json({ success: true, data: users[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

// POST /api/users/:userId/friends
// Adds a friend request or accepts one. For simplicity, we'll implement direct adding for now
// In a real app, this would be a request system (status: pending -> accepted)
router.post("/:userId/friends", async (req, res) => {
    const { userId } = req.params;
    const { friendId } = req.body;

    if (!friendId) {
        return res.status(400).json({ success: false, message: "Missing friendId" });
    }

    try {
        // Check if user exists
        const [userCheck] = await pool.query('SELECT id FROM users WHERE id = ?', [friendId]);
        if ((userCheck as any[]).length === 0) {
            return res.status(404).json({ success: false, message: "Friend user not found" });
        }

        // Check if already friends
        const [existing] = await pool.query(
            'SELECT * FROM friends WHERE (userA = ? AND userB = ?) OR (userA = ? AND userB = ?)',
            [userId, friendId, friendId, userId]
        );

        if ((existing as any[]).length > 0) {
            return res.status(409).json({ success: false, message: "Already friends" });
        }

        // Add friendship
        await pool.query(
            'INSERT INTO friends (id, userA, userB, status, createdAt) VALUES (?, ?, ?, ?, NOW())',
            [uuid(), userId, friendId, 'accepted']
        );

        return res.json({ success: true, message: "Friend added" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

// GET /api/users/:userId/friends
router.get("/:userId/friends", async (req, res) => {
    const { userId } = req.params;
    try {
        const [rows] = await pool.query(`
            SELECT u.id, u.username, u.displayName, u.avatarUrl, u.status, u.bio
            FROM friends f
            JOIN users u ON (CASE WHEN f.userA = ? THEN f.userB ELSE f.userA END) = u.id
            WHERE (f.userA = ? OR f.userB = ?) AND f.status = 'accepted'
        `, [userId, userId, userId]);

        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

// DELETE /api/users/:userId/friends/:friendId
router.delete("/:userId/friends/:friendId", async (req, res) => {
    const { userId, friendId } = req.params;
    try {
        await pool.query(
            'DELETE FROM friends WHERE (userA = ? AND userB = ?) OR (userA = ? AND userB = ?)',
            [userId, friendId, friendId, userId]
        );
        return res.json({ success: true, message: "Friend removed" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Database error" });
    }
});


// GET /api/users/search?q=query
router.get("/search", async (req, res) => {
    const { q } = req.query as { q?: string };
    if (!q) return res.json({ success: true, data: [] });

    try {
        // Allow search by username, display name, or exact userId
        const like = `%${q}%`;
        const [rows] = await pool.query(
            "SELECT id, username, displayName, avatarUrl, bio FROM users WHERE id = ? OR username LIKE ? OR displayName LIKE ? LIMIT 20",
            [q, like, like]
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

export default router;
