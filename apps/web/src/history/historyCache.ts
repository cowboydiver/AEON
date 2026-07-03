/**
 * IndexedDB persistence for streamed planet histories (#24).
 *
 * A *completed* history for a given key hydrates on reload without a worker run;
 * anything else — no entry, a partial (never-finished) run, a corrupt record, or
 * a version bump — reports a miss and the caller regenerates. A broken cache must
 * never surface a broken timeline, so every read is wrapped and degrades to a
 * miss on any error.
 *
 * The key folds in both `HISTORY_FORMAT_VERSION` (codec layout) and
 * `KERNEL_BEHAVIOR_VERSION` (deliberate sim-behavior changes, bumped alongside
 * any golden regeneration). A bump changes the key, so stale entries silently
 * stop matching and are eventually LRU-evicted — no explicit migration.
 *
 * Layout: one `manifests` record per history (LRU-ordered by `updatedAt`) and
 * one `keyframes` record per keyframe, compound-keyed `[key, index]` so a whole
 * history deletes as a single primary-key range.
 */
import { HISTORY_FORMAT_VERSION, KERNEL_BEHAVIOR_VERSION } from 'sim-kernel';

const DB_NAME = 'aeon-history';
const DB_VERSION = 1;
const MANIFEST_STORE = 'manifests';
const KEYFRAME_STORE = 'keyframes';

export interface HistoryCacheConfig {
  seed: number;
  gridN: number;
  untilYears: number;
  keyframeIntervalYears: number;
}

/** A keyframe as stored/returned: metadata plus the still-encoded payload. */
export interface CachedKeyframe {
  index: number;
  timeYears: number;
  landFraction: number;
  payload: ArrayBuffer;
}

interface Manifest {
  key: string;
  formatVersion: number;
  behaviorVersion: number;
  /** Keyframes the completed run wrote; a partial run leaves this at its start value. */
  keyframeCount: number;
  complete: boolean;
  /** ms epoch of the last write/hit — the LRU ordering key. */
  updatedAt: number;
}

interface KeyframeRecord extends CachedKeyframe {
  /** Manifest key; the range-delete and getAll pivot. */
  key: string;
}

/** Stable cache key. Both version integers are folded in, so a bump = a miss. */
export function historyCacheKey(cfg: HistoryCacheConfig): string {
  return [
    cfg.seed,
    cfg.gridN,
    cfg.untilYears,
    cfg.keyframeIntervalYears,
    HISTORY_FORMAT_VERSION,
    KERNEL_BEHAVIOR_VERSION,
  ].join(':');
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** True for the storage-pressure error IndexedDB raises when the quota is hit. */
function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError';
}

/**
 * The whole cache surface. A single lazily-opened connection is reused; if the
 * environment has no IndexedDB (SSR, locked-down context) every method degrades
 * to a no-op / miss so callers always just regenerate.
 */
