import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export const databasePath =
  process.env.DATABASE_URL ?? path.join(process.cwd(), "data", "telmi.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function checkpointDatabase() {
  sqlite.pragma("wal_checkpoint(FULL)");
}

let migrated = false;

export function ensureDatabase() {
  if (migrated) return db;
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  migrated = true;
  return db;
}

export function closeDatabase() {
  sqlite.close();
}
