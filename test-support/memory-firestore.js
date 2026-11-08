// In-memory subset of Firestore for tests and local previews (no network).
const clone = value => value === undefined ? undefined : structuredClone(value);
export function createFakeFirestore(initial = {}) {
  const store = new Map(Object.entries(initial));
  const match = (data, [key, op, value]) => {
    const field = key.split('.').reduce((acc, part) => acc?.[part], data);
    return op === '==' ? field === value : op === '>=' ? field >= value : op === '<=' ? field <= value : op === '<' ? field < value : op === '>' ? field > value : op === 'in' ? value.includes(field) : false;
  };
  const snap = (path) => ({ id: path.split('/').pop(), ref: doc(path), exists: store.has(path), data: () => clone(store.get(path)) });
  function doc(path) {
    const parts = path.split('/');
    return { id: parts.at(-1), path, parent: { id: parts.at(-2), path: parts.slice(0, -1).join('/') },
      collection: name => collection(`${path}/${name}`),
      get: async () => snap(path),
      set: async (data, options) => { store.set(path, options?.merge ? { ...(store.get(path) || {}), ...clone(data) } : clone(data)); },
      create: async data => { if (store.has(path)) throw Object.assign(new Error(`ALREADY_EXISTS ${path}`), { code: 6 }); store.set(path, clone(data)); },
      update: async data => { if (!store.has(path)) throw new Error(`NOT_FOUND ${path}`); store.set(path, { ...store.get(path), ...clone(data) }); },
      delete: async () => { store.delete(path); } };
  }
  function query(prefix, filters = [], max = Infinity, group = false) {
    const run = async () => {
      const docs = [...store.keys()].filter(key => {
        const parts = key.split('/');
        if (group) return parts.length % 2 === 0 && parts.at(-2) === prefix;
        return key.startsWith(`${prefix}/`) && !key.slice(prefix.length + 1).includes('/');
      }).sort().filter(key => filters.every(filter => match(store.get(key), filter))).slice(0, max).map(snap);
      return { docs, empty: !docs.length, size: docs.length, forEach: fn => docs.forEach(fn) };
    };
    return { path: prefix, id: prefix.split('/').pop(), doc: id => doc(`${prefix}/${id ?? Math.random().toString(36).slice(2)}`),
      where: (key, op, value) => query(prefix, [...filters, [key, op, value]], max, group), limit: count => query(prefix, filters, count, group),
      orderBy: () => query(prefix, filters, max, group), get: run };
  }
  const collection = path => query(path);
  function writer() {
    const ops = [];
    const api = { set: (ref, data, options) => { ops.push(() => ref.set(data, options)); return api; }, create: (ref, data) => { ops.push(() => ref.create(data)); return api; },
      update: (ref, data) => { ops.push(() => ref.update(data)); return api; }, delete: ref => { ops.push(() => ref.delete()); return api; },
      commit: async () => { for (const op of ops) await op(); } };
    return api;
  }
  const db = { collection, doc, collectionGroup: name => query(name, [], Infinity, true), batch: writer,
    async runTransaction(callback) { const w = writer(); const result = await callback({ get: target => target.get(), getAll: (...refs) => Promise.all(refs.map(r => r.get())), ...w }); await w.commit(); return result; },
    async terminate() {}, store };
  return db;
}
