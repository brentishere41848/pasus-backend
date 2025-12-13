import { Router } from "express";
import { pool } from "../db.js";

console.debug("[PasusDebug:backend/src/routes/voice] Loaded");

const router = Router();

// Endpoint for a user to join a voice channel and announce their Peer ID
router.post("/:channelId/join", async (req, res) => {
    const { channelId } = req.params;
    const { userId, peerId, muted, deafened } = req.body;

    if (!userId || !peerId) {
        return res.status(400).json({ success: false, message: "Missing userId or peerId" });
    }

    try {
        // 1. Register participant
        await pool.query(
            `INSERT INTO voice_participants (channelId, userId, peerId, muted, deafened, lastKeepAlive) 
       VALUES (?, ?, ?, ?, ?, NOW()) 
       ON DUPLICATE KEY UPDATE peerId=?, muted=?, deafened=?, lastKeepAlive=NOW()`,
            [channelId, userId, peerId, muted || false, deafened || false, peerId, muted || false, deafened || false]
        );

        // 2. Fetch *other* participants to return to the caller
        const [others] = await pool.query(
            `SELECT userId, peerId, muted, deafened FROM voice_participants 
       WHERE channelId = ? AND userId != ? AND lastKeepAlive > DATE_SUB(NOW(), INTERVAL 30 SECOND)`,
            [channelId, userId]
        );

        return res.json({ success: true, data: others });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: "DB Error" });
    }
});

// Keep-alive heartbeat to prevent stale users from appearing in the list
router.post("/:channelId/ping", async (req, res) => {
    const { channelId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false });

    try {
        await pool.query(
            `UPDATE voice_participants SET lastKeepAlive=NOW() WHERE channelId=? AND userId=?`,
            [channelId, userId]
        );
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

// Leave channel
router.post("/:channelId/leave", async (req, res) => {
    const { channelId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false });

    try {
        await pool.query(`DELETE FROM voice_participants WHERE channelId=? AND userId=?`, [channelId, userId]);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

// List participants (for UI)
router.get("/:channelId/participants", async (req, res) => {
    const { channelId } = req.params;
    try {
        // Clean up stale first
        await pool.query(`DELETE FROM voice_participants WHERE lastKeepAlive < DATE_SUB(NOW(), INTERVAL 30 SECOND)`);

        const [rows] = await pool.query(
            `SELECT vp.*, u.username, u.displayName, u.avatarUrl 
       FROM voice_participants vp
       JOIN users u ON vp.userId = u.id
       WHERE vp.channelId = ?`,
            [channelId]
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false });
    }
});

export default router;
