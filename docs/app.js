import { RhFeedEngine } from "./engine.js";

const TYPES = [
  { id: "all", label: "All" },
  { id: "sale", label: "Sale" },
  { id: "mint", label: "Mint" },
  { id: "transfer", label: "Transfer" },
  { id: "listing", label: "Listing" },
  { id: "offer", label: "Item offer" },
  { id: "collection_offer", label: "Collection offer" },
  { id: "trait_offer", label: "Trait offer" },
];

const TYPE_LABEL = {
  sale: "Sale",
  mint: "Mint",
  listing: "Listing",
  offer: "Item offer",
  collection_offer: "Collection offer",
  trait_offer: "Trait offer",
  transfer: "Transfer",
  cancel: "Cancel",
};

const ICONS = {
  sale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6h15l-1.5 9h-12z"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M6 6 5 3H2"/></svg>',
  mint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6.2 6.2l2.1 2.1M15.7 15.7l2.1 2.1M17.8 6.2l-2.1 2.1M8.3 15.7l-2.1 2.1"/><circle cx="12" cy="12" r="3"/></svg>',
  listing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7h10v13H7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg>',
  offer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v18M8 8.5c0-1.7 1.8-3 4-3s4 1.3 4 3-1.8 3-4 3-4 1.3-4 3 1.8 3 4 3 4-1.3 4-3"/></svg>',
  collection_offer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="13" width="7" height="7" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/></svg>',
  trait_offer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 20 7v10l-8 4-8-4V7z"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>',
};

const KNOWN = new Set([
  "8888sport",
  "44main",
  "steaktornado",
  "prsfrg",
  "press_sell",
]);

const FLAG_HELP = {
  hot: "Sales accelerating vs the last 15 minutes",
  new: "First seen in the last 20 minutes, with sales",
  organic: "Many unique buyers, not one wallet stuffing prints",
  dump: "Lots of listings, almost no sales",
  sweep: "Same wallet bought 3+ in about 40 seconds",
  hit: "Got in early on a collection that later pumped",
  live: "Drop is minting now",
  soon: "Upcoming stage, not live yet",
  free: "Native price is 0",
  paid: "Mint has a price",
  you: "Your mint wallet can mint the active stage",
  lock: "Allowlist / not eligible",
  gated: "Allowlist or private stage",
  public: "Public mint stage",
  gas: "Eligible, but the wallet is short on balance",
  low: "Supply almost gone",
  thin: "Site / Twitter look thin",
  vapor: "Site / Twitter look parked or fake",
  ok: "Project looks real enough",
  queued: "Still scraping",
};

const MUTE_KEY = "rh-feed-mutes";
const USD_KEY = "rh-feed-min-usd";
const ALERT_KEY = "rh-feed-alerts";
const KEY_STORE = "rh-feed-opensea-key";
const MINT_WALLET_KEY = "rh-feed-mint-wallet";

const state = {
  types: new Set(["sale"]),
  allTypes: false,
  events: [],
  mutes: new Map(),
  noise: [],
  collections: [],
  heat: [],
  sweeps: [],
  traders: [],
  projects: [],
  projectStats: {},
  mints: [],
  mintStats: {},
  promptText: "",
  focus: null,
  wallet: null,
  user: null,
  minUsd: Number(localStorage.getItem(USD_KEY) ?? 0) || 0,
  alerts: localStorage.getItem(ALERT_KEY) === "1",
  paused: false,
  backend: false,
  engine: null,
  es: null,
  search: "",
  toastTimer: null,
  lastHot: new Set(),
};

const els = {
  rows: document.getElementById("rows"),
  empty: document.getElementById("empty"),
  muted: document.getElementById("muted"),
  types: document.getElementById("type-filters"),
  pill: document.getElementById("stream-pill"),
  rate: document.getElementById("rate"),
  mutedCount: document.getElementById("muted-count"),
  pause: document.getElementById("pause-btn"),
  search: document.getElementById("col-search"),
  results: document.getElementById("col-results"),
  chips: document.getElementById("chips-row"),
  toast: document.getElementById("toast"),
  heat: document.getElementById("heat"),
  sweeps: document.getElementById("sweeps"),
  traders: document.getElementById("traders"),
  traderCount: document.getElementById("trader-count"),
  projects: document.getElementById("projects"),
  projectCount: document.getElementById("project-count"),
  mints: document.getElementById("mints"),
  mintCount: document.getElementById("mint-count"),
  mintWallet: document.getElementById("mint-wallet"),
  mintWalletRow: document.getElementById("mint-wallet-row"),
  promptBtn: document.getElementById("prompt-btn"),
  promptDrawer: document.getElementById("prompt-drawer"),
  keysBtn: document.getElementById("keys-btn"),
  keysDrawer: document.getElementById("keys-drawer"),
  keysClose: document.getElementById("keys-close"),
  userCard: document.getElementById("user-card"),
  promptText: document.getElementById("prompt-text"),
  promptSave: document.getElementById("prompt-save"),
  promptClose: document.getElementById("prompt-close"),
  promptStatus: document.getElementById("prompt-status"),
  minUsd: document.getElementById("min-usd"),
  alerts: document.getElementById("alerts"),
  gate: document.getElementById("key-gate"),
  keyForm: document.getElementById("key-form"),
  openseaKey: document.getElementById("opensea-key"),
  keyBtn: document.getElementById("key-btn"),
};

