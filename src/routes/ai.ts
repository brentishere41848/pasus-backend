import { Router } from "express";
import dotenv from "dotenv";
import { pool } from "../db.js";

console.debug("[PasusDebug:backend/src/routes/ai] Loaded");
dotenv.config();

const router = Router();

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3";

function buildFallback(messages: any[]) {
  const last = messages?.length ? messages[messages.length - 1] : { content: "" };
  const prompt = typeof last?.content === "string" ? last.content : "";
  const content =
    prompt?.length
      ? `Pasus AI is currently unavailable. Here's a quick echo of your request: ${prompt}`
      : "Pasus AI is currently unavailable. Please try again later.";
  return { message: { content } };
}

async function runOllama(promptMessages: any[]) {
  const resolvedModel = (OLLAMA_MODEL || "llama3").trim();
  if (!resolvedModel) return buildFallback(promptMessages);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // allow longer on VPS so model can respond

    const resp = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: resolvedModel,
        messages: promptMessages,
        stream: false,
        options: {
          num_predict: 128, // cap response length so calls return fast
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Ollama non-OK", txt);
      return buildFallback(promptMessages);
    }
    const data = await resp.json();
    return data?.message?.content ? data : buildFallback(promptMessages);
  } catch (err) {
    if ((err as any)?.name === "AbortError") {
      console.error("Ollama call timed out");
    } else {
      console.error("Ollama call failed", err);
    }
    return buildFallback(promptMessages);
  }
}

router.post("/chat", async (req, res) => {
  const { messages = [], model, userId } = req.body as { messages?: any[]; model?: string; userId?: string };
  const resolvedModel = (model || OLLAMA_MODEL || "llama3").trim();

  try {
    const data = await runOllama(messages);
    if (userId && messages.length && data?.message?.content) {
      const prompt = messages[messages.length - 1]?.content || "";
      try {
        await pool.query(
          'INSERT INTO ai_sessions (id,userId,prompt,response,mode,createdAt,completedAt) VALUES (UUID(),?,?,?,?,NOW(),NOW())',
          [userId, prompt, data.message.content, 'app']
        );
      } catch (err: any) {
        // Swallow FK or other persistence errors so AI responses still return
        console.warn("Failed to persist ai_session", err?.code || err);
      }
    }
    if (!data?.message?.content) return res.json(buildFallback(messages));
    return res.json(data);
  } catch (err) {
    console.error("Ollama call failed", err);
    return res.json(buildFallback(messages));
  }
});

router.post("/summary", async (req, res) => {
  const { messages = [], channelName } = req.body as { messages?: any[]; channelName?: string };
  const prompt = [
    { role: "system", content: "Summarize the following messages in 3-5 bullet points for channel context." },
    { role: "user", content: JSON.stringify(messages.slice(-50)) },
  ];
  const data = await runOllama(prompt);
  return res.json({ summary: data?.message?.content || buildFallback(messages).message.content, channelName });
});

router.post("/draft", async (req, res) => {
  const { bullets = "" } = req.body as { bullets?: string };
  const prompt = [
    { role: "system", content: "Turn these bullet points into a concise announcement." },
    { role: "user", content: bullets },
  ];
  const data = await runOllama(prompt);
  return res.json({ draft: data?.message?.content || buildFallback([{ content: bullets }]).message.content });
});

router.post("/improve", async (req, res) => {
  const { text = "" } = req.body as { text?: string };
  const prompt = [
    { role: "system", content: "Improve wording while preserving meaning. Keep it concise." },
    { role: "user", content: text },
  ];
  const data = await runOllama(prompt);
  return res.json({ suggestion: data?.message?.content || buildFallback([{ content: text }]).message.content });
});

export default router;
