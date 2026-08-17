import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserBook, summarizeOpenSea } from "../docs/users.js";

const CHAIN = process.env.CHAIN ?? "robinhood";
const FRESH_MS = 2 * 60 * 1000;

export class UserJobs {
  constructor({ dataDir, rest, env = process.env }) {
    this.path = path.join(dataDir, "users.json");
    this.rest = rest;
    this.chain = env.CHAIN ?? CHAIN;
    this.book = new UserBook();
    this.dirty = false;
    this.inflight = new Map();
  }

  async load() {
    try {
      this.book = UserBook.fromJSON(JSON.parse(await readFile(this.path, "utf8")));
      console.log(`User book  ${this.book.users.size} OpenSea dossiers`);
    } catch {
      this.book = new UserBook();
    }
  }

  setAccount(address, profile) {
    this.book.setAccount(address, profile);
    this.dirty = true;
  }

  card(address) {
    return this.book.card(address);
  }

  async dossier(address) {
    const addr = String(address || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) return null;
    const fresh = this.book.fresh(addr, FRESH_MS);
    if (fresh) return fresh;
    if (this.inflight.has(addr)) return this.inflight.get(addr);
    const job = this.fetch(addr).finally(() => this.inflight.delete(addr));
    this.inflight.set(addr, job);
    return job;
  }

  async fetch(address) {
    if (!this.rest?.hasKeys) {
      return this.book.card(address) ?? { address, empty: true, source: "opensea" };
    }
    const [account, page] = await Promise.all([
      this.rest.getAccount(address).catch(() => null),
      this.rest.listAccountEvents(address, { chain: this.chain, limit: 50 }),
    ]);
    const card = summarizeOpenSea(address, {
      account,
      events: page.events,
    });
    this.book.put(card);
    this.dirty = true;
    return card;
  }

  start() {
    setInterval(() => {
      this.book.prune();
      if (this.dirty) this.save().catch((err) => console.warn("user save", err.message));
    }, 30_000);
  }

  async save() {
    this.dirty = false;
    await writeFile(this.path, JSON.stringify(this.book.toJSON()));
  }
}
