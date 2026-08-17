import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TraderTracker } from "../docs/tracker.js";

export class TraderJobs {
  constructor({ dataDir, rest = null, accounts = null }) {
    this.path = path.join(dataDir, "tracker.json");
    this.rest = rest;
    this.accounts = accounts;
    this.tracker = new TraderTracker();
    this.boardCache = [];
    this.persistTimer = null;
    this.dirty = false;
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      this.tracker = TraderTracker.fromJSON(raw);
      this.refreshBoard();
      console.log(
        `Trader ledger  wallets=${this.tracker.wallets.size} pumps=${this.tracker.stats.pumps} sales=${this.tracker.stats.sales}`,
      );
    } catch {
      this.tracker = new TraderTracker();
    }
  }

  ingest(event) {
    this.tracker.ingest(event);
    this.dirty = true;
  }

  setAccount(address, profile) {
    this.tracker.setAccount(address, profile);
  }

  refreshBoard(mutes) {
    this.boardCache = this.tracker.board({ mutes, limit: 16 });
    this.tracker.stats.wallets = this.tracker.wallets.size;
    return this.boardCache;
  }

  payload(mutes) {
    return {
      traders: this.refreshBoard(mutes),
      stats: this.tracker.stats,
    };
  }

  start() {
    this.persistTimer = setInterval(() => {
      this.tracker.prune();
      this.refreshBoard();
      if (this.dirty) this.save().catch((err) => console.warn("tracker save", err.message));
    }, 30_000);
    setInterval(() => this.tracker.prune(), 120_000);
  }

  async save() {
    this.dirty = false;
    this.tracker.stats.lastPersistAt = Date.now();
    await writeFile(this.path, JSON.stringify(this.tracker.toJSON()));
  }
}
