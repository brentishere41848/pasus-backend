import { v4 as uuid } from "uuid";

console.debug("[PasusDebug:backend/src/data] Loaded");
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  avatar: string;
  bio?: string;
  createdAt: Date;
  aiUsageCount: number;
  lastAiUsage?: Date;
}

export interface Channel {
  id: string;
  name: string;
  type: "text" | "voice";
}

export interface Server {
  id: string;
  name: string;
  icon: string;
  ownerId: string;
  channels: Channel[];
}

export interface ForumPost {
  id: string;
  authorId: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: Date;
  likes: number;
  dislikes: number;
}

export interface ForumComment {
  id: string;
  postId: string;
  authorId: string;
  content: string;
  createdAt: Date;
}

// In-memory seed removed; database now used via Prisma.
export const db = {};
