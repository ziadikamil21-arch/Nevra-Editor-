// IndexedDB-based persistent storage for Nevra Editor folders and variants.
// Data survives page refresh and reconnects — never cleared unless explicitly deleted.

import type { TransformSummary } from './client-processor';

export interface NevraFolder {
  id: string;
  name: string;
  type: 'video' | 'photo';
  createdAt: number;
}

export interface NevraVariant {
  id: string;
  folderId: string;
  filename: string;
  blob: Blob;
  size: number;
  summary: TransformSummary | null;
  type: 'video' | 'photo';
  createdAt: number;
}

const DB_NAME = 'nevra-editor-v1';
const DB_VERSION = 1;

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('variants')) {
        const s = db.createObjectStore('variants', { keyPath: 'id' });
        s.createIndex('folderId', 'folderId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Folders ──────────────────────────────────────────────────────────────────

export async function loadFolders(): Promise<NevraFolder[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('folders', 'readonly').objectStore('folders').getAll();
    req.onsuccess = () =>
      resolve((req.result as NevraFolder[]).sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function createFolder(name: string, type: 'video' | 'photo'): Promise<NevraFolder> {
  const folder: NevraFolder = { id: uid(), name, type, createdAt: Date.now() };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').add(folder);
    tx.oncomplete = () => resolve(folder);
    tx.onerror = () => reject(tx.error);
  });
}

export async function renameFolder(id: string, newName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    const store = tx.objectStore('folders');
    const req = store.get(id);
    req.onsuccess = () => {
      const f = req.result as NevraFolder | undefined;
      if (f) store.put({ ...f, name: newName });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteFolder(id: string): Promise<void> {
  const db = await openDB();
  const variants = await getVariantsByFolder(id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['folders', 'variants'], 'readwrite');
    tx.objectStore('folders').delete(id);
    const vs = tx.objectStore('variants');
    variants.forEach((v) => vs.delete(v.id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Variants ─────────────────────────────────────────────────────────────────

export async function getVariantsByFolder(folderId: string): Promise<NevraVariant[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction('variants', 'readonly')
      .objectStore('variants')
      .index('folderId')
      .getAll(folderId);
    req.onsuccess = () =>
      resolve((req.result as NevraVariant[]).sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function saveVariant(
  data: Omit<NevraVariant, 'id' | 'createdAt'>,
): Promise<NevraVariant> {
  const variant: NevraVariant = { ...data, id: uid(), createdAt: Date.now() };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('variants', 'readwrite');
    tx.objectStore('variants').add(variant);
    tx.oncomplete = () => resolve(variant);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteVariant(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('variants', 'readwrite');
    tx.objectStore('variants').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function countVariantsInFolder(folderId: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction('variants', 'readonly')
      .objectStore('variants')
      .index('folderId')
      .count(folderId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
