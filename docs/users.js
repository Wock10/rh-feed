const ZERO = "0x0000000000000000000000000000000000000000";
const ETH = new Set(["ETH", "WETH", "RHETH"]);
const STABLES = new Set(["USDG", "USDC", "USDT", "DAI", "USD", "USDC.E"]);
const EXCLUDE = new Set([
  ZERO,
  "0xe302733accf4800146e55fc45b46b4e4ffc032d2",
]);
const MAX_USERS = 80;
const MAX_COLS = 8;
const FRESH_MS = 2 * 60 * 1000;

function lc(v) {
  return String(v ?? "").toLowerCase();
}

function isWallet(addr) {
  return Boolean(addr) && addr.startsWith("0x") && !EXCLUDE.has(lc(addr));
}

function eventTs(row) {
  const n = Number(row?.event_timestamp);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

export function paymentNotional(payment) {
  if (!payment) return { eth: 0, usd: 0, amount: 0, symbol: "" };
  const symbol = String(payment.symbol ?? "").toUpperCase();
  const decimals = Number(payment.decimals ?? 18);
  let amount = 0;
  try {
    amount = Number(BigInt(String(payment.quantity ?? "0"))) / 10 ** decimals;
  } catch {
    amount = Number(payment.quantity) / 10 ** decimals;
  }
  if (!Number.isFinite(amount) || amount < 0) amount = 0;
  if (STABLES.has(symbol)) return { eth: 0, usd: amount, amount, symbol };
  if (!symbol || ETH.has(symbol)) return { eth: amount, usd: 0, amount, symbol };
  return { eth: 0, usd: 0, amount, symbol };
}

export function eventKind(row) {
  const type = lc(row?.event_type);
  if (type === "sale") return "sale";
  if (type === "mint") return "mint";
  if (type === "listing") return "listing";
  if (type === "offer" || type === "collection_offer" || type === "trait_offer") return "offer";
  if (type === "transfer") {
    const from = lc(row.from_address);
    if (!from || from === ZERO) return "mint";
    return "transfer";
  }
  return type || "other";
}

function emptyUser(address) {
  return {
    address,
    name: null,
    url: `https://opensea.io/${address}`,
    image: null,
    firstTs: 0,
    lastTs: 0,
    buys: 0,
    sells: 0,
    mints: 0,
    listings: 0,
    offers: 0,
    ethIn: 0,
    ethOut: 0,
    usdIn: 0,
    usdOut: 0,
    collections: {},
    source: "opensea",
    fetchedAt: 0,
  };
}

function noteCollection(user, row, ts) {
  const slug =
    row?.nft?.collection ||
    row?.asset?.collection ||
    row?.criteria?.collection?.slug ||
    null;
  if (!slug) return;
  const name = row?.nft?.name || row?.asset?.name || slug;
  const col = user.collections[slug] ?? {
    slug,
    name,
    n: 0,
    lastTs: 0,
  };
  col.n += 1;
  col.lastTs = ts;
  if (name && name !== slug) col.name = name;
  user.collections[slug] = col;
}

export function summarizeOpenSea(address, { account, events } = {}) {
  const addr = lc(address);
  const user = emptyUser(addr);
  user.fetchedAt = Date.now();
  if (account) {
    user.name = account.username || account.ens_name || account.display_name || null;
    const slug = user.name || addr;
    user.url = `https://opensea.io/${encodeURIComponent(slug)}`;
    user.image =
      account.profile_image_url ||
      account.profile_img_url ||
      account.image_url ||
      null;
  }
  for (const row of events ?? []) {
    const chain = lc(row.chain);
    if (chain && chain !== "robinhood") continue;
    const kind = eventKind(row);
    const ts = eventTs(row);
    if (!user.firstTs || ts < user.firstTs) user.firstTs = ts;
    if (ts > user.lastTs) user.lastTs = ts;
    if (kind === "sale") {
      const n = paymentNotional(row.payment);
      if (lc(row.seller) === addr) {
        user.sells += 1;
        user.ethOut += n.eth;
        user.usdOut += n.usd;
      }
      if (lc(row.buyer) === addr) {
        user.buys += 1;
        user.ethIn += n.eth;
        user.usdIn += n.usd;
      }
    } else if (kind === "mint") {
      if (lc(row.to_address) === addr || !row.to_address) user.mints += 1;
    } else if (kind === "listing") {
      if (lc(row.maker) === addr) user.listings += 1;
    } else if (kind === "offer") {
      if (lc(row.maker) === addr) user.offers += 1;
    }
    noteCollection(user, row, ts);
  }
  return cardFromUser(user);
}

function cardFromUser(user) {
  const cols = Object.values(user.collections)
    .sort((a, b) => b.lastTs - a.lastTs || b.n - a.n)
    .slice(0, MAX_COLS);
  const empty =
    user.buys + user.sells + user.mints + user.listings + user.offers === 0;
  return {
    address: user.address,
    name: user.name,
    url: user.url,
    image: user.image,
    firstTs: user.firstTs,
    lastTs: user.lastTs,
    buys: user.buys,
    sells: user.sells,
    mints: user.mints,
    listings: user.listings,
    offers: user.offers,
    ethIn: round(user.ethIn, 5),
    ethOut: round(user.ethOut, 5),
    usdIn: round(user.usdIn, 2),
    usdOut: round(user.usdOut, 2),
    collections: cols,
    collectionCount: Object.keys(user.collections).length,
    source: user.source || "opensea",
    fetchedAt: user.fetchedAt || 0,
    empty,
  };
}

export class UserBook {
  constructor() {
    /** @type {Map<string, object>} */
    this.users = new Map();
    this.stats = { seen: 0, fetches: 0 };
  }

  get(address) {
    if (!address) return null;
    return this.users.get(lc(address)) ?? null;
  }

  fresh(address, maxAge = FRESH_MS) {
    const card = this.card(address);
    if (!card?.fetchedAt) return null;
    if (Date.now() - card.fetchedAt > maxAge) return null;
    return card;
  }

  put(card) {
    if (!card?.address) return;
    const addr = lc(card.address);
    this.users.set(addr, { ...card, address: addr });
    this.stats.seen = this.users.size;
    this.stats.fetches += 1;
  }

  setAccount(address, profile) {
    const user = this.get(address);
    if (!user || !profile) return;
    if (profile.name) user.name = profile.name;
    if (profile.url) user.url = profile.url;
    if (profile.image) user.image = profile.image;
  }

  card(address) {
    const user = this.get(address);
    if (!user) return null;
    if (user.ethIn != null && user.collections && Array.isArray(user.collections)) {
      return user;
    }
    return cardFromUser({
      ...emptyUser(lc(address)),
      ...user,
      collections:
        user.collections && !Array.isArray(user.collections) ? user.collections : {},
    });
  }

  prune() {
    if (this.users.size <= MAX_USERS) return;
    const ranked = [...this.users.values()].sort(
      (a, b) => (b.fetchedAt || b.lastTs || 0) - (a.fetchedAt || a.lastTs || 0),
    );
    this.users = new Map(ranked.slice(0, MAX_USERS).map((u) => [lc(u.address), u]));
    this.stats.seen = this.users.size;
  }

  toJSON() {
    return {
      stats: this.stats,
      users: [...this.users.values()],
    };
  }

  static fromJSON(raw) {
    const book = new UserBook();
    if (!raw || typeof raw !== "object") return book;
    book.stats = { ...book.stats, ...(raw.stats ?? {}) };
    for (const row of raw.users ?? []) {
      if (!row?.address || !isWallet(row.address)) continue;
      if (!row.fetchedAt) continue;
      book.users.set(lc(row.address), { ...row, address: lc(row.address) });
    }
    book.stats.seen = book.users.size;
    return book;
  }
}

function round(n, digits) {
  const p = 10 ** digits;
  return Math.round((Number(n) || 0) * p) / p;
}