function typesParam() {
  if (state.allTypes) return "all";
  return [...state.types].join(",");
}

async function hasBackend() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    const data = await res.json();
    return Boolean(res.ok && data.ok);
  } catch {
    return false;
  }
}

async function boot() {
  renderTypes();
  renderChips();
  if (await hasBackend()) {
    state.backend = true;
    await loadPrompt();
    connect();
    return;
  }
  const key = localStorage.getItem(KEY_STORE) ?? "";
  els.keyBtn?.classList.remove("hidden");
  els.mintWalletRow?.classList.remove("hidden");
  if (els.mintWallet) {
    els.mintWallet.value = localStorage.getItem(MINT_WALLET_KEY) ?? "";
    els.mintWallet.addEventListener("change", () => {
      const addr = els.mintWallet.value.trim();
      localStorage.setItem(MINT_WALLET_KEY, addr);
      state.engine?.setMintWallet(addr);
    });
  }
  await loadPrompt();
  if (!key) {
    els.gate?.classList.remove("hidden");
    return;
  }
  startEngine(key);
}

function startEngine(key) {
  els.gate?.classList.add("hidden");
  state.engine?.stop();
  const engine = new RhFeedEngine({ apiKey: key });
  state.engine = engine;
  engine.setMintWallet(localStorage.getItem(MINT_WALLET_KEY) ?? "");
  engine.on("hello", applyHello);
  engine.on("events", (data) => {
    if (state.paused) return;
    for (let i = data.events.length - 1; i >= 0; i--) pushEvent(data.events[i], true);
    renderRows();
  });
  engine.on("status", renderStatus);
  engine.on("trends", onTrends);
  engine.start();
}

function reconnectFeed() {
  if (state.backend) connect();
  else if (state.engine) applyHello(state.engine.snapshot(typesParam()));
}

function connect() {
  if (state.es) state.es.close();
  const es = new EventSource(`/api/stream?types=${encodeURIComponent(typesParam())}`);
  state.es = es;
  es.addEventListener("hello", (ev) => applyHello(JSON.parse(ev.data)));
  es.addEventListener("events", (ev) => {
    if (state.paused) return;
    const { events } = JSON.parse(ev.data);
    for (let i = events.length - 1; i >= 0; i--) pushEvent(events[i], true);
    renderRows();
  });
  es.addEventListener("status", (ev) => renderStatus(JSON.parse(ev.data)));
  es.addEventListener("trends", (ev) => {
    const data = JSON.parse(ev.data);
    onTrends(data);
  });
  es.addEventListener("mute", async (ev) => {
    const data = JSON.parse(ev.data);
    if (data.mute) {
      if (!state.mutes.has(data.mute.slug)) applyMuteLocal(data.mute, { toast: false });
    }
    if (data.unmute) {
      state.mutes.delete(data.unmute);
      await reloadSnapshot();
    }
    persistMutes();
    renderMutes();
    renderResults();
    renderChips();
    renderRows();
  });
  es.addEventListener("profile", (ev) => {
    const p = JSON.parse(ev.data);
    for (const event of state.events) {
      if (event.from === p.address) {
        event.fromName = p.name || event.fromName;
        event.fromUrl = p.url || event.fromUrl;
        if (p.image) event.fromImage = p.image;
      }
      if (event.to === p.address) {
        event.toName = p.name || event.toName;
        event.toUrl = p.url || event.toUrl;
        if (p.image) event.toImage = p.image;
      }
    }
    renderRows();
  });
}

function applyHello(data) {
  state.events = data.events ?? [];
  state.mutes = new Map((data.mutes ?? []).map((m) => [m.slug, m]));
  hydrateLocalMutes();
  persistMutes();
  if (state.engine) {
    for (const row of state.mutes.values()) state.engine.mute(row.slug, row.name);
  }
  state.noise = data.noise ?? [];
  state.collections = data.collections ?? [];
  onTrends(data);
  renderStatus(data.status);
  renderTypes();
  renderMutes();
  renderResults();
  renderChips();
  renderRows();
}

function onTrends(data) {
  state.heat = data.heat ?? state.heat;
  state.sweeps = data.sweeps ?? state.sweeps;
  if (data.traders) state.traders = data.traders;
  if (data.projects) state.projects = data.projects;
  if (data.projectStats) state.projectStats = data.projectStats;
  if (data.mints) state.mints = data.mints;
  if (data.mintStats) state.mintStats = data.mintStats;
  if (state.alerts) pingNewSignals(state.heat, state.sweeps, state.traders, state.mints);
  renderHeat();
  renderSweeps();
  renderTraders();
  renderProjects();
  renderMints();
}

function pushEvent(event, fresh = false) {
  if (state.mutes.has(event.slug)) return;
  if (state.events.some((e) => e.id === event.id)) return;
  event.fresh = fresh;
  state.events.unshift(event);
  if (state.events.length > 150) state.events.length = 150;
}

