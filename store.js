// Local save on this device (IndexedDB). Live crew sync is added in build step 3.
const Store = (() => {
  const DB = "scene-blocker", ST = "kv";
  let dbp;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(ST);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function get(k) {
    try {
      const d = await db();
      return await new Promise((res, rej) => { const t = d.transaction(ST).objectStore(ST).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
    } catch (e) { return undefined; }
  }
  async function set(k, v) {
    try {
      const d = await db();
      await new Promise((res, rej) => { const t = d.transaction(ST, "readwrite"); t.objectStore(ST).put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
    } catch (e) { console.warn("save failed", e); }
  }
  return { get, set };
})();
