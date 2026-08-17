const WARMUP_MS = 90_000;
const NEW_MS = 3 * 60 * 60 * 1000;
const MAX_PROJECTS = 80;

const RULES = [
  [/buy this domain|domain is for sale|godaddy|namecheap|sedo\.com|hugedomains/i, "parked", 5],
  [/lorem ipsum/i, "lorem", 4],
  [/utility\s*(tba|tbd)|roadmap\s*(tba|tbd)|details\s*(tba|tbd)/i, "tba", 3],
  [/coming soon|mint soon|stay tuned|launching soon/i, "coming_soon", 2],
  [/linktr\.ee|carrd\.co|bio\.site|beacons\.ai/i, "linktree", 2],
  [/whitepaper/i, "whitepaper", 1],
];

function lc(v) {
  return String(v ?? "").toLowerCase();
}

export function extractMeta(row) {
  const src = row && typeof row.collection === "object" ? row.collection : row;
  const twitter =
    src?.twitter_username ||
    src?.twitterUsername ||
    handleFromUrl(src?.twitter_url || src?.twitter) ||
    null;
  const website =
    src?.project_url ||
    src?.website ||
    src?.external_url ||
    src?.wiki_url ||
    null;
  return {
    slug: typeof src?.collection === "string" ? src.collection : src?.slug || row?.slug || "",
    name: src?.name || src?.slug || "",
    description: String(src?.description ?? "").slice(0, 500),
    image: src?.image_url || src?.image || null,
    website: cleanUrl(website),
    twitter: twitter ? String(twitter).replace(/^@/, "") : null,
    discord: src?.discord_url || null,
    telegram: src?.telegram_url || null,
  };
}

export function scoreProject(project) {
  const flags = [];
  let score = 0;
  const blob = [
    project.description,
    project.siteTitle,
    project.siteText,
    project.website,
  ]
    .filter(Boolean)
    .join(" \n ");

  if (!project.website) {
    flags.push("no_site");
    score += 3;
  } else {
    const host = hostOf(project.website);
    if (/opensea\.io|blur\.io/.test(host)) {
      flags.push("os_as_site");
      score += 3;
    }
    if (/discord\.gg|t\.me/.test(host)) {
      flags.push("chat_as_site");
      score += 2;
    }
    if ((project.siteChars ?? 0) > 0 && project.siteChars < 80) {
      flags.push("thin_page");
      score += 2;
    }
    if (project.siteStatus === 404) {
      flags.push("site_404");
      score += 4;
    }
    if (project.siteTwitter && project.twitter) {
      if (lc(project.siteTwitter) !== lc(project.twitter)) {
        flags.push("twitter_mismatch");
        score += 3;
      }
    }
  }

  if (!project.twitter) {
    flags.push("no_twitter");
    score += 2;
  } else if (/^(nft|official|dao|coin)\d+$/i.test(project.twitter) || /[0-9]{4,}$/.test(project.twitter)) {
    flags.push("throwaway_twitter");
    score += 2;
  }
  if (project.twitterStatus === 404) {
    flags.push("twitter_404");
    score += 4;
  }

  if (!project.description) {
    flags.push("no_desc");
    score += 1;
  }

  for (const [re, tag, pts] of RULES) {
    if (re.test(blob)) {
      flags.push(tag);
      score += pts;
    }
  }

  let verdict = "ok";
  if (score >= 7) verdict = "vapor";
  else if (score >= 3) verdict = "thin";
  if (!project.website && !project.twitter) verdict = "vapor";

  return {
    score,
    flags: [...new Set(flags)],
    verdict,
  };
}

export function buildEvidence(project, prompt) {
  const lines = [
    prompt.trim(),
    "",
    "---",
    `name: ${project.name || project.slug}`,
    `slug: ${project.slug}`,
    `website: ${project.website || "(none)"}`,
    `twitter: ${project.twitter ? `@${project.twitter}` : "(none)"}`,
    `heuristic: ${project.verdict} (${(project.flags ?? []).join(",") || "none"})`,
    `opensea_description: ${(project.description || "(none)").slice(0, 400)}`,
    `site_title: ${project.siteTitle || "(none)"}`,
    `site_text: ${(project.siteText || "(none)").slice(0, 900)}`,
  ];
  return lines.join("\n");
}

export class ProjectWatch {
  constructor() {
    this.startedAt = Date.now();
    this.known = new Set();
    /** @type {Map<string, object>} */
    this.projects = new Map();
    this.stats = { noticed: 0, scraped: 0, llm: 0 };
  }

  markKnown(slugs) {
    for (const slug of slugs ?? []) if (slug) this.known.add(slug);
  }