function renderTypes() {
  els.types.innerHTML = "";
  for (const t of TYPES) {
    const on = t.id === "all" ? state.allTypes : !state.allTypes && state.types.has(t.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `switch${on ? " on" : ""}`;
    btn.innerHTML = `<span>${t.label}</span><span class="knob"></span>`;
    btn.addEventListener("click", () => {
      if (t.id === "all") {
        state.allTypes = !state.allTypes;
        state.types = state.allTypes
          ? new Set(TYPES.filter((x) => x.id !== "all").map((x) => x.id))
          : new Set(["sale"]);
      } else {
        state.allTypes = false;
        if (state.types.has(t.id)) {
          if (state.types.size === 1) return;
          state.types.delete(t.id);
        } else {
          state.types.add(t.id);
        }
      }
      renderTypes();
      renderChips();
      reconnectFeed();
    });
    els.types.appendChild(btn);
  }
}

function renderStatus(status = {}) {
  const stream = status.stream ?? "connecting";
  els.pill.textContent = stream;
  els.pill.className = `pill ${stream === "live" ? "live" : stream === "reconnecting" ? "down" : "wait"}`;
  els.rate.textContent = String(status.rhPerMin ?? 0);
}

function renderChips() {
  const chips = [];
  if (state.allTypes) chips.push({ id: "all", label: "All" });
  else {
    for (const id of TYPES.map((t) => t.id)) {
      if (id === "all") continue;
      if (state.types.has(id)) chips.push({ id, label: TYPE_LABEL[id] ?? id });
    }
  }
  chips.push({ id: "chain", label: "Robinhood Chain", locked: true });
  if (state.focus) {
    const name = state.heat.find((h) => h.slug === state.focus)?.name || state.focus;
    chips.push({ id: "focus", label: name });
  }
  if (state.wallet) {
    const row = state.traders.find((t) => t.address === state.wallet);
    chips.push({ id: "wallet", label: row?.name || short(state.wallet) });
  }
  els.chips.innerHTML = chips
    .map((c) => {
      const x = c.locked
        ? ""
        : `<button type="button" data-chip="${esc(c.id)}" aria-label="Remove ${esc(c.label)}">×</button>`;
      return `<span class="chip">${esc(c.label)}${x}</span>`;
    })
    .join("");
  els.chips.querySelectorAll("[data-chip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.chip;
      if (id === "all") {
        state.allTypes = false;
        state.types = new Set(["sale"]);
      } else if (id === "focus") {
        state.focus = null;
        renderChips();
        renderHeat();
        renderRows();
        return;
      } else if (id === "wallet") {
        state.wallet = null;
        state.user = null;
        renderChips();
        renderTraders();
        renderUserCard();
        renderRows();
        return;
      } else if (state.types.size > 1) {
        state.types.delete(id);
      } else {
        state.types = new Set(["sale"]);
      }
      renderTypes();
      renderChips();
      reconnectFeed();
    });
  });
}

async function reloadSnapshot() {
  if (state.engine) {
    const data = state.engine.snapshot(typesParam());
    state.events = data.events ?? [];
    state.noise = data.noise ?? [];
    if (data.mutes) state.mutes = new Map(data.mutes.map((m) => [m.slug, m]));
    if (data.collections) state.collections = data.collections;
    return;
  }
  const res = await fetch(`/api/snapshot?types=${encodeURIComponent(typesParam())}&limit=120`);
  const data = await res.json();
  state.events = data.events ?? [];
  state.noise = data.noise ?? [];
  if (data.mutes) state.mutes = new Map(data.mutes.map((m) => [m.slug, m]));
  if (data.collections) state.collections = data.collections;
}

function visibleEvents() {
  const types = state.allTypes ? null : state.types;
  return state.events.filter((e) => {
    if (types && !types.has(e.type)) return false;
    if (state.mutes.has(e.slug)) return false;
    if (state.focus && e.slug !== state.focus) return false;
    if (state.wallet && e.from !== state.wallet && e.to !== state.wallet) return false;
    if (state.minUsd > 0 && e.type === "sale") {
      const usd = Number(e.price?.usd);
      if (!Number.isFinite(usd) || usd < state.minUsd) return false;
    }
    return true;
  });
}

