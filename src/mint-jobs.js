import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MintWatch, DROP_TYPES, normalizeDrop } from "../docs/mints.js";

const CHAIN = process.env.CHAIN ?? "robinhood";

function parseWallets(env) {
  const raw = [
    env.MINT_WALLET_ADDRESS,
    env.MINT_WATCH_WALLETS,
  ]
    .filter(Boolean)
    .join(",");
  const wallets = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s));
  return [...new Set(wallets)];
}

export class MintJobs {
  constructor({ dataDir, rest, env = process.env }) {
    this.dataDir = dataDir;
    this.path = path.join(dataDir, "mints.json");
    this.rest = rest;
    this.chain = env.CHAIN ?? CHAIN;
    this.wallets = parseWallets(env);
    this.wallet = this.wallets[0] ?? null;
    this.watch = new MintWatch();
    this.detailQueue = [];
    this.detailQueued = new Set();
    this.eligQueue = [];
    this.eligQueued = new Set();
    this.busy = false;
    this.eligBusy = false;
    this.dirty = false;
    this.lastCalendarAt = 0;
    this.lastScanAt = 0;
    this.stats = { polls: 0, lastError: null };
  }

  async load() {
    try {
      this.watch = MintWatch.fromJSON(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      this.watch = new MintWatch();
    }
    console.log(`Mint watch  ${this.watch.drops.size} drops · wallet=${this.wallet ?? "none"}`);
  }

  start() {
    setTimeout(() => this.pollCalendar().catch((err) => this.fail(err)), 8_000);
    setInterval(() => this.pollCalendar().catch((err) => this.fail(err)), 75_000);
    setInterval(() => this.scanNewest().catch((err) => this.fail(err)), 120_000);
    setInterval(() => this.pumpDetail().catch((err) => this.fail(err)), 3_000);
    setInterval(() => this.pumpEligibility().catch((err) => this.fail(err)), 4_000);
    setInterval(() => {
      this.watch.prune();
      if (this.dirty) this.save().catch((err) => console.warn("mint save", err.message));
    }, 30_000);
  }

  payload({ heat = [], projects = [] } = {}) {
    const heatBySlug = new Map(heat.map((h) => [h.slug, h]));
    const projectBySlug = new Map(projects.map((p) => [p.slug, p]));
    return {
      mints: this.watch.board({ heatBySlug, projectBySlug, limit: 16 }),
      stats: {
        ...this.watch.stats,
        ...this.stats,
        wallet: this.wallet,
        queued: this.detailQueue.length,
      },
    };
  }

  fail(err) {
    this.stats.lastError = err?.message ?? String(err);
    console.warn("mint job", this.stats.lastError);
  }

  enqueueDetail(slug, source = "scan") {
    if (!slug || this.detailQueued.has(slug) || !this.watch.shouldProbe(slug)) return;
    this.detailQueued.add(slug);
    this.detailQueue.push({ slug, source });
    if (this.detailQueue.length > 40) this.detailQueue.shift();
  }

  enqueueElig(slug) {
    if (!slug || !this.wallet || this.eligQueued.has(slug)) return;
    const row = this.watch.drops.get(slug);
    if (!row?.isMinting) return;
    if (row.eligible != null && Date.now() - (row.eligAt ?? 0) < 3 * 60 * 1000) return;
    this.eligQueued.add(slug);
    this.eligQueue.push(slug);
    if (this.eligQueue.length > 24) this.eligQueue.shift();
  }

  ingestCalendar(drop, calendarType) {
    const row = normalizeDrop(drop, { source: "calendar", calendarType, chain: this.chain });
    if (!row) return;
    this.watch.upsert(row);
    this.dirty = true;
    if (row.isMinting) this.enqueueElig(row.slug);
    if (!drop.active_stage && !drop.stages) this.enqueueDetail(row.slug, "calendar");
  }

  async pollCalendar() {
    if (!this.rest?.hasKeys) return;
    this.lastCalendarAt = Date.now();
    this.stats.polls += 1;
    for (const type of DROP_TYPES) {
      const { drops } = await this.rest.listDrops({
        type,
        chains: this.chain,
        limit: 50,
      });
      for (const drop of drops) this.ingestCalendar(drop, type);
    }
  }

  async scanNewest() {
    if (!this.rest?.hasKeys) return;
    this.lastScanAt = Date.now();
    const rows = await this.rest.listNewestCollections(this.chain, { limit: 40 });
    for (const col of rows) {
      const slug = col.collection || col.slug;
      if (!slug) continue;
      if (this.watch.drops.has(slug)) continue;
      this.enqueueDetail(slug, "scan");
    }
  }

  async pumpDetail() {
    if (this.busy || !this.detailQueue.length || !this.rest?.hasKeys) return;
    const item = this.detailQueue.shift();
    this.detailQueued.delete(item.slug);
    this.busy = true;
    try {
      const detail = await this.rest.getDrop(item.slug);
      if (!detail) {
        this.watch.markNoDrop(item.slug);
        return;
      }
      const row = normalizeDrop(detail, {
        source: item.source,
        chain: this.chain,
      });
      if (!row) {
        this.watch.markNoDrop(item.slug);
        return;
      }
      if (row.status === "ended" && !row.isMinting) {
        this.watch.markNoDrop(item.slug, 60 * 60 * 1000);
        return;
      }
      this.watch.upsert(row);
      this.dirty = true;
      if (row.isMinting) this.enqueueElig(row.slug);
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (msg.includes("OpenSea 404")) this.watch.markNoDrop(item.slug);
      else throw err;
    } finally {
      this.busy = false;
    }
  }

  async pumpEligibility() {
    if (this.eligBusy || !this.eligQueue.length || !this.wallet || !this.rest?.hasKeys) return;
    const slug = this.eligQueue.shift();
    this.eligQueued.delete(slug);
    const row = this.watch.drops.get(slug);
    if (!row?.isMinting) return;
    this.eligBusy = true;
    try {
      const result = await this.rest.checkMintEligibility(slug, this.wallet);
      this.watch.upsert(row, {
        eligible: result.eligible,
        eligibleReason: result.reason ?? null,
        eligAt: Date.now(),
      });
      this.dirty = true;
    } catch (err) {
      console.warn("mint elig", slug, err.message);
    } finally {
      this.eligBusy = false;
    }
  }

  async save() {
    this.dirty = false;
    await writeFile(this.path, JSON.stringify(this.watch.toJSON()));
  }
}
