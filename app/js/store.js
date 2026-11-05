// Projekt-Zwischenspeicher im Handy (IndexedDB): Fotos, Einstellungen, letztes Ergebnis.
// Nach Neuladen oder Absturz geht nichts verloren. Alle Fehler werden abgefangen –
// ohne Speicher funktioniert die App trotzdem, nur ohne Wiederaufnahme.

const DB_NAME = 'auto360';
const VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const t = db.transaction(store, mode);
          const s = t.objectStore(store);
          const r = fn(s);
          t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
          t.onerror = () => resolve(undefined);
          t.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      })
  );
}

export const store = {
  putPhoto: (p) => tx('photos', 'readwrite', (s) => s.put(p)),
  deletePhoto: (id) => tx('photos', 'readwrite', (s) => s.delete(id)),
  allPhotos: () => tx('photos', 'readonly', (s) => s.getAll()).then((x) => x || []),
  clearPhotos: () => tx('photos', 'readwrite', (s) => s.clear()),
  get: (key) => tx('kv', 'readonly', (s) => s.get(key)),
  set: (key, val) => tx('kv', 'readwrite', (s) => s.put(val, key)),
  del: (key) => tx('kv', 'readwrite', (s) => s.delete(key)),
  async persist() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch {}
    return false;
  },
};
