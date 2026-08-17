const ZERO = "0x0000000000000000000000000000000000000000";
const ETH = new Set(["ETH", "WETH", "RHETH"]);
const STABLES = new Set(["USDG", "USDC", "USDT", "DAI", "USD", "USDC.E"]);
const EXCLUDE = new Set([
  ZERO,
  "0xe302733accf4800146e55fc45b46b4e4ffc032d2",
]);
const MAX_USERS = 2500;
const MAX_COLS = 8;

function isWallet(addr) {
  return Boolean(addr) && addr.startsWith("0x") && !EXCLUDE.has(addr);
}

function notional(price) {
  const amount = Number(price?.amount);
  const symbol = String(price?.symbol ?? "").toUpperCase();
  if (!Number.isFinite(amount) || amount < 0) return { eth: 0, usd: 0 };
  if (STABLES.has(symbol)) return { eth: 0, usd: amount };
  if (!symbol || ETH.has(symbol)) return { eth: amount, usd: 0 };
  return { eth: 0, usd: 0 };
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
  };
}

export class UserBook {
  constructor() {
    /** @type {Map<string, object>} */
    this.users = new Map();
    this.stats = { seen: 0, events: 0 };
  }

  get(address) {
    if (!address) return null;
    return this.users.get(address.toLowerCase()) ?? null;
  }

  setAccount(address, profile) {
    const user = this.touch(address, Date.now(), profile);
    if (!user || !profile) return;
    if (profile.name) user.name = profile.name;
    if (profile.url) user.url = profile.url;
    if (profile.image) user.image = profile.image;
  }

  ingest(event) {
    if (!event) return;
    this.stats.events += 1;
    const ts = event.ts || Date.now();
    if (event.type === "sale") {
      const n = notional(event.price);
      this.note(event.from, ts, event, "sell", n);
      this.note(event.to, ts, event, "buy", n);
      return;
    }
    if (event.type === "mint") {
      this.note(event.to, ts, event, "mint", { eth: 0, usd: 0 });
      return;
    }
    if (event.type === "listing") {
      this.note(event.from, ts, event, "listing", { eth: 0, usd: 0 });
      return;
    }
    if (event.type === "offer" || event.type === "collection_offer" || event.type === "trait_offer") {
      this.note(event.from, ts, event, "offer", { eth: 0, usd: 0 });
    }
  }

  touch(address, ts, extra = {}) {
    if (!isWallet(address)) return null;
    const addr = address.toLowerCase();
    let user = this.users.get(addr);
    if (!user) {
      user = emptyUser(addr);
      user.firstTs = ts;
      this.users.set(addr, user);
      this.stats.seen = this.users.size;
    }
    if (!user.firstTs || ts < user.firstTs) user.firstTs = ts;
    if (ts > user.lastTs) user.lastTs = ts;
    if (extra.name) user.name = extra.name;
    if (extra.url) user.url = extra.url;
    if (extra.image) user.image = extra.image;
    return user;
  }

  note(address, ts, event, kind, n) {
    const extra =
      kind === "buy" || kind === "mint"
        ? { name: event.toName, url: event.toUrl, image: event.toImage }
        : { name: event.fromName, url: event.fromUrl, image: event.fromImage };
    const user = this.touch(address, ts, extra);
    if (!user) return;
    if (kind === "buy") {
      user.buys += 1;
      user.ethIn += n.eth;
      user.usdIn += n.usd;
    } else if (kind === "sell") {
      user.sells += 1;
      user.ethOut += n.eth;
      user.usdOut += n.usd;
    } else if (kind === "mint") {
      user.mints += 1;
    } else if (kind === "listing") {
      user.listings += 1;
    } else if (kind === "offer") {
      user.offers += 1;
    }
    if (event.slug) {
      const col = user.collections[event.slug] ?? {
        slug: event.slug,
        name: event.collectionName || event.slug,
        n: 0,
        lastTs: 0,
      };
      col.n += 1;
      col.lastTs = ts;
      if (event.collectionName) col.name = event.collectionName;
      user.collections[event.slug] = col;
    }
  }

  card(address) {
    const user = this.get(address);
    if (!user) return null;
    const cols = Object.values(user.collections)
      .sort((a, b) => b.lastTs - a.lastTs || b.n - a.n)
      .slice(0, MAX_COLS);
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
    };
  }

  prune(now = Date.now()) {
    if (this.users.size <= MAX_USERS) return;
    const ranked = [...this.users.values()].sort((a, b) => b.lastTs - a.lastTs);
    this.users = new Map(ranked.slice(0, MAX_USERS).map((u) => [u.address, u]));
    this.stats.seen = this.users.size;
    const stale = now - 14 * 24 * 60 * 60 * 1000;
    for (const [addr, user] of this.users) {
      const activity = user.buys + user.sells + user.mints;
      if (user.lastTs < stale && activity < 3) this.users.delete(addr);
    }
    this.stats.seen = this.users.size;
  }

  toJSON() {
    return {
      stats: this.stats,
      users: [...this.users.values()].map((u) => ({
        ...u,
        ethIn: round(u.ethIn, 5),
        ethOut: round(u.ethOut, 5),
        usdIn: round(u.usdIn, 2),
        usdOut: round(u.usdOut, 2),
      })),
    };
  }

  static fromJSON(raw) {
    const book = new UserBook();
    if (!raw || typeof raw !== "object") return book;
    book.stats = { ...book.stats, ...(raw.stats ?? {}) };
    for (const row of raw.users ?? []) {
      if (!row?.address) continue;
      book.users.set(row.address.toLowerCase(), {
        ...emptyUser(row.address.toLowerCase()),
        ...row,
        address: row.address.toLowerCase(),
        collections: row.collections && typeof row.collections === "object" ? row.collections : {},
      });
    }
    book.stats.seen = book.users.size;
    return book;
  }
}

function round(n, digits) {
  const p = 10 ** digits;
  return Math.round((Number(n) || 0) * p) / p;
}
