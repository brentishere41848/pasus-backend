import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import serverRoutes from "./routes/servers.js";
import forumRoutes from "./routes/forum.js";
import aiRoutes from "./routes/ai.js";
import moderationRoutes, { reportsRouter } from "./routes/moderation.js";
import wrappedRoutes from "./routes/wrapped.js";
import { runScheduledAnalytics } from "./jobs/analytics.js";
import supportRoutes from "./routes/support.js";
import userRoutes from "./routes/users.js"; // Added userRoutes import
import voiceRoutes from "./routes/voice.js";
import friendsRoutes, { handleListFriends } from "./routes/friends.js";
import recentsRoutes, { handleRecents } from "./routes/recents.js";
import reportsRoutes from "./routes/reports.js";
import adminRoutes from "./routes/admin.js";
import dmRoutes from "./routes/dm.js";
import verifyRoutes from "./routes/verify.js";
import verifyResendRoutes from "./routes/verify-resend.js";
import accessCodeRoutes from "./routes/accessCode.js";
import discoveryRoutes from "./routes/discovery.js";
import newsletterRoutes from "./routes/newsletter.js";

console.debug("[PasusDebug:backend/src/server] Loaded");
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/auth", accessCodeRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/forum", forumRoutes);
app.use("/api", aiRoutes);
app.use("/api/moderation", moderationRoutes);
app.use("/api/reports", reportsRouter);
app.use("/api/wrapped", wrappedRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/users", userRoutes);
app.use("/api/friends", friendsRoutes);
// Fallbacks to guard against stale builds where the router isn't mounted
app.post("/api/friends/request", (req, res, next) => friendsRoutes(req, res, next));
app.post("/api/friends/accept", (req, res, next) => friendsRoutes(req, res, next));
app.post("/api/friends/decline", (req, res, next) => friendsRoutes(req, res, next));
app.post("/api/friends/block", (req, res, next) => friendsRoutes(req, res, next));
app.get("/api/friends", (req, res) => {
  // @ts-ignore
  return handleListFriends(req, res);
});
app.use("/api/recents", recentsRoutes);
// Direct fallback in case router mounting is bypassed in older builds
app.get("/api/recents", (req, res, next) => {
  // @ts-ignore
  return handleRecents(req, res);
});
app.use("/api/moderation/reports", reportsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/voice", voiceRoutes);
app.use("/api/dm", dmRoutes);
// Mount resend first so /resend isn't captured by the base verify router
app.use("/api/verify-email/resend", verifyResendRoutes);
app.use("/api/verify-email", verifyRoutes);
app.use("/api/discovery", discoveryRoutes);
app.use("/api/newsletter", newsletterRoutes);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pasus backend listening on ${PORT}`);
});

runScheduledAnalytics();
