import { peekFromOpenSea } from "../docs/projects.js";

const FRESH_MS = 3 * 60 * 1000;
const MAX = 200;

export class CollectionJobs {
  constructor({ rest, projects = null }) {
    this.rest = rest;
    this.projects = projects;
    this.cache = new Map();
    this.inflight = new Map();
  }

  peek(slug) {
    const key = String(slug || "").trim();
    if (!key) return Promise.resolve(null);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.card);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = this.fetch(key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  async fetch(slug) {
    if (!this.rest?.hasKeys) return null;
    const [raw, statsRaw] = await Promise.all([
      this.rest.getCollection(slug),
      this.rest.getCollectionStats(slug).catch(() => null),
    ]);
    const card = peekFromOpenSea(raw, statsRaw);
    const known = this.projects?.watch?.projects?.get(slug);
    if (known?.llm) {
      card.verdict = known.verdict || card.verdict;
      card.confidence = known.confidence ?? card.confidence;
      card.flags = known.flags?.length ? known.flags : card.flags;
      card.llm = known.llm;
    } else if (known?.verdict && known.status === "scored") {
      card.verdict = known.verdict;
      card.confidence = known.confidence ?? card.confidence;
      if (known.flags?.length) card.flags = known.flags;
    }
    this.cache.set(slug, { at: Date.now(), card });
    if (this.cache.size > MAX) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
    return card;
  }
}