  notice(event) {
    const slug = event?.slug;
    if (!slug) return null;
    if (this.known.has(slug) && !this.projects.has(slug)) return null;
    if (Date.now() - this.startedAt < WARMUP_MS) {
      this.known.add(slug);
      return null;
    }
    if (event.type !== "mint" && event.type !== "sale" && event.type !== "listing") {
      return this.projects.get(slug) ?? null;
    }
    let row = this.projects.get(slug);
    if (!row) {
      row = {
        slug,
        name: event.collectionName || slug,
        image: event.image || null,
        firstTs: event.ts || Date.now(),
        lastTs: event.ts || Date.now(),
        status: "queued",
        verdict: "queued",
        flags: [],
        score: 0,
        website: null,
        twitter: null,
        description: "",
        siteTitle: "",
        siteText: "",
        siteChars: 0,
        siteStatus: null,
        twitterStatus: null,
        siteTwitter: null,
        llm: null,
      };
      this.projects.set(slug, row);
      this.stats.noticed += 1;
    }
    row.lastTs = event.ts || Date.now();
    if (event.collectionName) row.name = event.collectionName;
    if (event.image && !row.image) row.image = event.image;
    return row;
  }

  applyMeta(slug, meta) {
    const row = this.projects.get(slug);
    if (!row || !meta) return row;
    row.name = meta.name || row.name;
    row.description = meta.description || row.description;
    row.website = meta.website || row.website;
    row.twitter = meta.twitter || row.twitter;
    row.discord = meta.discord || row.discord;
    if (meta.image && !row.image) row.image = meta.image;
    this.rescore(row);
    return row;
  }

  applySite(slug, site) {
    const row = this.projects.get(slug);
    if (!row || !site) return row;
    row.siteTitle = site.title || "";
    row.siteText = site.text || "";
    row.siteChars = site.chars ?? (site.text ? site.text.length : 0);
    row.siteStatus = site.status ?? null;
    row.siteTwitter = site.twitter || null;
    row.twitterStatus = site.twitterStatus ?? row.twitterStatus;
    row.status = "scored";
    this.stats.scraped += 1;
    this.rescore(row);
    return row;
  }

  rescore(row) {
    const scored = scoreProject(row);
    row.score = scored.score;
    row.flags = scored.flags;
    if (!row.llm) row.verdict = scored.verdict;
    return row;
  }

  setLlm(slug, llm) {
    const row = this.projects.get(slug);
    if (!row) return null;
    row.llm = llm;
    if (llm?.verdict) row.verdict = llm.verdict;
    this.stats.llm += 1;
    return row;
  }

  board({ limit = 12 } = {}) {
    const now = Date.now();
    return [...this.projects.values()]
      .filter((p) => now - p.firstTs < NEW_MS)
      .sort((a, b) => {
        const rank = (p) =>
          (p.verdict === "vapor" ? 50 : 0) +
          (p.verdict === "thin" ? 20 : 0) +
          p.score * 3 +
          (p.status === "queued" ? 5 : 0);
        return rank(b) - rank(a) || b.firstTs - a.firstTs;
      })
      .slice(0, limit)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        image: p.image,
        verdict: p.verdict,
        status: p.status,
        flags: p.flags,
        score: p.score,
        website: p.website,
        twitter: p.twitter,
        llm: p.llm,
        ageMin: Math.max(0, Math.round((now - p.firstTs) / 60000)),
        collectionUrl: `https://opensea.io/collection/${encodeURIComponent(p.slug)}`,
        twitterUrl: p.twitter ? `https://x.com/${encodeURIComponent(p.twitter)}` : null,
      }));
  }

  prune(now = Date.now()) {
    for (const [slug, row] of this.projects) {
      if (now - row.firstTs > 24 * 60 * 60 * 1000 && row.verdict !== "vapor") {
        this.projects.delete(slug);
      }
    }
    if (this.projects.size <= MAX_PROJECTS) return;
    const keep = new Set(this.board({ limit: MAX_PROJECTS }).map((p) => p.slug));
    for (const slug of [...this.projects.keys()]) {
      if (!keep.has(slug)) this.projects.delete(slug);
    }
  }

  toJSON() {
    return {
      stats: this.stats,
      startedAt: this.startedAt,
      known: [...this.known].slice(-400),
      projects: [...this.projects.values()],
    };
  }

  static fromJSON(raw) {
    const watch = new ProjectWatch();
    if (!raw || typeof raw !== "object") return watch;
    watch.stats = { ...watch.stats, ...(raw.stats ?? {}) };
    watch.markKnown(raw.known);
    for (const row of raw.projects ?? []) {
      if (row?.slug) watch.projects.set(row.slug, row);
    }
    return watch;
  }
}

function cleanUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function handleFromUrl(value) {
  const m = String(value ?? "").match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/i);
  return m?.[1] || null;
}

export function htmlToText(html) {
  const title = String(html).match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || "";
  const twitter = handleFromUrl(html);
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return { title: title.slice(0, 140), text: text.slice(0, 1800), twitter, chars: text.length };
}
