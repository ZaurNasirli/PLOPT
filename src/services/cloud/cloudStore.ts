import { CLOUD_ROOT, loadFirebase } from './firebaseClient';

/**
 * Cloud storage layout (Firestore):
 *
 *   users/{uid}/data/{key}__{part}   { key, part, parts, rev, data, updatedAt }
 *
 * Every synced value (orders, routes, settings, ...) is stored as a JSON string split into
 * parts of at most PART_SIZE characters. This keeps each document below the 1 MiB Firestore
 * limit, avoids Firestore restrictions (nested arrays, undefined values) and keeps the free
 * quota usage tiny: loading the whole workspace costs a handful of reads, and saving a
 * changed collection costs one write per part instead of one write per order.
 *
 * All parts of one save share the same `rev`; a reader only accepts a value whose parts are
 * complete and carry the same rev, so a partially written value is never parsed.
 */

// 300k UTF-16 chars <= ~900 KB of UTF-8 (max 3 bytes per BMP char), below the 1 MiB doc limit
export const PART_SIZE = 300_000;
// Keep each batch well below Firestore's 10 MiB request size limit
const MAX_PARTS_PER_BATCH = 8;

export interface StoredPart {
  key: string;
  part: number;
  parts: number;
  rev: string;
  data: string;
}

export interface CloudSnapshot {
  /** key -> full JSON string */
  values: Record<string, string>;
  /** key -> number of part documents currently stored (used to delete stale parts) */
  partCounts: Record<string, number>;
}

export interface CloudStore {
  readAll(): Promise<CloudSnapshot>;
  /** Writes `json` under `key`, removing leftover parts; returns the new number of parts. */
  write(key: string, json: string, previousParts: number): Promise<number>;
  /** Deletes every part of `key` (used for keys the app no longer has). */
  remove(key: string, parts: number): Promise<void>;
}

export function splitIntoParts(json: string, size: number = PART_SIZE): string[] {
  if (json.length <= size) return [json];
  const parts: string[] = [];
  let start = 0;
  while (start < json.length) {
    let end = Math.min(start + size, json.length);
    // Never cut a UTF-16 surrogate pair in half (it would be corrupted when stored as UTF-8)
    if (end < json.length) {
      const code = json.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    parts.push(json.slice(start, end));
    start = end;
  }
  return parts;
}

export function assembleParts(docs: StoredPart[]): CloudSnapshot {
  const byKey = new Map<string, StoredPart[]>();
  for (const d of docs) {
    if (!d || typeof d.key !== 'string' || typeof d.data !== 'string') continue;
    if (!byKey.has(d.key)) byKey.set(d.key, []);
    byKey.get(d.key)!.push(d);
  }

  const values: Record<string, string> = {};
  const partCounts: Record<string, number> = {};
  byKey.forEach((list, key) => {
    partCounts[key] = Math.max(...list.map(p => p.part)) + 1;
    const first = list.find(p => p.part === 0);
    if (!first) return;
    const sameRev = list.filter(p => p.rev === first.rev);
    const ordered: string[] = [];
    for (let i = 0; i < first.parts; i++) {
      const piece = sameRev.find(p => p.part === i);
      if (!piece) return; // incomplete write: ignore this value
      ordered.push(piece.data);
    }
    values[key] = ordered.join('');
  });
  return { values, partCounts };
}

const docId = (key: string, part: number) => `${key}__${part}`;

export async function createFirestoreStore(uid: string): Promise<CloudStore> {
  const { db, fsMod } = await loadFirebase();
  const { collection, doc, getDocs, writeBatch, serverTimestamp } = fsMod;
  const dataCollection = collection(db, CLOUD_ROOT, uid, 'data');

  return {
    async readAll() {
      const snap = await getDocs(dataCollection);
      return assembleParts(snap.docs.map(d => d.data() as StoredPart));
    },

    async write(key, json, previousParts) {
      const parts = splitIntoParts(json);
      const rev = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      type Op = { kind: 'set'; part: number; data: string } | { kind: 'delete'; part: number };
      const ops: Op[] = parts.map((data, part) => ({ kind: 'set' as const, part, data }));
      for (let part = parts.length; part < previousParts; part++) ops.push({ kind: 'delete', part });

      for (let i = 0; i < ops.length; i += MAX_PARTS_PER_BATCH) {
        const batch = writeBatch(db);
        for (const op of ops.slice(i, i + MAX_PARTS_PER_BATCH)) {
          const ref = doc(dataCollection, docId(key, op.part));
          if (op.kind === 'set') {
            batch.set(ref, { key, part: op.part, parts: parts.length, rev, data: op.data, updatedAt: serverTimestamp() });
          } else {
            batch.delete(ref);
          }
        }
        await batch.commit();
      }
      return parts.length;
    },

    async remove(key, parts) {
      for (let i = 0; i < parts; i += MAX_PARTS_PER_BATCH) {
        const batch = writeBatch(db);
        for (let part = i; part < Math.min(parts, i + MAX_PARTS_PER_BATCH); part++) batch.delete(doc(dataCollection, docId(key, part)));
        await batch.commit();
      }
    },
  };
}