export class HistoryCache {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private available(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private db(): Promise<IDBDatabase> {
    return (this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
          const manifests = db.createObjectStore(MANIFEST_STORE, { keyPath: 'key' });
          manifests.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(KEYFRAME_STORE)) {
          const keyframes = db.createObjectStore(KEYFRAME_STORE, { keyPath: ['key', 'index'] });
          keyframes.createIndex('key', 'key');
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    }));
  }

  /**
   * A complete, self-consistent history for `key`, or null on any miss. Null is
   * returned for: no manifest, an unfinished run, a version-integer mismatch, or
   * a keyframe set whose count/contiguity disagrees with the manifest (corrupt).
   * A hit refreshes the LRU timestamp.
   */
  async loadComplete(key: string): Promise<CachedKeyframe[] | null> {
    if (!this.available()) return null;
    try {
      const db = await this.db();
      const manifest = await reqDone<Manifest | undefined>(
        db.transaction(MANIFEST_STORE, 'readonly').objectStore(MANIFEST_STORE).get(key),
      );
      if (!manifest || !manifest.complete) return null;
      if (
        manifest.formatVersion !== HISTORY_FORMAT_VERSION ||
        manifest.behaviorVersion !== KERNEL_BEHAVIOR_VERSION
      ) {
        return null; // key already folds versions in; this is belt-and-braces
      }

      const records = await reqDone<KeyframeRecord[]>(
        db.transaction(KEYFRAME_STORE, 'readonly').objectStore(KEYFRAME_STORE).index('key').getAll(key),
      );
      if (records.length !== manifest.keyframeCount) return null; // torn write
      records.sort((a, b) => a.index - b.index);
      for (let i = 0; i < records.length; i++) {
        if (records[i]!.index !== i) return null; // a gap: not a clean prefix
      }

      void this.touch(key); // best-effort LRU bump; a failure must not fail the hit
      return records.map(({ index, timeYears, landFraction, payload }) => ({
        index,
        timeYears,
        landFraction,
        payload,
      }));
    } catch {
      return null; // any storage failure → regenerate, never a broken timeline
    }
  }

  /**
   * Open (or reset) the manifest for a fresh streaming run: marked incomplete so
   * a reload mid-stream is a miss and regenerates. Keyframes are then written
   * through with `putKeyframe` and the run sealed (with its real count) by
   * `finalize`. Existing keyframes for `key` are left in place — same key means
   * same params, so the write-through upserts identical indices.
   */
  async startRun(key: string): Promise<void> {
    if (!this.available()) return;
    try {
      const db = await this.db();
      const tx = db.transaction(MANIFEST_STORE, 'readwrite');
      tx.objectStore(MANIFEST_STORE).put({
        key,
        formatVersion: HISTORY_FORMAT_VERSION,
        behaviorVersion: KERNEL_BEHAVIOR_VERSION,
        keyframeCount: 0,
        complete: false,
        updatedAt: Date.now(),
      } satisfies Manifest);
      await txDone(tx);
    } catch {
      // A cache that can't be opened just means everything runs uncached.
    }
  }

  /**
   * Write one keyframe through as it streams. On `QuotaExceededError` the oldest
   * history is evicted and the write retried once; a second failure is swallowed
   * (the live run still has the keyframe in memory).
   */
  async putKeyframe(key: string, kf: CachedKeyframe): Promise<void> {
    if (!this.available()) return;
    const record: KeyframeRecord = { key, ...kf };
    try {
      await this.writeKeyframe(record);
    } catch (err) {
      if (!isQuotaError(err)) return;
      try {
        await this.evictOldest(key);
        await this.writeKeyframe(record);
      } catch {
        // Out of room even after eviction — leave it uncached, keep streaming.
      }
    }
  }

  private async writeKeyframe(record: KeyframeRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(KEYFRAME_STORE, 'readwrite');
    tx.objectStore(KEYFRAME_STORE).put(record);
    await txDone(tx);
  }

  /** Seal a run: mark the manifest complete with its final keyframe count. */
  async finalize(key: string, keyframeCount: number): Promise<void> {
    if (!this.available()) return;
    try {
      const db = await this.db();
      const tx = db.transaction(MANIFEST_STORE, 'readwrite');
      tx.objectStore(MANIFEST_STORE).put({
        key,
        formatVersion: HISTORY_FORMAT_VERSION,
        behaviorVersion: KERNEL_BEHAVIOR_VERSION,
        keyframeCount,
        complete: true,
        updatedAt: Date.now(),
      } satisfies Manifest);
      await txDone(tx);
    } catch {
      // Failing to seal just means this history is re-streamed next time.
    }
  }

  private async touch(key: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(MANIFEST_STORE, 'readwrite');
    const store = tx.objectStore(MANIFEST_STORE);
    const manifest = await reqDone<Manifest | undefined>(store.get(key));
    if (manifest) store.put({ ...manifest, updatedAt: Date.now() });
    await txDone(tx);
  }

  /**
   * Delete the least-recently-used history (manifest + all its keyframes) to make
   * room, skipping `keepKey` so a run never evicts the history it is writing.
   */
  private async evictOldest(keepKey: string): Promise<void> {
    const db = await this.db();
    const oldest = await this.oldestKeyExcept(keepKey);
    if (!oldest) return;
    const tx = db.transaction([MANIFEST_STORE, KEYFRAME_STORE], 'readwrite');
    tx.objectStore(MANIFEST_STORE).delete(oldest);
    // Compound primary key [key, index]: this range covers every keyframe of `oldest`.
    tx.objectStore(KEYFRAME_STORE).delete(IDBKeyRange.bound([oldest], [oldest, Infinity]));
    await txDone(tx);
  }

  private async oldestKeyExcept(keepKey: string): Promise<string | null> {
    const db = await this.db();
    const cursorReq = db
      .transaction(MANIFEST_STORE, 'readonly')
      .objectStore(MANIFEST_STORE)
      .index('updatedAt')
      .openCursor(); // ascending updatedAt: oldest first
    return new Promise<string | null>((resolve, reject) => {
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve(null);
        const manifest = cursor.value as Manifest;
        if (manifest.key !== keepKey) return resolve(manifest.key);
        cursor.continue();
      };
    });
  }
}

/** Process-wide cache (one IndexedDB connection reused across generate() calls). */
export const historyCache = new HistoryCache();
