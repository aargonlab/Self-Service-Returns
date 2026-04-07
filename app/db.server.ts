import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

declare global {
  var __prisma: PrismaClient | undefined;
}

// Bug #550: Use standard Remix singleton pattern to prevent race conditions
// In production, create a single instance. In development, store on globalThis
// to survive HMR and avoid multiple instances across module reloads.
if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  if (!globalThis.__prisma) {
    globalThis.__prisma = new PrismaClient();
  }
  prisma = globalThis.__prisma;
}

export default prisma;
