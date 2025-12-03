import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import serverRoutes from "./routes/servers.js";
import forumRoutes from "./routes/forum.js";
import aiRoutes from "./routes/ai.js";
import moderationRoutes, { reportsRouter } from "./routes/moderation.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/forum", forumRoutes);
app.use("/api", aiRoutes);
app.use("/api/moderation", moderationRoutes);
app.use("/api/reports", reportsRouter);

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pasus backend listening on ${PORT}`);
});
