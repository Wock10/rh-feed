import { normalizeStreamEvent } from "./normalize.js";
import { TraderTracker } from "./tracker.js";
import { ProjectWatch, extractMeta, extractStats } from "./projects.js";
import { MintWatch, DROP_TYPES, normalizeDrop } from "./mints.js";
import { UserBook, summarizeOpenSea } from "./users.js";

const WS_URL = "wss://stream-api.opensea.io/socket/websocket";
const EVENT_TYPES = [
  "item_sold",
  "item_listed",
  "item_transferred",
  "item_received_bid",
  "item_received_offer",
  "collection_offer",
  "trait_offer",
];
const MAX_EVENTS = 1500;
const TRACKER_KEY = "rh-feed-tracker";

function titleFromSlug(slug) {
  return String(slug ?? "")
    .replace(/-\d{5,}$/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || slug;
}

class BrowserStore {
  constructor() {
    this.events = [];
    this.seen = new Map();
    this.mutes = new Map();
    this.collections = new Map();
    this.collectionFirstSeen = new Map();
    this.noise = [];
    this.minuteBucket = [];
    this.stats = { received: 0, kept: 0, rhPerMin: 0, lastEventAt: 0 };
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
    this.mutes.delete(slug);
  }

  ingest(event) {
    this.stats.received += 1;
    this.stats.lastEventAt = event.ts || Date.now();
    this.minuteBucket.push(Date.now());
    this.trimMinute();
    this.stats.rhPerMin = this.minuteBucket.length;

    if (event.slug) {
      const known = this.collections.get(event.slug);
      event.collectionName = known?.name || event.collectionName || titleFromSlug(event.slug);
      if (!known) {
        this.collections.set(event.slug, {
          name: event.collectionName,
          image: event.image || null,
        });
      } else if (event.image && !known.image) {
        known.image = event.image;
      }
      this.noise.push({ slug: event.slug, type: event.type, ts: Date.now() });
      if (this.noise.length > 8000) this.noise.splice(0, this.noise.length - 5000);
      if (!this.collectionFirstSeen.has(event.slug)) {
        this.collectionFirstSeen.set(event.slug, event.ts || Date.now());
      }
    }

    if (this.seen.has(event.id)) return null;
    this.seen.set(event.id, event.ts);
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) {
      const dropped = this.events.splice(MAX_EVENTS);
      for (const old of dropped) this.seen.delete(old.id);
    }
    this.stats.kept += 1;
    return event;
  }

  snapshot({ types, limit = 120 } = {}) {
    const typeSet = types?.length ? new Set(types) : null;
    const out = [];
    for (const event of this.events) {
      if (typeSet && !typeSet.has(event.type)) continue;
      if (this.isMuted(event.slug)) continue;
      out.push(event);
      if (out.length >= limit) break;
    }
    return out;
  }

  noiseBoard({ types, limit = 25 } = {}) {
    const cutoff = Date.now() - 60_000;
    const typeSet = types?.length ? new Set(types) : null;
    this.noise = this.noise.filter((n) => n.ts >= cutoff);
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
      if (event.toImage) row.buyerImage = event.toImage;
    }
    return [...groups.values()]
      .filter((row) => row.count >= min)
      .sort((a, b) => b.count - a.count || b.usd - a.usd)
      .slice(0, 8)
      .map((row) => ({ ...row, usd: Math.round(row.usd * 100) / 100 }));
  }

  listCollections() {
    return [...this.collections.entries()].map(([slug, row]) => ({
      slug,
      name: row.name || slug,
      image: row.image ?? null,
    }));
  }

  trimMinute() {
    const cutoff = Date.now() - 60_000;
    while (this.minuteBucket.length && this.minuteBucket[0] < cutoff) {
      this.minuteBucket.shift();
    }
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

export class RhFeedEngine {
  constructor({ apiKey, chain = "robinhood" } = {}) {
    this.apiKey = apiKey;
    this.chain = chain;
    this.store = new BrowserStore();
    this.handlers = new Map();
    this.ws = null;
    this.heartbeat = null;
    this.reconnectTimer = null;
    this.flushTimer = null;
    this.trendTimer = null;
    this.ref = 1;
    this.closed = true;
    this.backoffMs = 1000;
    this.pending = [];
    this.streamState = "connecting";
    this.tracker = loadTracker();
    this.projects = new ProjectWatch();
    this.projectQueue = [];
    this.projectBusy = false;
    this.mints = new MintWatch();
    this.users = new UserBook();
    this.mintWallet = null;
    this.mintBusy = false;
    this.eligBusy = false;
    this.persistTimer = null;
    this.projectTimer = null;
    this.mintTimer = null;
    this.mintElTimer = null;
  }

  on(name, fn) {
    this.handlers.set(name, fn);
  }

  emit(name, data) {
    this.handlers.get(name)?.(data);
  }

  start() {
    this.closed = false;
    this.connect();
    this.flushTimer = setInterval(() => this.flush(), 80);
    this.trendTimer = setInterval(() => this.emitTrends(), 2000);
    this.persistTimer = setInterval(() => persistTracker(this.tracker), 30_000);
    this.projectTimer = setInterval(() => this.pumpProjects(), 6000);
    this.mintTimer = setInterval(() => this.pollMints(), 90_000);
    this.mintElTimer = setInterval(() => this.pumpMintElig(), 8000);
    this.emitHello();
    this.pollMints();
  }

  stop() {
    this.closed = true;
    clearInterval(this.flushTimer);
    clearInterval(this.trendTimer);
    clearInterval(this.persistTimer);
    clearInterval(this.projectTimer);
    clearInterval(this.mintTimer);
    clearInterval(this.mintElTimer);
    persistTracker(this.tracker);
    this.teardown();
  }

  mute(slug, name) {
    return this.store.mute(slug, name);
  }

  unmute(slug) {
    this.store.unmute(slug);
  }

  snapshot(types) {
    const typeList = !types || types === "all" ? null : String(types).split(",").filter(Boolean);
    return {
      events: this.store.snapshot({ types: typeList, limit: 120 }),
      mutes: [...this.store.mutes.values()],
      noise: this.store.noiseBoard({ types: typeList }),
      heat: this.store.heat({ types: typeList ?? ["sale"] }),
      sweeps: this.store.sweeps(),
      traders: this.tracker.board({
        mutes: new Set(this.store.mutes.keys()),
        limit: 16,
      }),
      traderStats: this.tracker.stats,
      projects: this.projects.board({ limit: 12 }),
      projectStats: this.projects.stats,
      ...this.mintPayload(),
      collections: this.store.listCollections(),
      status: { stream: this.streamState, ...this.store.status() },
    };
  }

  emitHello() {
    this.emit("hello", this.snapshot("sale"));
  }

  emitTrends() {
    this.emit("trends", {
      heat: this.store.heat({ types: ["sale"] }),
      sweeps: this.store.sweeps(),
      traders: this.tracker.board({
        mutes: new Set(this.store.mutes.keys()),
        limit: 16,
      }),
      traderStats: this.tracker.stats,
      projects: this.projects.board({ limit: 12 }),
      projectStats: this.projects.stats,
      ...this.mintPayload(),
    });
  }

  flush() {
    if (!this.pending.length) return;
    const events = this.pending.splice(0);
    this.emit("events", { events });
  }

  connect() {
    if (this.closed) return;
    this.teardown(false);
    const url = `${WS_URL}?token=${encodeURIComponent(this.apiKey)}&vsn=2.0.0`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.backoffMs = 1000;
      this.streamState = "live";
      this.join();
      this.startHeartbeat();
      this.emit("status", { stream: "live", ...this.store.status() });
    });
    ws.addEventListener("message", (ev) => this.onMessage(ev.data));
    ws.addEventListener("close", () => {
      this.streamState = "reconnecting";
      this.emit("status", { stream: "reconnecting", ...this.store.status() });
      this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    });
  }

  join() {
    this.send(["1", String(this.ref++), "collection:*", "phx_join", { event_types: EVENT_TYPES }]);
  }

  startHeartbeat() {
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.send([null, String(this.ref++), "phoenix", "heartbeat", {}]);
    }, 25_000);
  }

  send(frame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(frame));
  }

  onMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(frame) || frame.length < 5) return;
    const eventName = frame[3];
    const payload = frame[4];
    if (eventName === "phx_reply" || eventName === "phx_error" || eventName === "phx_close") {
      return;
    }
    const event = normalizeStreamEvent(eventName, payload);
    if (!event) return;
    const kept = this.store.ingest(event);
    if (!kept) return;
    if (kept.type === "sale" || kept.type === "mint") this.tracker.ingest(kept);
    const proj = this.projects.notice(kept);
    if (proj?.status === "queued" && !this.projectQueue.includes(kept.slug)) {
      this.projectQueue.push(kept.slug);
      if (this.projectQueue.length > 16) this.projectQueue.shift();
    }
    if (this.store.isMuted(kept.slug)) return;
    this.pending.push(kept);
  }

  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.8, 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  teardown(clearReconnect = true) {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (clearReconnect) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  mintPayload() {
    const heat = this.store.heat({ types: ["sale"] });
    const heatBySlug = new Map(heat.map((h) => [h.slug, h]));
    const projectBySlug = this.projects.projects;
    return {
      mints: this.mints.board({ heatBySlug, projectBySlug, limit: 16 }),
      mintStats: {
        ...this.mints.stats,
        wallet: this.mintWallet,
      },
    };
  }

  setMintWallet(addr) {
    const next = String(addr ?? "").trim().toLowerCase();
    this.mintWallet = /^0x[a-f0-9]{40}$/.test(next) ? next : null;
    for (const row of this.mints.drops.values()) {
      row.eligible = null;
      row.eligibleReason = null;
      row.eligAt = 0;
    }
  }

  async pollMints() {
    if (this.mintBusy || !this.apiKey || this.closed) return;
    this.mintBusy = true;
    try {
      for (const type of DROP_TYPES) {
        const url = new URL("https://api.opensea.io/api/v2/drops");
        url.searchParams.set("type", type);
        url.searchParams.set("chains", this.chain);
        url.searchParams.set("limit", "50");
        const res = await fetch(url, {
          headers: { accept: "application/json", "x-api-key": this.apiKey },
        });
        if (!res.ok) continue;
        const data = await res.json();
        for (const drop of data?.drops ?? []) {
          const row = normalizeDrop(drop, {
            source: "calendar",
            calendarType: type,
            chain: this.chain,
          });
          if (row) this.mints.upsert(row);
        }
      }
    } catch {
      // ignore calendar gaps
    } finally {
      this.mintBusy = false;
    }
  }

  async pumpMintElig() {
    if (this.eligBusy || !this.apiKey || !this.mintWallet || this.closed) return;
    const next = [...this.mints.drops.values()].find(
      (row) =>
        row.isMinting &&
        (row.eligible == null || Date.now() - (row.eligAt ?? 0) > 3 * 60 * 1000),
    );
    if (!next) return;
    this.eligBusy = true;
    try {
      const res = await fetch(
        `https://api.opensea.io/api/v2/drops/${encodeURIComponent(next.slug)}/mint`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: JSON.stringify({ minter: this.mintWallet, quantity: 1 }),
        },
      );
      const text = await res.text();
      if (res.ok) {
        this.mints.upsert(next, { eligible: true, eligibleReason: null, eligAt: Date.now() });
      } else if (/not eligible/i.test(text)) {
        this.mints.upsert(next, { eligible: false, eligibleReason: "not eligible", eligAt: Date.now() });
      } else if (/fully minted|sold out|insufficient supply/i.test(text)) {
        this.mints.upsert(next, { eligible: false, eligibleReason: "minted out", eligAt: Date.now() });
      } else if (/insufficient balance/i.test(text)) {
        this.mints.upsert(next, { eligible: true, eligibleReason: "low balance", eligAt: Date.now() });
      }
    } catch {
      // ignore
    } finally {
      this.eligBusy = false;
    }
  }

  async loadUser(address) {
    const addr = String(address || "").toLowerCase();
    const cached = this.users.fresh(addr);
    if (cached) return cached;
    if (!this.apiKey) {
      return this.users.card(addr) ?? { address: addr, empty: true, source: "opensea" };
    }
    const headers = { accept: "application/json", "x-api-key": this.apiKey };
    const [accountRes, eventsRes] = await Promise.all([
      fetch(`https://api.opensea.io/api/v2/accounts/${encodeURIComponent(addr)}`, { headers }),
      fetch(
        `https://api.opensea.io/api/v2/events/accounts/${encodeURIComponent(addr)}?chain=${encodeURIComponent(this.chain)}&limit=50`,
        { headers },
      ),
    ]);
    const account = accountRes.ok ? await accountRes.json() : null;
    const page = eventsRes.ok ? await eventsRes.json() : { asset_events: [] };
    const card = summarizeOpenSea(addr, {
      account,
      events: page.asset_events ?? [],
    });
    this.users.put(card);
    return card;
  }

  async pumpProjects() {
    if (this.projectBusy || !this.projectQueue.length || !this.apiKey) return;
    const slug = this.projectQueue.shift();
    const row = this.projects.projects.get(slug);
    if (!row || row.status === "scored") return;
    this.projectBusy = true;
    try {
      const res = await fetch(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`, {
        headers: { accept: "application/json", "x-api-key": this.apiKey },
      });
      if (res.ok) {
        const raw = await res.json();
        const meta = extractMeta(raw);
        this.projects.applyMeta(slug, meta);
      }
      try {
        const statsRes = await fetch(
          `https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}/stats`,
          { headers: { accept: "application/json", "x-api-key": this.apiKey } },
        );
        if (statsRes.ok) {
          this.projects.applyStats(slug, extractStats(await statsRes.json()));
        }
      } catch {
        // collection meta is enough to score
      }
      row.status = "scored";
      this.projects.rescore(row);
    } catch {
      row.status = "error";
    } finally {
      this.projectBusy = false;
    }
  }
}

function loadTracker() {
  try {
    return TraderTracker.fromJSON(JSON.parse(localStorage.getItem(TRACKER_KEY) ?? "null"));
  } catch {
    return new TraderTracker();
  }
}

function persistTracker(tracker) {
  try {
    tracker.prune();
    localStorage.setItem(TRACKER_KEY, JSON.stringify(tracker.toJSON()));
  } catch {
    try {
      localStorage.removeItem(TRACKER_KEY);
    } catch {
      // ignore
    }
  }
}