function renderRows() {
  const events = visibleEvents();
  els.empty.classList.toggle("hidden", events.length > 0);
  const ids = new Set(events.map((e) => e.id));
  for (const node of [...els.rows.children]) {
    if (!ids.has(node.dataset.id)) node.remove();
  }
  let anchor = els.rows.firstElementChild;
  for (const event of events) {
    const existing = document.getElementById(`ev-${cssId(event.id)}`);
    if (existing) {
      const time = existing.querySelector(".time");
      if (time) time.innerHTML = timeHtml(event);
      const from = existing.querySelector("[data-side=from]");
      const to = existing.querySelector("[data-side=to]");
      if (from) from.innerHTML = party(event.from, event.fromName, event.fromUrl, event.fromImage);
      if (to) to.innerHTML = party(event.to, event.toName, event.toUrl, event.toImage);
      bindRowUsers(existing);
      existing.classList.toggle("fresh", Boolean(event.fresh));
      event.fresh = false;
      if (anchor !== existing) els.rows.insertBefore(existing, anchor);
      anchor = existing.nextSibling;
      continue;
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = rowHtml(event);
    const node = wrap.firstElementChild;
    bindRowMute(node);
    bindRowUsers(node);
    els.rows.insertBefore(node, anchor);
    anchor = node.nextSibling;
  }
}

function openUser(address) {
  const addr = String(address || "").toLowerCase();
  if (!addr) return;
  if (state.wallet === addr && state.user?.address === addr) {
    state.wallet = null;
    state.user = null;
    renderChips();
    renderTraders();
    renderUserCard();
    renderRows();
    return;
  }
  state.wallet = addr;
  renderChips();
  renderTraders();
  renderRows();
  loadUser(addr);
}

async function loadUser(addr) {
  try {
    if (state.backend) {
      const res = await fetch(`/api/users/${encodeURIComponent(addr)}`, { cache: "no-store" });
      if (!res.ok) {
        state.user = { address: addr, empty: true };
        renderUserCard();
        return;
      }
      state.user = await res.json();
    } else {
      state.user = state.engine?.users?.card(addr) ?? { address: addr, empty: true };
    }
  } catch {
    state.user = { address: addr, empty: true };
  }
  renderUserCard();
}

function renderUserCard() {
  if (!els.userCard) return;
  const u = state.user;
  if (!u || !state.wallet) {
    els.userCard.classList.add("hidden");
    els.userCard.innerHTML = "";
    return;
  }
  els.userCard.classList.remove("hidden");
  const name = u.name || short(u.address);
  const pic = avatar(u.address, u.image, partyKind(u.address, u.name), name, false);
  if (u.empty) {
    els.userCard.innerHTML = `${pic}<div class="heat-meta"><span class="name">${esc(name)}</span><span class="sub">No local dossier yet. It fills when this wallet prints in the live feed.</span></div>`;
    return;
  }
  const cols = (u.collections ?? [])
    .slice(0, 4)
    .map((c) => c.name || c.slug)
    .join(", ");
  const eth = [
    u.ethIn ? `in ${formatAmt(u.ethIn)} ETH` : "",
    u.ethOut ? `out ${formatAmt(u.ethOut)} ETH` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const usd = [
    u.usdIn ? `in $${Math.round(u.usdIn)}` : "",
    u.usdOut ? `out $${Math.round(u.usdOut)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  els.userCard.innerHTML = `
    ${pic}
    <div class="heat-meta">
      <span class="name">${esc(name)}</span>
      <span class="sub">${esc(short(u.address))} · ${u.buys}b / ${u.sells}s / ${u.mints}m · ${u.collectionCount} cols · seen ${relTime(u.firstTs)}</span>
      <span class="sub">${eth || "no ETH prints yet"}${usd ? ` · stables ${usd}` : ""}${cols ? ` · ${esc(cols)}` : ""}</span>
    </div>
    <a class="mute-btn" href="${esc(u.url)}" target="_blank" rel="noreferrer">OS</a>`;
}

function bindRowUsers(node) {
  node.querySelectorAll("[data-wallet]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openUser(btn.dataset.wallet);
    });
  });
}

function bindRowMute(node) {
  node.querySelector("[data-mute]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const btn = ev.currentTarget;
    mute(btn.dataset.mute, btn.dataset.name);
  });
}

function cssId(id) {
  return id.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

function rowHtml(e) {
  const native =
    e.price?.amount != null
      ? `${formatAmt(e.price.amount)} ${e.price.symbol ?? ""}`.trim()
      : "";
  const usd = e.price?.usd != null ? formatUsd(e.price.usd) : "";
  const primary = native || usd || "—";
  const secondary = native && usd ? usd : "";
  const img = e.image
    ? `<img class="thumb" src="${esc(e.image)}" alt="" />`
    : `<span class="thumb"></span>`;
  const icon = ICONS[e.type] || ICONS.transfer;
  const colName = e.collectionName || e.slug;
  const heat = state.heat.find((h) => h.slug === e.slug);
  const flags = heat?.flags ?? [];
  const hotAddrs = new Set(state.traders.map((t) => t.address));
  const flagClass = [
    flags.includes("hot") ? "hot" : "",
    flags.includes("sweep") ? "sweep-row" : "",
    hotAddrs.has(e.to) || hotAddrs.has(e.from) ? "wallet-hit" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const badges = flags
    .map((f) => flagHtml(f))
    .join("");
  return `<article class="row ${esc(e.type)} ${flagClass}${e.fresh ? " fresh" : ""}" id="ev-${cssId(e.id)}" data-id="${esc(e.id)}">
    <div class="event">${icon}<span>${TYPE_LABEL[e.type] ?? e.type}</span></div>
    <div class="item">
      ${img}
      <div class="meta">
        <a class="item-name" href="${esc(e.permalink || e.collectionUrl || "#")}" target="_blank" rel="noreferrer">${esc(e.name)}</a>
        <div class="collection-line">
          <a href="${esc(e.collectionUrl || "#")}" target="_blank" rel="noreferrer">${esc(colName)}</a>
          ${badges}
          <button class="mute-btn inline-mute" data-mute="${esc(e.slug)}" data-name="${esc(colName)}" type="button">Mute</button>
        </div>
      </div>
    </div>
    <div class="price"><span class="native">${esc(primary)}</span>${secondary ? `<span class="usd">${esc(secondary)}</span>` : ""}</div>
    <div class="qty">${e.quantity ?? 1}</div>
    <div class="party" data-side="from">${party(e.from, e.fromName, e.fromUrl, e.fromImage)}</div>
    <div class="party" data-side="to">${party(e.to, e.toName, e.toUrl, e.toImage)}</div>
    <div class="time">${timeHtml(e)}</div>
  </article>`;
}

function timeHtml(e) {
  const label = relTime(e.ts);
  if (!e.txUrl) return esc(label);
  return `<a href="${esc(e.txUrl)}" target="_blank" rel="noreferrer">${esc(label)}</a>`;
}

function flagHtml(flag, label = flag) {
  const help = FLAG_HELP[flag] || "";
  return `<span class="flag ${esc(flag)}" title="${esc(help)}">${esc(label)}</span>`;
}

function partyKind(addr, name) {
  const label = String(name || "").toLowerCase();
  if (KNOWN.has(label)) return "known";
  if (state.traders.some((t) => t.address === addr)) return "hot-trader";
  return "";
}

function party(addr, name, url, image) {
  if (!addr) return "—";
  const label = name || short(addr);
  const href = url || `https://opensea.io/${addr}`;
  const kind = partyKind(addr, name);
  const title =
    kind === "known"
      ? "Watchlist wallet"
      : kind === "hot-trader"
        ? "Hot wallet: early on collections that later ran"
        : image
          ? "OpenSea profile"
          : "No OpenSea PFP yet. Color is a hash of the address, not a rank.";
  return `${avatar(addr, image, kind, title, true)}<a class="${kind === "known" ? "known" : ""}" href="${esc(href)}" target="_blank" rel="noreferrer" title="${esc(title)}">${esc(label)}</a>`;
}

function avatar(addr, image, kind = "", title = "", clickable = false) {
  const hue = parseInt(String(addr || "0x00").replace("0x", "").slice(0, 6), 16) % 360 || 0;
  const letters = String(addr || "??").slice(2, 4).toUpperCase();
  const cls = ["avatar", kind].filter(Boolean).join(" ");
  const inner = image ? `<img src="${esc(image)}" alt="" />` : esc(letters);
  const tag = clickable ? "button" : "span";
  const extra = clickable
    ? `type="button" data-wallet="${esc(addr)}"`
    : "";
  return `<${tag} class="${cls}" ${extra} title="${esc(title || "Local dossier")}" style="background:hsl(${hue} 42% 32%)">${inner}</${tag}>`;
}

function renderHeat() {
  if (!state.heat.length) {
    els.heat.innerHTML = `<div class="hint">Waiting for sale velocity.</div>`;
    return;
  }
  els.heat.innerHTML = state.heat
    .map((h) => {
      const flags = (h.flags ?? [])
        .map((f) => flagHtml(f))
        .join("");
      const delta =
        h.delta == null
          ? ""
          : ` · ${h.delta >= 0 ? "+" : ""}${Math.round(h.delta * 100)}%`;
      const img = h.image
        ? `<img src="${esc(h.image)}" alt="" />`
        : `<span class="ph"></span>`;
      return `<button type="button" class="heat-row${state.focus === h.slug ? " on" : ""}" data-focus="${esc(h.slug)}">
        ${img}
        <span class="heat-meta">
          <span class="name">${esc(h.name)}</span>
          <span class="sub">${h.n1}/min · ${h.n5}/5m · ${h.buyers} buyers${h.usd5 ? ` · $${Math.round(h.usd5)}` : ""}${delta}</span>
        </span>
        <span class="flags">${flags}</span>
      </button>`;
    })
    .join("");
  els.heat.querySelectorAll("[data-focus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.focus = state.focus === btn.dataset.focus ? null : btn.dataset.focus;
      renderHeat();
      renderMints();
      renderChips();
      renderRows();
    });
  });
}

