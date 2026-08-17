import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_EVENTS = 1500;
const NOISE_WINDOW_MS = 60_000;

export class FeedStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.mutesPath = path.join(dataDir, "mutes.json");
    this.accountsPath = path.join(dataDir, "accounts.json");
    /** @type {object[]} */
    this.events = [];
    /** @type {Map<string, object>} */
    this.seen = new Map();
    /** @type {Map<string, { slug: string, name: string, mutedAt: number }>} */
    this.mutes = new Map();
    /** @type {Map<string, { name: string, image: string|null }>} */
    this.collections = new Map();
    /** @type {Map<string, { name: string|null, url: string }>} */
    this.accounts = new Map();
    /** @type {{ slug: string, type: string, ts: number }[]} */
    this.noise = [];
    /** @type {Map<string, number>} */
    this.collectionFirstSeen = new Map();
    this.stats = {
      received: 0,
      kept: 0,
      rhPerMin: 0,
      lastEventAt: 0,
    };
    this.minuteBucket = [];
  }

  async load() {
    await mkdir(this.dataDir, { recursive: true });
    this.mutes = await readMap(this.mutesPath, (row) => [row.slug, row]);
    const accounts = await readJson(this.accountsPath, {});
    for (const [addr, profile] of Object.entries(accounts)) {
      this.accounts.set(addr.toLowerCase(), profile);
    }
  }

  async saveMutes() {
    const rows = [...this.mutes.values()].sort((a, b) => a.slug.localeCompare(b.slug));
    await writeFile(this.mutesPath, JSON.stringify(rows, null, 2));
  }

  async saveAccounts() {
    const obj = Object.fromEntries(this.accounts);
    await writeFile(this.accountsPath, JSON.stringify(obj));
  }

  addCollections(rows) {
    for (const row of rows) {
      const slug = row.collection || row.slug;
      if (!slug) continue;
      this.collections.set(slug, {
        name: row.name || slug,
        image: row.image_url || null,
      });
    }
  }

  isMuted(slug) {
    return slug ? this.mutes.has(slug) : false;
  }

  mute(slug, name) {
    if (!slug) return null;
    const row = {
      slug,
      name: name || this.collections.get(slug)?.name || slug,
      mutedAt: Date.now(),
    };
    this.mutes.set(slug, row);
    return row;
  }

  unmute(slug) {
    const had = this.mutes.get(slug);
    this.mutes.delete(slug);
    return had ?? null;
  }

  ingest(event) {
    this.stats.received += 1;
    this.stats.lastEventAt = event.ts || Date.now();
    this.minuteBucket.push(Date.now());
    this.trimMinute();
    this.stats.rhPerMin = this.minuteBucket.length;

    if (event.slug) {
      const known = this.collections.get(event.slug);
      event.collectionName = known?.name || titleFromSlug(event.slug);
      if (event.image && !known) {
        this.collections.set(event.slug, {
          name: event.collectionName,
          image: event.image,
        });
      } else if (!known) {
        this.collections.set(event.slug, {
          name: event.collectionName,
          image: event.image || null,
        });
      }
      this.noise.push({ slug: event.slug, type: event.type, ts: Date.now() });
      if (this.noise.length > 8000) this.noise.splice(0, this.noise.length - 5000);
    }

    if (event.slug && !this.collectionFirstSeen.has(event.slug)) {
      this.collectionFirstSeen.set(event.slug, event.ts || Date.now());
    }

    if (this.seen.has(event.id)) return null;
    this.seen.set(event.id, event.ts);
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) {
      const dropped = this.events.splice(MAX_EVENTS);
      for (const old of dropped) this.seen.delete(old.id);
    }
    if (this.seen.size > MAX_EVENTS * 2) {
      this.seen = new Map(this.events.map((e) => [e.id, e.ts]));
    }
    this.stats.kept += 1;
    this.applyProfiles(event);
    return event;
  }

  applyProfiles(event) {
    for (const key of ["from", "to"]) {
      const addr = event[key];
      if (!addr) continue;
      const profile = this.accounts.get(addr);
      if (profile) {
        event[`${key}Name`] = profile.name;
        event[`${key}Url`] = profile.url;
      } else {
        event[`${key}Name`] = null;
        event[`${key}Url`] = `https://opensea.io/${addr}`;
      }
    }
  }

  snapshot({ types, includeMuted = false, limit = 120 } = {}) {
    const typeSet = types?.length ? new Set(types) : null;
    const out = [];
    for (const event of this.events) {
      if (typeSet && !typeSet.has(event.type)) continue;
      if (!includeMuted && this.isMuted(event.slug)) continue;
      out.push(event);
      if (out.length >= limit) break;
    }
    return out;
  }

  noiseBoard({ types, limit = 25 } = {}) {
    const cutoff = Date.now() - NOISE_WINDOW_MS;
    const typeSet = types?.length ? new Set(types) : null;
    this.noise = this.noise.filter((n) => n.ts >= cutoff);
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const n of this.noise) {
      if (typeSet && !typeSet.has(n.type)) continue;
      counts.set(n.slug, (counts.get(n.slug) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([slug, count]) => {
        const col = this.collections.get(slug);
        const mute = this.mutes.get(slug);
        return {
          slug,
          name: mute?.name || col?.name || slug,
          image: col?.image ?? null,
          count,
          muted: Boolean(mute),
        };
      });
  }

  heat({ types, limit = 12 } = {}) {
    const now = Date.now();
    const typeSet = types?.length ? new Set(types) : new Set(["sale"]);
    typeSet.add("listing");
    /** @type {Map<string, object>} */
    const buckets = new Map();

    for (const event of this.events) {
      if (!typeSet.has(event.type)) continue;
      if (!event.slug || this.isMuted(event.slug)) continue;
      const age = now - event.ts;
      if (age > 15 * 60 * 1000) continue;
      let row = buckets.get(event.slug);
      if (!row) {
        row = {
          slug: event.slug,
          name: event.collectionName || event.slug,
          image: this.collections.get(event.slug)?.image ?? event.image ?? null,
          n1: 0,
          n5: 0,
          n15: 0,
          list5: 0,
          usd1: 0,
          usd5: 0,
          buyers: new Set(),
          lastUsd: null,
          prevUsd: null,
          lastTs: 0,
        };
        buckets.set(event.slug, row);
      }
      if (event.type === "listing") {
        if (age <= 5 * 60 * 1000) row.list5 += 1;
        continue;
      }
      const usd = Number(event.price?.usd);
      const hasUsd = Number.isFinite(usd);
      if (age <= 60_000) {
        row.n1 += 1;
        if (hasUsd) row.usd1 += usd;
      }
      if (age <= 5 * 60 * 1000) {
        row.n5 += 1;
        if (hasUsd) row.usd5 += usd;
        if (event.to) row.buyers.add(event.to);
      }
      row.n15 += 1;
      if (event.ts >= row.lastTs) {
        if (row.lastUsd != null) row.prevUsd = row.lastUsd;
        row.lastUsd = hasUsd ? usd : row.lastUsd;
        row.lastTs = event.ts;
      }
    }

    return [...buckets.values()]
      .map((row) => {
        const perMin15 = row.n15 / 15;
        const accel =
          perMin15 >= 0.2 ? row.n1 / perMin15 : row.n1 >= 3 ? 3 : row.n1;
        const flags = [];
        if (row.n1 >= 3 && accel >= 2.2) flags.push("hot");
        const first = this.collectionFirstSeen.get(row.slug);
        if (first && now - first < 20 * 60 * 1000 && row.n5 >= 1) flags.push("new");
        if (row.buyers.size > 0 && row.n5 >= 4 && row.buyers.size <= Math.max(1, row.n5 / 3)) {
          flags.push("sweep");
        }
        if (row.n1 >= 2 && row.buyers.size >= Math.max(2, row.n1 * 0.8)) flags.push("organic");
        if (row.list5 >= 8 && row.n5 <= Math.max(1, row.list5 / 6)) flags.push("dump");
        const delta =
          row.lastUsd != null && row.prevUsd > 0
            ? (row.lastUsd - row.prevUsd) / row.prevUsd
            : null;
        return {
          slug: row.slug,
          name: row.name,
          image: row.image,
          n1: row.n1,
          n5: row.n5,
          buyers: row.buyers.size,
          usd1: Math.round(row.usd1 * 100) / 100,
          usd5: Math.round(row.usd5 * 100) / 100,
          lastUsd: row.lastUsd,
          delta,
          accel: Math.round(accel * 10) / 10,
          flags,
        };
      })
      .filter((row) => row.n5 > 0 || row.flags.includes("dump"))
      .sort((a, b) => {
        const score = (x) =>
          (x.flags.includes("hot") ? 80 : 0) +
          (x.flags.includes("new") ? 40 : 0) +
          (x.flags.includes("organic") ? 20 : 0) +
          (x.flags.includes("dump") ? -30 : 0) +
          x.n1 * 6 +
          x.n5;
        return score(b) - score(a);
      })
      .slice(0, limit);
  }

  sweeps({ windowMs = 40_000, min = 3 } = {}) {
    const now = Date.now();
    /** @type {Map<string, object>} */
    const groups = new Map();
    for (const event of this.events) {
      if (event.type !== "sale" || !event.slug || !event.to) continue;
      if (this.isMuted(event.slug)) continue;
      if (now - event.ts > windowMs) continue;
      const key = `${event.to}:${event.slug}`;
      let row = groups.get(key);
      if (!row) {
        row = {
          buyer: event.to,
          buyerName: event.toName || null,
          slug: event.slug,
          name: event.collectionName || event.slug,
          count: 0,
          usd: 0,
        };
        groups.set(key, row);
      }
      row.count += 1;
      if (Number.isFinite(event.price?.usd)) row.usd += event.price.usd;
      if (event.toName) row.buyerName = event.toName;
    }
    return [...groups.values()]
      .filter((row) => row.count >= min)
      .sort((a, b) => b.count - a.count || b.usd - a.usd)
      .slice(0, 8)
      .map((row) => ({
        ...row,
        usd: Math.round(row.usd * 100) / 100,
      }));
  }

  setAccount(address, profile) {
    const addr = address.toLowerCase();
    this.accounts.set(addr, profile);
    for (const event of this.events) {
      if (event.from === addr) {
        event.fromName = profile.name;
        event.fromUrl = profile.url;
      }
      if (event.to === addr) {
        event.toName = profile.name;
        event.toUrl = profile.url;
      }
    }
  }

  unknownAddresses(events, cap = 40) {
    const out = [];
    const seen = new Set();
    for (const event of events) {
      for (const addr of [event.from, event.to]) {
        if (!addr || seen.has(addr) || this.accounts.has(addr)) continue;
        seen.add(addr);
        out.push(addr);
        if (out.length >= cap) return out;
      }
    }
    return out;
  }

  trimMinute() {
    const cutoff = Date.now() - 60_000;
    while (this.minuteBucket.length && this.minuteBucket[0] < cutoff) {
      this.minuteBucket.shift();
    }
  }

  listCollections() {
    return [...this.collections.entries()].map(([slug, row]) => ({
      slug,
      name: row.name || slug,
      image: row.image ?? null,
    }));
  }

  status() {
    this.trimMinute();
    return {
      ...this.stats,
      rhPerMin: this.minuteBucket.length,
      muted: this.mutes.size,
      buffered: this.events.length,
      collections: this.collections.size,
    };
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readMap(file, toEntry) {
  const rows = await readJson(file, []);
  const map = new Map();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    const entry = toEntry(row);
    if (entry?.[0]) map.set(entry[0], entry[1]);
  }
  return map;
}

function titleFromSlug(slug) {
  return String(slug ?? "")
    .replace(/-\d{5,}$/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || slug;
}
