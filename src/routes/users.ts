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

// PUT /api/users/:userId — update basic profile fields
router.put("/:userId", async (req, res) => {
    const { userId } = req.params;
    const { displayName, avatarUrl, bio, email } = req.body as {
        displayName?: string;
        avatarUrl?: string;
        bio?: string;
        email?: string;
    };

    if (!displayName && !avatarUrl && !bio && !email) {
        return res.status(400).json({ success: false, message: "No fields to update" });
    }

    try {
        if (email) {
            const [conflict] = await pool.query('SELECT id FROM users WHERE email=? AND id<>? LIMIT 1', [email, userId]);
            if ((conflict as any[]).length) {
                return res.status(409).json({ success: false, message: "Email already in use" });
            }
        }

        const sets: string[] = [];
        const params: any[] = [];
        if (displayName) { sets.push('displayName=?'); params.push(displayName); }
        if (avatarUrl !== undefined) { sets.push('avatarUrl=?'); params.push(avatarUrl); }
        if (bio !== undefined) { sets.push('bio=?'); params.push(bio); }
        if (email) { sets.push('email=?'); params.push(email); }
        if (!sets.length) return res.status(400).json({ success: false, message: "No valid fields" });

        params.push(userId);
        await pool.query(`UPDATE users SET ${sets.join(', ')}, updatedAt=NOW() WHERE id=?`, params);

        const [rows] = await pool.query(
            'SELECT id,email,username,displayName,avatarUrl,bio,status,role,isPremium,lastSeen,createdAt,updatedAt,emailVerified,totpEnabled FROM users WHERE id=? LIMIT 1',
            [userId]
        );
        const user = (rows as any[])[0];
        if (user) user.twoFactorEnabled = Boolean(user.totpEnabled);
        return res.json({ success: true, data: user });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

// GET /api/users/count
router.get("/count", async (_req, res) => {
    try {
        const [rows] = await pool.query("SELECT COUNT(*) as count FROM users");
        const count = Number((rows as any[])[0]?.count || 0);
        return res.json({ success: true, data: { count } });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "Database error" });
    }
});

export default router;
