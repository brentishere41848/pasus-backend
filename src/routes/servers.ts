import { Router } from "express";
import { db, Server } from "../data.js";
import { v4 as uuid } from "uuid";

const router = Router();

router.get("/", (_req, res) => {
  const servers = Array.from(db.servers.values());
  res.json({ success: true, data: servers });
});

router.post("/", (req, res) => {
  const { name, icon, ownerId } = req.body as {
    name?: string;
    icon?: string;
    ownerId?: string;
  };

  if (!name || !ownerId) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const newServer: Server = {
    id: uuid(),
    name,
    icon: icon || "https://picsum.photos/seed/server/200",
    ownerId,
    channels: [
      { id: uuid(), name: "general", type: "text" },
      { id: uuid(), name: "Lounge", type: "voice" }
    ]
  };

  db.servers.set(newServer.id, newServer);
  return res.json({ success: true, data: newServer });
});

export default router;
