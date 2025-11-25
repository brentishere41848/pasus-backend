import { Router } from "express";
import { db, ForumComment, ForumPost } from "../data.js";
import { v4 as uuid } from "uuid";

const router = Router();

router.get("/posts", (_req, res) => {
  const posts = Array.from(db.posts.values());
  res.json({ success: true, data: posts });
});

router.post("/posts", (req, res) => {
  const { authorId, title, content, tags } = req.body as Partial<ForumPost>;
  if (!authorId || !title || !content) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const newPost: ForumPost = {
    id: uuid(),
    authorId,
    title,
    content,
    tags: tags || [],
    createdAt: new Date(),
    likes: 0,
    dislikes: 0
  };

  db.posts.set(newPost.id, newPost);
  res.json({ success: true, data: newPost });
});

router.post("/posts/:id/vote", (req, res) => {
  const { id } = req.params;
  const { type } = req.body as { type?: "like" | "dislike" };
  const post = db.posts.get(id);
  if (!post || !type) return res.status(400).json({ success: false });

  if (type === "like") post.likes += 1;
  if (type === "dislike") post.dislikes += 1;
  res.json({ success: true, data: post });
});

router.post("/posts/:id/comments", (req, res) => {
  const { id } = req.params;
  const { authorId, content } = req.body as Partial<ForumComment>;
  if (!authorId || !content) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const comment: ForumComment = {
    id: uuid(),
    postId: id,
    authorId,
    content,
    createdAt: new Date()
  };

  db.comments.set(comment.id, comment);
  res.json({ success: true, data: comment });
});

export default router;
