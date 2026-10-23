// KV-style API over Durable Object storage (see state.js for why state left KV).
/**
 * The KV methods the handlers use (get / put with expirationTtl / delete / list),
 * backed by Durable Object storage. Values are stored as { v, exp }.
 */
export function storageKv(storage) {
  const live = (rec) => rec && !(rec.exp && rec.exp < Date.now());
  return {
    async get(key, opts) {
      const rec = await storage.get(key);
      if (!live(rec)) return null;
      return opts && opts.type === 'json' ? JSON.parse(rec.v) : rec.v;
    },
    async put(key, value, opts) {
      const exp = opts && opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0;
      await storage.put(key, { v: String(value), exp });
    },
    async delete(key) {
      await storage.delete(key);
    },
    async list({ prefix } = {}) {
      const map = await storage.list({ prefix });
      const keys = [...map].filter(([, rec]) => live(rec)).map(([name]) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}
