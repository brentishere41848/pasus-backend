import { v4 as uuid } from "uuid";

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

export const db = {
  users: new Map<string, User>(),
  servers: new Map<string, Server>(),
  posts: new Map<string, ForumPost>(),
  comments: new Map<string, ForumComment>()
};

// seed a demo user and server
const demoUser: User = {
  id: uuid(),
  email: "demo@pasus.ai",
  passwordHash: "demo", // plain for demo only
  name: "Demo User",
  avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=demo`,
  bio: "Ready to connect.",
  createdAt: new Date(),
  aiUsageCount: 0
};

db.users.set(demoUser.id, demoUser);

const generalChannel: Channel = { id: uuid(), name: "general", type: "text" };
const loungeChannel: Channel = { id: uuid(), name: "lounge", type: "voice" };
const demoServer: Server = {
  id: uuid(),
  name: "Pasus HQ",
  icon: "https://picsum.photos/seed/pasus/80",
  ownerId: demoUser.id,
  channels: [generalChannel, loungeChannel]
};

db.servers.set(demoServer.id, demoServer);

const welcomePost: ForumPost = {
  id: uuid(),
  authorId: demoUser.id,
  title: "Welcome to Pasus",
  content: "Introduce yourself and say hi!",
  tags: ["welcome", "general"],
  createdAt: new Date(),
  likes: 3,
  dislikes: 0
};

db.posts.set(welcomePost.id, welcomePost);
