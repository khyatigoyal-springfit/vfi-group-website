'use strict';
// In-memory sliding-window limiter (per server instance). Used for admin login failures.

function createLimiter({ max, windowMs, maxKeys = 10000 }) {
  const hits = new Map(); // key -> [timestamps]
  const live = (key, now) => {
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  return {
    /** Record one event. */
    hit(key, now = Date.now()) {
      if (hits.size >= maxKeys && !hits.has(key)) {
        for (const k of hits.keys()) { if (!live(k, now).length) hits.delete(k); }
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      }
      const list = live(key, now);
      list.push(now);
      hits.set(key, list);
      return list.length;
    },
    /** True when `max` or more events happened within the window. */
    isLimited(key, now = Date.now()) { return live(key, now).length >= max; },
    reset(key) { hits.delete(key); },
    clear() { hits.clear(); },
  };
}

module.exports = { createLimiter };
