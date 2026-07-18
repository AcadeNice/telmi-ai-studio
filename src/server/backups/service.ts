import archiver from "archiver";
import Database from "better-sqlite3";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import unzipper from "unzipper";
import { randomUUID } from "node:crypto";
import {
  db,
  checkpointDatabase,
  closeDatabase,
  databasePath,
} from "@/server/db";
import { backups } from "@/server/db/schema";
import { dataDirectory } from "@/server/storage/paths";

const MAGIC = Buffer.from("TAISBKP1");
export const MAX_BACKUP_BYTES = 512_000_000;
const MAX_EXTRACTED_BYTES = 1_000_000_000;
const MAX_ARCHIVE_ENTRIES = 100_000;

async function makeZip() {
  checkpointDatabase();
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const sink = new PassThrough();
  sink.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const complete = new Promise<void>((resolve, reject) => {
    sink.on("end", resolve);
    sink.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(sink);
  archive.file(databasePath, { name: "telmi.db" });
  const storiesPath = path.join(dataDirectory, "stories");
  if (fs.existsSync(storiesPath)) archive.directory(storiesPath, "stories");
  archive.append(
    JSON.stringify({ format: 1, createdAt: new Date().toISOString() }, null, 2),
    { name: "manifest.json" },
  );
  await archive.finalize();
  await complete;
  const result = Buffer.concat(chunks);
  if (result.byteLength > MAX_BACKUP_BYTES)
    throw new Error("La sauvegarde dépasse la limite de 512 Mo.");
  return result;
}

function encryptBackup(zip: Buffer, password: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(zip), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}

function decryptBackup(payload: Buffer, password: string) {
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error("Format de sauvegarde inconnu.");
  const salt = payload.subarray(8, 24);
  const iv = payload.subarray(24, 36);
  const tag = payload.subarray(36, 52);
  const encrypted = payload.subarray(52);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    scryptSync(password, salt, 32),
    iv,
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export async function createBackup(password: string) {
  const id = randomUUID();
  const directory = path.join(dataDirectory, "backups");
  await fsp.mkdir(directory, { recursive: true });
  const outputPath = path.join(
    directory,
    `telmi-ai-studio-${new Date().toISOString().replaceAll(":", "-")}.taisbackup`,
  );
  await fsp.writeFile(outputPath, encryptBackup(await makeZip(), password), {
    mode: 0o600,
  });
  const bytes = (await fsp.stat(outputPath)).size;
  db.insert(backups)
    .values({ id, path: outputPath, bytes, createdAt: new Date() })
    .run();
  return { id, path: outputPath, bytes };
}

export async function restoreBackup(payload: Buffer, password: string) {
  if (payload.byteLength > MAX_BACKUP_BYTES)
    throw new Error("La sauvegarde dépasse la limite de 512 Mo.");
  const staging = await fsp.mkdtemp(path.join(dataDirectory, ".restore-"));
  let databaseClosed = false;
  const rollbackDb = `${databasePath}.before-restore`;
  const currentStories = path.join(dataDirectory, "stories");
  const rollbackStories = path.join(dataDirectory, ".stories-before-restore");
  try {
    const zip = decryptBackup(payload, password);
    const directory = await unzipper.Open.buffer(zip);
    if (directory.files.length > MAX_ARCHIVE_ENTRIES)
      throw new Error("La sauvegarde contient trop de fichiers.");
    const expandedBytes = directory.files.reduce(
      (total, entry) => total + Number(entry.uncompressedSize ?? 0),
      0,
    );
    if (expandedBytes > MAX_EXTRACTED_BYTES)
      throw new Error("La sauvegarde décompressée dépasse 1 Go.");
    for (const entry of directory.files) {
      const target = path.resolve(staging, entry.path);
      if (!target.startsWith(`${path.resolve(staging)}${path.sep}`))
        throw new Error("Archive de sauvegarde non sûre.");
      if (entry.type === "Directory")
        await fsp.mkdir(target, { recursive: true });
      else {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, await entry.buffer());
      }
    }
    const restoredDb = path.join(staging, "telmi.db");
    if (!fs.existsSync(restoredDb))
      throw new Error("Base de données absente de la sauvegarde.");
    const probe = new Database(restoredDb, { readonly: true });
    const integrity = probe.pragma("integrity_check", { simple: true });
    probe.close();
    if (integrity !== "ok") throw new Error("La base restaurée est corrompue.");
    closeDatabase();
    databaseClosed = true;
    await fsp.rm(rollbackDb, { force: true });
    await fsp.rename(databasePath, rollbackDb);
    await fsp.rename(restoredDb, databasePath);
    const restoredStories = path.join(staging, "stories");
    await fsp.rm(rollbackStories, { recursive: true, force: true });
    if (fs.existsSync(currentStories))
      await fsp.rename(currentStories, rollbackStories);
    if (fs.existsSync(restoredStories))
      await fsp.rename(restoredStories, currentStories);
    return { success: true, restartRequired: true };
  } catch (error) {
    if (databaseClosed) {
      await fsp.rm(databasePath, { force: true }).catch(() => undefined);
      if (fs.existsSync(rollbackDb))
        await fsp.rename(rollbackDb, databasePath).catch(() => undefined);
      await fsp
        .rm(currentStories, { recursive: true, force: true })
        .catch(() => undefined);
      if (fs.existsSync(rollbackStories))
        await fsp
          .rename(rollbackStories, currentStories)
          .catch(() => undefined);
      setTimeout(() => process.exit(1), 500);
    }
    throw error;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}