function renderSweeps() {
  if (!state.sweeps.length) {
    els.sweeps.innerHTML = `<div class="hint">No sweeps in the last 40s.</div>`;
    return;
  }
  els.sweeps.innerHTML = state.sweeps
    .map((s) => {
      const who = s.buyerName || short(s.buyer);
      const pic = avatar(
        s.buyer,
        s.buyerImage,
        partyKind(s.buyer, s.buyerName),
        s.buyerName || short(s.buyer),
      );
      return `<button type="button" class="heat-row" data-focus="${esc(s.slug)}">
        ${pic}
        <span class="heat-meta">
          <span class="name">${esc(s.name)}</span>
          <span class="sub">${esc(who)} bought ${s.count}${s.usd ? ` · $${s.usd}` : ""}</span>
        </span>
        <span class="flags">${flagHtml("sweep")}</span>
      </button>`;
    })
    .join("");
  els.sweeps.querySelectorAll("[data-focus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.focus = btn.dataset.focus;
      renderHeat();
      renderChips();
      renderRows();
    });
  });
}

function renderTraders() {
  const rows = state.traders ?? [];
  if (els.traderCount) els.traderCount.textContent = String(rows.length);
  if (!els.traders) return;
  if (!rows.length) {
    els.traders.innerHTML = `<div class="hint">Ledger is filling from live sales. Early hits show once a collection 2.2x its first prints.</div>`;
    return;
  }
  els.traders.innerHTML = rows
    .map((t) => {
      const label = t.name || short(t.address);
      const bags = (t.bags ?? [])
        .filter((b) => b.hot)
        .map((b) => b.name)
        .slice(0, 2)
        .join(", ");
      const flags = [];
      if (t.earlyHits) flags.push(flagHtml("hit", `${t.earlyHits} early`));
      if (t.hitRate) flags.push(flagHtml("organic", `${t.hitRate}%`));
      const pic = avatar(t.address, t.image, "hot-trader", t.name || short(t.address));
      return `<button type="button" class="heat-row${state.wallet === t.address ? " on" : ""}" data-wallet="${esc(t.address)}">
        ${pic}
        <span class="heat-meta">
          <span class="name">${esc(label)}</span>
          <span class="sub"><span class="pnl ${t.realizedUsd >= 0 ? "up" : "down"}">${fmtPnl(t.realizedUsd)} pnl</span>
          · <span class="pnl ${t.upnlUsd >= 0 ? "up" : "down"}">${fmtPnl(t.upnlUsd)} u</span>
          ${bags ? ` · ${esc(bags)}` : ""}</span>
        </span>
        <span class="flags">${flags.join("")}</span>
      </button>`;
    })
    .join("");
  els.traders.querySelectorAll(".heat-row[data-wallet]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const addr = btn.dataset.wallet;
      state.wallet = state.wallet === addr ? null : addr;
      if (state.wallet) openUser(state.wallet);
      else {
        state.user = null;
        renderUserCard();
      }
      renderTraders();
      renderChips();
      renderRows();
    });
  });
}

