// Tiny promise wrapper around IndexedDB. Everything the dashboard stores locally lives here.
const DB_NAME = 'scopus-ai-scanner-v2';
const DB_VERSION = 1;
let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('papers')) {
        const s = db.createObjectStore('papers', { keyPath: 'key' });
        s.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s, t)).then((r) => (result = r), reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// ---- projects
export const listProjects = () => tx('projects', 'readonly', (s) => reqP(s.getAll()));
export const getProject = (id) => tx('projects', 'readonly', (s) => reqP(s.get(id)));
export const saveProject = (project) => tx('projects', 'readwrite', (s) => reqP(s.put(project)));
export async function deleteProject(id) {
  await clearPapers(id);
  return tx('projects', 'readwrite', (s) => reqP(s.delete(id)));
}

// ---- papers (key = `${projectId}|${signature}`)
export const listPapers = (projectId) =>
  tx('papers', 'readonly', (s) => reqP(s.index('projectId').getAll(IDBKeyRange.only(projectId))));
export const putPaper = (paper) => tx('papers', 'readwrite', (s) => reqP(s.put(paper)));
export const getPaper = (key) => tx('papers', 'readonly', (s) => reqP(s.get(key)));
export const deletePaper = (key) => tx('papers', 'readwrite', (s) => reqP(s.delete(key)));
export function putPapers(papers) {
  return tx('papers', 'readwrite', (s) => {
    for (const p of papers) s.put(p);
  });
}
export async function clearPapers(projectId) {
  const papers = await listPapers(projectId);
  return tx('papers', 'readwrite', (s) => {
    for (const p of papers) s.delete(p.key);
  });
}

// ---- key/value
export const getKV = (k) => tx('kv', 'readonly', (s) => reqP(s.get(k))).then((r) => r?.v);
export const setKV = (k, v) => tx('kv', 'readwrite', (s) => reqP(s.put({ k, v })));
