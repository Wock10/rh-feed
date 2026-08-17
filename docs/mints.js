const ZERO = "0x0000000000000000000000000000000000000000";
const STABLES = new Set(["USDG", "USDC", "USDT", "DAI", "USD", "USDC.E"]);
const DROP_TYPES = ["featured", "upcoming", "recently_minted"];

function lc(v) {
  return String(v ?? "").toLowerCase();
}

function toWei(price) {
  if (price == null || price === "") return null;
  try {
    const n = BigInt(String(price));
    return n < 0n ? null : n;
  } catch {
    return null;
  }
}

function parseTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const n = Number(value);
  if (Number.isFinite(n) && !String(value).includes("-") && String(value).trim() !== "") {
    return n < 1e12 ? n * 1000 : n;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function titleFromSlug(slug) {
  return String(slug ?? "")
    .replace(/-\d{5,}$/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || slug;
}

function isNative(stage) {
  const currency = lc(stage?.price_currency_address ?? stage?.price_currency?.address ?? ZERO);
  return !currency || currency === ZERO;
}

function currencySymbol(stage) {
  const token = stage?.price_currency ?? {};
  const sym = String(token.symbol ?? "").toUpperCase();
  if (sym) return sym;
  return isNative(stage) ? "ETH" : "TOKEN";
}

export function formatStagePrice(stage) {
  if (!stage) return { label: "—", free: false, paid: false, usd: null, amount: null, symbol: null };
  const wei = toWei(stage.price);
  const symbol = currencySymbol(stage);
  if (wei === 0n && isNative(stage)) {
    return { label: "FREE", free: true, paid: false, usd: 0, amount: 0, symbol };
  }
  if (wei == null) return { label: "—", free: false, paid: false, usd: null, amount: null, symbol };
  const decimals = Number(stage.price_currency?.decimals ?? 18);
  const amount = Number(wei) / 10 ** decimals;
  if (!Number.isFinite(amount)) return { label: "—", free: false, paid: true, usd: null, amount: null, symbol };
  const usd = STABLES.has(symbol) ? amount : null;
  const pretty =
    amount >= 1 ? amount.toFixed(4).replace(/\.?0+$/, "") : amount.toPrecision(4);
  const label = usd != null ? `$${pretty}` : `${pretty} ${symbol}`;
  return { label, free: wei === 0n, paid: wei !== 0n, usd, amount, symbol };
}

function pickStage(drop) {
  const now = Date.now();
  const active = drop?.active_stage;
  if (active) return active;
  const stages = Array.isArray(drop?.stages) ? drop.stages : [];
  const live = stages.find((s) => {
    const start = parseTime(s.start_time ?? s.start_at);
    const end = parseTime(s.end_time ?? s.end_at);
    return (!start || start <= now) && (!end || end > now);
  });
  if (live) return live;
  return stages
    .map((s) => ({ s, start: parseTime(s.start_time ?? s.start_at) ?? Infinity }))
    .sort((a, b) => a.start - b.start)[0]?.s ?? null;
}

function dropStatus(drop, stage) {
  if (drop?.is_minting) return "live";
  const start = parseTime(stage?.start_time ?? stage?.start_at ?? drop?.mint_start_time ?? drop?.start_time);
  const end = parseTime(stage?.end_time ?? stage?.end_at ?? drop?.mint_end_time);
  const now = Date.now();
  if (start && start > now) return "soon";
  if (end && end < now) return "ended";
  if (drop?.is_minting === false) return "ended";
  return "soon";
}

function remainingOf(drop) {
  const max = Number(drop?.max_supply);
  const total = Number(drop?.total_supply);
  if (!Number.isFinite(max) || !Number.isFinite(total)) return null;
  return Math.max(0, max - total);
}

export function normalizeDrop(raw, { source = "calendar", calendarType = null, chain = "robinhood" } = {}) {
  if (!raw) return null;
  const slug = raw.collection_slug || raw.collection || raw.slug;
  if (!slug) return null;
  const dropChain = lc(raw.chain || raw.chain_identifier || chain);
  if (dropChain && dropChain !== lc(chain)) return null;
  const stage = pickStage(raw);
  const price = formatStagePrice(stage);
  const remaining = remainingOf(raw);
  const maxSupply = Number(raw.max_supply);
  const totalSupply = Number(raw.total_supply);
  const startAt = parseTime(stage?.start_time ?? stage?.start_at ?? raw.mint_start_time ?? raw.start_time);
  const endAt = parseTime(stage?.end_time ?? stage?.end_at ?? raw.mint_end_time);
  const stageType = lc(stage?.stage_type ?? stage?.kind ?? "");
  const status = dropStatus(raw, stage);
  return {
    slug,
    name: raw.collection_name || raw.name || titleFromSlug(slug),
    image: raw.image_url || raw.image || raw.collection_image_url || null,
    chain: dropChain || chain,
    url: raw.opensea_url || `https://opensea.io/collection/${slug}`,
    contract: raw.contract_address || raw.address || null,
    source,
    calendarType,
    isMinting: Boolean(raw.is_minting),
    status,
    stageType: stageType || null,
    priceLabel: price.label,
    free: price.free,
    paid: price.paid,
    priceUsd: price.usd,
    startAt,
    endAt,
    remaining,
    maxSupply: Number.isFinite(maxSupply) ? maxSupply : null,
    totalSupply: Number.isFinite(totalSupply) ? totalSupply : null,
    maxPerWallet: stage?.max_per_wallet ?? null,
    eligible: null,
    eligibleReason: null,
    updatedAt: Date.now(),
  };
}

function whenLabel(row) {
  if (row.status === "live") return "live now";
  const t = row.startAt;
  if (!t) return row.status;
  const delta = t - Date.now();
  if (delta <= 0) return "starting";
  const min = Math.round(delta / 60000);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `in ${hr}h`;
  return `in ${Math.round(hr / 24)}d`;
}

function supplyLabel(row) {
  if (row.remaining == null || row.maxSupply == null) return "";
  return `${row.remaining}/${row.maxSupply} left`;
}

export function scoreMint(row, { heat = null, project = null } = {}) {
  const flags = [];
  if (row.status === "live") flags.push("live");
  if (row.status === "soon") flags.push("soon");
  if (row.free) flags.push("free");
  if (row.paid) flags.push("paid");
  if (row.eligible === true) flags.push("you");
  if (row.eligible === false) flags.push("lock");
  if (row.eligibleReason === "low balance") flags.push("gas");
  if (row.stageType && /allow|allowlist|allow_list|whitelist|gated|private/.test(row.stageType)) {
    flags.push("gated");
  } else if (row.stageType && /public/.test(row.stageType)) {
    flags.push("public");
  }
  if (
    row.remaining != null &&
    row.maxSupply &&
    (row.remaining <= 50 || row.remaining / row.maxSupply <= 0.15)
  ) {
    flags.push("low");
  }
  const heatFlags = heat?.flags ?? [];
  if (heatFlags.includes("hot")) flags.push("hot");
  if (heatFlags.includes("new")) flags.push("new");
  if (heatFlags.includes("organic")) flags.push("organic");
  if (project?.verdict === "thin" || project?.verdict === "vapor") flags.push(project.verdict);
  const rank =
    (row.eligible === true ? 400 : 0) +
    (row.free ? 120 : 0) +
    (row.status === "live" ? 200 : row.status === "soon" ? 80 : 0) +
    (heatFlags.includes("hot") ? 60 : 0) +
    (heatFlags.includes("new") ? 30 : 0) +
    (row.paid ? 10 : 0) -
    (row.eligible === false ? 80 : 0);
  return { flags: [...new Set(flags)], rank, when: whenLabel(row), supply: supplyLabel(row) };
}

export class MintWatch {
  constructor() {
    /** @type {Map<string, object>} */
    this.drops = new Map();
    this.noDropUntil = new Map();
    this.stats = { calendar: 0, scanned: 0, live: 0, soon: 0, eligible: 0 };
  }

  upsert(row, extra = {}) {
    if (!row?.slug) return null;
    const prev = this.drops.get(row.slug) ?? {};
    const next = {
      ...prev,
      ...row,
      ...extra,
      eligible: extra.eligible ?? row.eligible ?? prev.eligible ?? null,
      eligibleReason: extra.eligibleReason ?? row.eligibleReason ?? prev.eligibleReason ?? null,
      updatedAt: Date.now(),
    };
    this.drops.set(row.slug, next);
    return next;
  }

  markNoDrop(slug, ttlMs = 30 * 60 * 1000) {
    this.noDropUntil.set(slug, Date.now() + ttlMs);
  }

  shouldProbe(slug) {
    const until = this.noDropUntil.get(slug);
    return !(until && until > Date.now());
  }

  prune(maxAgeMs = 36 * 60 * 60 * 1000) {
    const now = Date.now();
    for (const [slug, row] of this.drops) {
      if (now - (row.updatedAt ?? 0) > maxAgeMs && row.status !== "live") this.drops.delete(slug);
    }
    for (const [slug, until] of this.noDropUntil) {
      if (until <= now) this.noDropUntil.delete(slug);
    }
  }

  board({ heatBySlug = new Map(), projectBySlug = new Map(), limit = 16 } = {}) {
    const rows = [...this.drops.values()]
      .filter((row) => {
        if (row.status === "live" || row.status === "soon") return true;
        return row.calendarType === "recently_minted";
      })
      .map((row) => {
      const scored = scoreMint(row, {
        heat: heatBySlug.get?.(row.slug) ?? heatBySlug[row.slug] ?? null,
        project: projectBySlug.get?.(row.slug) ?? projectBySlug[row.slug] ?? null,
      });
      return { ...row, ...scored };
    });
    rows.sort((a, b) => b.rank - a.rank || (a.startAt ?? 0) - (b.startAt ?? 0));
    this.stats = {
      calendar: rows.filter((r) => r.source === "calendar").length,
      scanned: rows.filter((r) => r.source === "scan").length,
      live: rows.filter((r) => r.status === "live").length,
      soon: rows.filter((r) => r.status === "soon").length,
      eligible: rows.filter((r) => r.eligible === true).length,
    };
    return rows.slice(0, limit);
  }

  toJSON() {
    return {
      drops: [...this.drops.values()],
      noDropUntil: [...this.noDropUntil.entries()],
    };
  }

  static fromJSON(data) {
    const watch = new MintWatch();
    for (const row of data?.drops ?? []) {
      if (row?.slug) watch.drops.set(row.slug, row);
    }
    for (const [slug, until] of data?.noDropUntil ?? []) {
      watch.noDropUntil.set(slug, until);
    }
    return watch;
  }
}

export { DROP_TYPES, ZERO };