function renderProjects() {
  const rows = state.projects ?? [];
  if (els.projectCount) els.projectCount.textContent = String(rows.length);
  if (!els.projects) return;
  if (!rows.length) {
    els.projects.innerHTML = `<div class="hint">Waiting on collections that were not in the bootstrap list.</div>`;
    return;
  }
  const canAsk = Boolean(state.backend && state.projectStats?.llmEnabled);
  els.projects.innerHTML = rows
    .map((p) => {
      const flags = (p.flags ?? [])
        .slice(0, 3)
        .map((f) => flagHtml("thin", f))
        .join("");
      const links = [
        p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noreferrer">site</a>` : "",
        p.twitterUrl ? `<a href="${esc(p.twitterUrl)}" target="_blank" rel="noreferrer">x</a>` : "",
        `<a href="${esc(p.collectionUrl)}" target="_blank" rel="noreferrer">os</a>`,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<div class="heat-row${state.focus === p.slug ? " on" : ""}">
        <button type="button" class="heat-meta" data-focus="${esc(p.slug)}" style="background:transparent;border:0;color:inherit;text-align:left;padding:0;font:inherit;cursor:pointer">
          <span class="name">${esc(p.name)}</span>
          <span class="sub">${p.ageMin}m · ${links}${p.llm?.why ? ` · ${esc(p.llm.why)}` : ""}</span>
        </button>
        <span class="proj-actions">
          <span class="flag ${esc(p.verdict)}" title="${esc(FLAG_HELP[p.verdict] || "")}">${esc(p.verdict)}</span>
          ${flags}
          <button type="button" class="mute-btn" data-pack="${esc(p.slug)}">Copy</button>
          ${canAsk ? `<button type="button" class="mute-btn" data-ask="${esc(p.slug)}">Ask</button>` : ""}
        </span>
      </div>`;
    })
    .join("");
  els.projects.querySelectorAll("[data-focus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.focus = state.focus === btn.dataset.focus ? null : btn.dataset.focus;
      renderProjects();
      renderHeat();
      renderMints();
      renderChips();
      renderRows();
    });
  });
  els.projects.querySelectorAll("[data-pack]").forEach((btn) => {
    btn.addEventListener("click", () => copyPack(btn.dataset.pack));
  });
  els.projects.querySelectorAll("[data-ask]").forEach((btn) => {
    btn.addEventListener("click", () => askProject(btn.dataset.ask));
  });
}

function shortWallet(addr) {
  const a = String(addr ?? "");
  if (a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function renderMints() {
  const rows = state.mints ?? [];
  if (els.mintCount) els.mintCount.textContent = String(rows.length);
  if (!els.mints) return;
  const wallet = state.mintStats?.wallet;
  if (!rows.length) {
    const who = wallet ? ` Checking ${shortWallet(wallet)}.` : "";
    els.mints.innerHTML = `<div class="hint">Scanning OpenSea drops and new RH collections.${who}</div>`;
    return;
  }
  els.mints.innerHTML = rows
    .map((m) => {
      const flags = (m.flags ?? [])
        .filter((f) => f !== "paid")
        .slice(0, 4)
        .map((f) => flagHtml(f, f === "you" ? "you" : f))
        .join("");
      const img = m.image
        ? `<img src="${esc(m.image)}" alt="" />`
        : `<span class="ph"></span>`;
      const bits = [
        m.priceLabel || "—",
        m.when,
        m.supply,
        m.stageType,
        m.eligibleReason && m.eligibleReason !== "not eligible" ? m.eligibleReason : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<button type="button" class="heat-row${state.focus === m.slug ? " on" : ""}" data-focus="${esc(m.slug)}">
        ${img}
        <span class="heat-meta">
          <span class="name">${esc(m.name)}</span>
          <span class="sub">${esc(bits)}</span>
        </span>
        <span class="flags">${flags}</span>
      </button>`;
    })
    .join("");
  els.mints.querySelectorAll("[data-focus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.focus = state.focus === btn.dataset.focus ? null : btn.dataset.focus;
      renderMints();
      renderHeat();
      renderProjects();
      renderChips();
      renderRows();
    });
  });
}

