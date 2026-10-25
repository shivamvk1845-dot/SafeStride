import { resolve, isAbsolute } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must be configured before starting the API.");

const adapter = connectionString.startsWith("file:")
  ? new PrismaBetterSqlite3({
    url: `file:${isAbsolute(connectionString.slice("file:".length))
      ? connectionString.slice("file:".length)
      : resolve(process.cwd(), "prisma", connectionString.slice("file:".length))}`,
  })
  : connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://")
    ? new PrismaPg({ connectionString })
    : undefined;
if (!adapter) throw new Error("DATABASE_URL must use SQLite or PostgreSQL.");

export const prisma = new PrismaClient({ adapter });
