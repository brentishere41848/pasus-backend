import { Router } from "express";
import { v4 as uuid } from "uuid";
import { pool } from "../db.js";

const router = Router();

router.get("/posts", async (_req, res) => {
  try {
    const [posts] = await pool.query('SELECT * FROM forum_posts ORDER BY createdAt DESC');
    res.json({ success: true, data: posts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

router.post("/posts", async (req, res) => {
  const { authorId, title, content, tags } = req.body as { authorId?: string; title?: string; content?: string; tags?: any };
  if (!authorId || !title || !content) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    const id = uuid();
    await pool.query('INSERT INTO forum_posts (id,authorId,title,content,tags,likes,dislikes,createdAt) VALUES (?,?,?,?,?,?,?,NOW())', [id, authorId, title, content, JSON.stringify(tags || []), 0, 0]);
    return res.json({ success: true, data: { id, authorId, title, content, tags: tags || [], likes: 0, dislikes: 0 } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Database error" });
  }
});

router.post("/posts/:id/vote", async (req, res) => {
  const { id } = req.params;
  const { type } = req.body as { type?: "like" | "dislike" };
  if (!type) return res.status(400).json({ success: false });

  try {
    if (type === 'like') {
      await pool.query('UPDATE forum_posts SET likes = likes + 1 WHERE id=?', [id]);
    } else {
      await pool.query('UPDATE forum_posts SET dislikes = dislikes + 1 WHERE id=?', [id]);
    }
    const [rows] = await pool.query('SELECT * FROM forum_posts WHERE id=?', [id]);
    return res.json({ success: true, data: (rows as any[])[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Database error" });
  }
});

router.post("/posts/:id/comments", async (req, res) => {
  const { id } = req.params;
  const { authorId, content } = req.body as { authorId?: string; content?: string };
  if (!authorId || !content) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    const commentId = uuid();
    await pool.query('INSERT INTO forum_comments (id,postId,authorId,content,createdAt) VALUES (?,?,?,?,NOW())', [commentId, id, authorId, content]);
    return res.json({ success: true, data: { id: commentId, postId: id, authorId, content, createdAt: new Date() } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Database error" });
  }
});

export default router;