async function copyPack(slug) {
  try {
    let pack = "";
    if (state.backend) {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/pack`);
      const data = await res.json();
      pack = data.pack || "";
    } else {
      const p = state.projects.find((row) => row.slug === slug);
      pack = `${state.promptText.trim()}

---
name: ${p?.name || slug}
slug: ${slug}
website: ${p?.website || "(none)"}
twitter: ${p?.twitter ? `@${p.twitter}` : "(none)"}
heuristic: ${p?.verdict} (${(p?.flags ?? []).join(",") || "none"})
`;
    }
    await navigator.clipboard.writeText(pack);
    showToast("Prompt pack copied");
  } catch (err) {
    showToast(err.message || "copy failed");
  }
}

async function askProject(slug) {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/review`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "ask failed");
    const idx = state.projects.findIndex((p) => p.slug === slug);
    if (idx >= 0) {
      state.projects[idx] = {
        ...state.projects[idx],
        verdict: data.verdict,
        llm: data.llm,
        flags: data.flags ?? state.projects[idx].flags,
      };
    }
    renderProjects();
    showToast(`${data.verdict}: ${data.llm?.why || "done"}`);
  } catch (err) {
    showToast(err.message || "ask failed");
  }
}

async function loadPrompt() {
  const local = localStorage.getItem("rh-feed-vapor-prompt");
  try {
    if (state.backend) {
      const res = await fetch("/api/prompt");
      const data = await res.json();
      state.promptText = local || data.text || "";
    } else {
      const res = await fetch("./prompts/vaporware.md");
      state.promptText = local || (await res.text());
    }
  } catch {
    state.promptText = local || "";
  }
  if (els.promptText) els.promptText.value = state.promptText;
}

async function savePrompt() {
  const text = els.promptText.value;
  state.promptText = text;
  localStorage.setItem("rh-feed-vapor-prompt", text);
  if (state.backend) {
    const res = await fetch("/api/prompt", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (els.promptStatus) els.promptStatus.textContent = data.error || "save failed";
      return;
    }
  }
  if (els.promptStatus) {
    els.promptStatus.textContent = state.backend
      ? "Saved to docs/prompts/vaporware.md"
      : "Saved in this browser";
  }
}

function hydrateLocalMutes() {
  try {
    const rows = JSON.parse(localStorage.getItem(MUTE_KEY) ?? "[]");
    if (!Array.isArray(rows) || !rows.length) return;
    for (const row of rows) {
      if (row?.slug) state.mutes.set(row.slug, row);
    }
    if (!state.backend) return;
    fetch("/api/mutes/bulk", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mutes: rows }),
    }).catch(() => {});
  } catch {
    // ignore
  }
}

function persistMutes() {
  localStorage.setItem(MUTE_KEY, JSON.stringify([...state.mutes.values()]));
}

function pingNewSignals(heat, sweeps, traders = [], mints = []) {
  const hot = new Set([
    ...heat.filter((h) => h.flags?.some((f) => f === "hot" || f === "new" || f === "organic")).map((h) => h.slug),
    ...sweeps.map((s) => `${s.buyer}:${s.slug}`),
    ...traders.filter((t) => t.earlyHits > 0).map((t) => `hit:${t.address}:${t.earlyHits}`),
    ...mints
      .filter((m) => m.status === "live" && (m.eligible === true || m.free))
      .map((m) => `mint:${m.slug}:${m.eligible ? "you" : "free"}`),
  ]);
  let fresh = false;
  for (const id of hot) {
    if (!state.lastHot.has(id)) fresh = true;
  }
  state.lastHot = hot;
  if (!fresh) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {
    // ignore
  }
}

function renderResults() {
  const q = state.search.trim().toLowerCase();
  const source = q
    ? state.collections.filter(
        (c) =>
          c.slug.toLowerCase().includes(q) ||
          String(c.name).toLowerCase().includes(q),
      )
    : state.noise;
  const rows = source.slice(0, 18);
  if (!rows.length) {
    els.results.innerHTML = q
      ? `<div class="hint">No collections match "${esc(state.search)}".</div>`
      : `<div class="hint">Live noise shows here. Search to mute any collection.</div>`;
    return;
  }
  els.results.innerHTML = rows
    .map((n) => {
      const slug = n.slug;
      const name = n.name || slug;
      const muted = state.mutes.has(slug);
      const img = n.image
        ? `<img src="${esc(n.image)}" alt="" />`
        : `<span class="ph"></span>`;
      const count = n.count != null ? `<span class="count">${n.count}</span>` : "";
      const action = muted
        ? `<button class="un-btn" data-un="${esc(slug)}" type="button">Unmute</button>`
        : `<button class="mute-btn" data-mute="${esc(slug)}" data-name="${esc(name)}" type="button">Mute</button>`;
      return `<div class="col-row">${img}<span class="name" title="${esc(slug)}">${esc(name)}</span><span>${count}${action}</span></div>`;
    })
    .join("");
  bindMuteButtons(els.results);
}

