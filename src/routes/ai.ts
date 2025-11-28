import { Router } from "express";
import dotenv from "dotenv";
import { pool } from "../db.js";

dotenv.config();

const router = Router();

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3";

router.post("/chat", async (req, res) => {
  const { messages = [], model, userId } = req.body as { messages?: any[]; model?: string; userId?: string };

  try {
    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || OLLAMA_MODEL,
        messages,
        stream: false
      })
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text();
      return res.status(500).json({ error: "Ollama error", details: text });
    }

    const data = await ollamaRes.json();
    // Persist AI session (best-effort)
    if (userId && messages.length && data?.message?.content) {
      const prompt = messages[messages.length - 1]?.content || "";
      try {
        await pool.query(
          'INSERT INTO ai_sessions (id,userId,prompt,response,mode,createdAt,completedAt) VALUES (UUID(),?,?,?,?,NOW(),NOW())',
          [userId, prompt, data.message.content, 'app']
        );
      } catch (err) {
        console.error("Failed to persist ai_session", err);
      }
    }
    // Ollama returns { message: { content: "..."} }
    return res.json(data);
  } catch (err) {
    console.error("Ollama call failed", err);
    return res.status(500).json({ error: "Failed to reach Ollama" });
  }
});

export default router;
