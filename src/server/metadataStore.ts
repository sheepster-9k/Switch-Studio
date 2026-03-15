/**
 * Sidecar metadata store — persists config metadata that HA's Switch Manager
 * backend does not round-trip (area assignment, layout overrides, etc.).
 *
 * The store is a JSON file keyed by config ID.
 */
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { isRecord } from "../shared/utils.js";

export type MetadataRecord = Record<string, unknown>;
type MetadataMap = Record<string, MetadataRecord>;

let cache: MetadataMap | null = null;
let storePath: string | null = null;

/** Serialize all writes to prevent interleaved read-modify-write. */
let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.then(() => {}, () => {});
  return next;
}

export function initMetadataStore(path: string): void {
  storePath = path;
}

async function loadStore(): Promise<MetadataMap> {
  if (cache) {
    return cache;
  }
  if (!storePath) {
    return {};
  }
  try {
    const raw = JSON.parse(await readFile(storePath, "utf8"));
    cache = isRecord(raw) ? (raw as MetadataMap) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Atomic write — write to temp file then rename into place. */
async function flush(): Promise<void> {
  if (!storePath || !cache) {
    return;
  }
  await mkdir(dirname(storePath), { recursive: true });
  const tmpPath = storePath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(cache, null, 2), "utf8");
  await rename(tmpPath, storePath);
}

/** Get all persisted metadata keyed by config ID. */
export async function getAllPersistedMetadata(): Promise<Record<string, MetadataRecord>> {
  return { ...(await loadStore()) };
}

/** Persist metadata for a config. Pass null to remove. */
export async function setPersistedMetadata(configId: string, metadata: MetadataRecord | null): Promise<void> {
  return withLock(async () => {
    const store = await loadStore();
    if (metadata && Object.keys(metadata).length > 0) {
      store[configId] = metadata;
    } else {
      delete store[configId];
    }
    await flush();
  });
}

/** Remove metadata for a deleted config. */
export async function removePersistedMetadata(configId: string): Promise<void> {
  return withLock(async () => {
    const store = await loadStore();
    if (configId in store) {
      delete store[configId];
      await flush();
    }
  });
}