function renderMutes() {
  const rows = [...state.mutes.values()].sort((a, b) =>
    String(a.name || a.slug).localeCompare(String(b.name || b.slug)),
  );
  els.mutedCount.textContent = String(rows.length);
  if (!rows.length) {
    els.muted.innerHTML = `<div class="hint">Hover a row and click Mute.</div>`;
    return;
  }
  els.muted.innerHTML = rows
    .map((m) => {
      const col = state.collections.find((c) => c.slug === m.slug);
      const img = col?.image
        ? `<img src="${esc(col.image)}" alt="" />`
        : `<span class="ph"></span>`;
      return `<div class="col-row">${img}<span class="name">${esc(m.name || m.slug)}</span><button class="un-btn" data-un="${esc(m.slug)}" type="button">Unmute</button></div>`;
    })
    .join("");
  bindMuteButtons(els.muted);
}

function bindMuteButtons(root) {
  root.querySelectorAll("[data-mute]").forEach((btn) => {
    btn.addEventListener("click", () => mute(btn.dataset.mute, btn.dataset.name));
  });
  root.querySelectorAll("[data-un]").forEach((btn) => {
    btn.addEventListener("click", () => unmute(btn.dataset.un));
  });
}

function applyMuteLocal(row, { toast = true } = {}) {
  if (!row?.slug) return;
  state.mutes.set(row.slug, row);
  state.events = state.events.filter((e) => e.slug !== row.slug);
  if (toast) showToast(`${row.name || row.slug} muted`, () => unmute(row.slug));
}

async function mute(slug, name) {
  if (!slug || state.mutes.has(slug)) return;
  applyMuteLocal({ slug, name, mutedAt: Date.now() });
  persistMutes();
  renderMutes();
  renderResults();
  renderRows();
  if (state.engine) {
    state.engine.mute(slug, name);
    return;
  }
  await fetch("/api/mutes", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug, name }),
  });
}

async function unmute(slug) {
  state.mutes.delete(slug);
  persistMutes();
  renderMutes();
  renderResults();
  if (state.engine) {
    state.engine.unmute(slug);
    await reloadSnapshot();
    renderRows();
    return;
  }
  await fetch(`/api/mutes/${encodeURIComponent(slug)}`, { method: "DELETE" });
  await reloadSnapshot();
  renderRows();
}

function showToast(message, onUndo) {
  els.toast.classList.remove("hidden");
  els.toast.innerHTML = onUndo
    ? `<span>${esc(message)}</span><button class="linkish" type="button">Undo</button>`
    : `<span>${esc(message)}</span>`;
  els.toast.querySelector("button")?.addEventListener("click", () => {
    els.toast.classList.add("hidden");
    onUndo();
  });
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 5000);
}

async function refreshNoise() {
  if (state.engine) {
    const data = state.engine.snapshot(typesParam());
    state.noise = data.noise ?? [];
    if (!state.search.trim()) renderResults();
    return;
  }
  const res = await fetch(`/api/noise?types=${encodeURIComponent(typesParam())}`);
  const data = await res.json();
  state.noise = data.noise ?? [];
  if (!state.search.trim()) renderResults();
}

function fmtPnl(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const body = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${Math.round(abs)}`;
  if (v > 0) return `+${body}`;
  if (v < 0) return `-${body}`;
  return body;
}

function formatUsd(n) {
  if (n < 0.01) return "< $0.01";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: n < 10 ? 2 : 0,
    maximumFractionDigits: n < 10 ? 2 : 0,
  })}`;
}

function formatAmt(n) {
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (n >= 0.0001) return Number(n.toPrecision(4)).toString();
  return n.toExponential(2);
}

function short(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function relTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

els.minUsd.value = String(state.minUsd || "");
els.minUsd.addEventListener("change", () => {
  state.minUsd = Number(els.minUsd.value) || 0;
  localStorage.setItem(USD_KEY, String(state.minUsd));
  renderRows();
});
els.alerts.checked = state.alerts;
els.alerts.addEventListener("change", () => {
  state.alerts = els.alerts.checked;
  localStorage.setItem(ALERT_KEY, state.alerts ? "1" : "0");
});
els.pause.addEventListener("click", () => {
  state.paused = !state.paused;
  els.pause.textContent = state.paused ? "Resume" : "Pause";
});

let searchTimer = null;
els.search.addEventListener("input", () => {
  state.search = els.search.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderResults, 80);
});

setInterval(() => {
  if (!state.paused) renderRows();
}, 1000);
setInterval(refreshNoise, 4000);

els.keyForm?.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const key = els.openseaKey.value.trim();
  if (!key) return;
  localStorage.setItem(KEY_STORE, key);
  startEngine(key);
});
els.keyBtn?.addEventListener("click", () => {
  els.gate?.classList.remove("hidden");
  els.openseaKey.value = localStorage.getItem(KEY_STORE) ?? "";
});
els.promptBtn?.addEventListener("click", () => {
  els.promptDrawer?.classList.remove("hidden");
  if (els.promptText) els.promptText.value = state.promptText;
});
els.promptClose?.addEventListener("click", () => els.promptDrawer?.classList.add("hidden"));
els.promptSave?.addEventListener("click", () => savePrompt());
els.keysBtn?.addEventListener("click", () => els.keysDrawer?.classList.remove("hidden"));
els.keysClose?.addEventListener("click", () => els.keysDrawer?.classList.add("hidden"));
els.keysDrawer?.addEventListener("click", (ev) => {
  if (ev.target === els.keysDrawer) els.keysDrawer.classList.add("hidden");
});

renderTypes();
renderChips();
boot();
