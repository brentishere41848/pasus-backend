import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { pool } from "../db.js";
import { buildWrappedSnapshotForUser } from "../analytics/aggregations.js";

console.debug("[PasusDebug:backend/src/routes/wrapped] Loaded");
const router = Router();

router.get("/:year", requireAuth, async (req: AuthenticatedRequest, res) => {
  const year = Number(req.params.year);
  const userId = req.user!.id;

  if (!year || year < 2026) {
    return res
      .status(400)
      .json({ success: false, message: "Year must be 2026 or later" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT total_messages, top_contacts, top_servers
       FROM wrapped_snapshots
       WHERE user_id=? AND year=?`,
      [userId, year]
    );
    const snapshot = (rows as any[])[0];

    if (snapshot) {
      return res.json({
        success: true,
        data: {
          totalMessages: Number(snapshot.total_messages),
          topContacts: JSON.parse(snapshot.top_contacts || "[]"),
          topServers: JSON.parse(snapshot.top_servers || "[]"),
        },
      });
    }

    // Compute on the fly and persist for future calls
    const computed = await buildWrappedSnapshotForUser(userId, year, {
      persist: true,
    });

    if (!computed) {
      return res
        .status(503)
        .json({ success: false, message: "Wrapped not ready" });
    }

    return res.json({
      success: true,
      data: computed,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load wrapped data" });
  }
});

export default router;
