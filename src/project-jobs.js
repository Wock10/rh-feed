import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ProjectWatch,
  extractMeta,
  buildEvidence,
  htmlToText,
} from "../docs/projects.js";
import { CheapLlm } from "./cheap-llm.js";

const PROMPT_FILE = "prompts/vaporware.md";

export class ProjectJobs {
  constructor({ dataDir, docsDir, rest }) {
    this.dataDir = dataDir;
    this.docsDir = docsDir;
    this.path = path.join(dataDir, "projects.json");
    this.promptPath = path.join(docsDir, PROMPT_FILE);
    this.rest = rest;
    this.llm = new CheapLlm(process.env);
    this.watch = new ProjectWatch();
    this.queue = [];
    this.queued = new Set();
    this.busy = false;
    this.dirty = false;
  }

  async load() {
    try {
      this.watch = ProjectWatch.fromJSON(JSON.parse(await readFile(this.path, "utf8")));
      console.log(`Project watch  ${this.watch.projects.size} tracked`);
    } catch {
      this.watch = new ProjectWatch();
    }
  }

  markKnown(slugs) {
    this.watch.markKnown(slugs);
  }

  notice(event) {
    const row = this.watch.notice(event);
    if (!row) return;
    this.dirty = true;
    if (row.status === "queued" && !this.queued.has(row.slug)) {
      this.queued.add(row.slug);
      this.queue.push(row.slug);
      if (this.queue.length > 20) this.queue.shift();
    }
  }

  start() {
    setInterval(() => this.pump().catch((err) => console.warn("project job", err.message)), 4000);
    setInterval(() => {
      this.watch.prune();
      if (this.dirty) this.save().catch((err) => console.warn("project save", err.message));
    }, 30_000);
  }

  payload() {
    return {
      projects: this.watch.board({ limit: 12 }),
      stats: {
        ...this.watch.stats,
        queued: this.queue.length,
        llmEnabled: this.llm.enabled,
        llmAuto: this.llm.auto,
        llmRemaining: this.llm.remaining(),
      },
    };
  }

  async readPrompt() {
    return readFile(this.promptPath, "utf8");
  }

  async writePrompt(text) {
    const body = String(text ?? "").trim();
    if (body.length < 40) throw new Error("prompt too short");
    if (body.length > 8000) throw new Error("prompt too long");
    await writeFile(this.promptPath, body.endsWith("\n") ? body : `${body}\n`);
    return body;
  }

  async evidence(slug) {
    const row = this.watch.projects.get(slug);
    if (!row) return null;
    const prompt = await this.readPrompt();
    return { project: row, pack: buildEvidence(row, prompt) };
  }

  async review(slug) {
    const ev = await this.evidence(slug);
    if (!ev) throw new Error("unknown project");
    const llm = await this.llm.complete(ev.pack);
    this.watch.setLlm(slug, llm);
    this.dirty = true;
    return this.watch.projects.get(slug);
  }

  async pump() {
    if (this.busy || !this.queue.length || !this.rest?.hasKeys) return;
    const slug = this.queue.shift();
    this.queued.delete(slug);
    const row = this.watch.projects.get(slug);
    if (!row || row.status === "scored") return;
    this.busy = true;
    try {
      const raw = await this.rest.getCollection(slug);
      const meta = extractMeta(raw ?? { slug, name: row.name });
      this.watch.applyMeta(slug, meta);
      const site = await scrapeSite(meta.website, meta.twitter);
      this.watch.applySite(slug, site);
      this.dirty = true;
      if (this.llm.auto && this.llm.enabled && this.llm.remaining() > 0) {
        const verdict = this.watch.projects.get(slug)?.verdict;
        if (verdict === "thin") {
          await this.review(slug).catch((err) => console.warn("auto llm skipped", err.message));
        }
      }
    } catch (err) {
      row.status = "error";
      row.flags = [...new Set([...(row.flags ?? []), "fetch_failed"])];
      console.warn("project scrape", slug, err.message);
    } finally {
      this.busy = false;
    }
  }

  async save() {
    this.dirty = false;
    await writeFile(this.path, JSON.stringify(this.watch.toJSON()));
  }
}

async function scrapeSite(website, twitter) {
  const site = {
    title: "",
    text: "",
    chars: 0,
    status: null,
    twitter: null,
    twitterStatus: null,
  };
  if (website) {
    try {
      const page = await fetchLimited(website);
      site.status = page.status;
      const parsed = htmlToText(page.body);
      site.title = parsed.title;
      site.text = parsed.text;
      site.chars = parsed.chars;
      site.twitter = parsed.twitter;
    } catch {
      site.status = 0;
    }
  }
  if (twitter) {
    try {
      const page = await fetchLimited(`https://x.com/${encodeURIComponent(twitter)}`, { method: "GET" });
      site.twitterStatus = page.status;
    } catch {
      site.twitterStatus = 0;
    }
  }
  return site;
}

async function fetchLimited(url, { method = "GET" } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetch(url, {
      method,
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "user-agent": "rh-feed/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 12_000);
    return { status: res.status, url: res.url, body: buf.toString("utf8") };
  } finally {
    clearTimeout(timer);
  }
}
