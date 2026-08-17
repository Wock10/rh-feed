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

const MUTE_KEY = "rh-feed-mutes";
const USD_KEY = "rh-feed-min-usd";
const ALERT_KEY = "rh-feed-alerts";

const state = {
  types: new Set(["sale"]),
  allTypes: false,
  events: [],
  mutes: new Map(),
  noise: [],
  collections: [],
  heat: [],
  sweeps: [],
  focus: null,
  minUsd: Number(localStorage.getItem(USD_KEY) ?? 0) || 0,
  alerts: localStorage.getItem(ALERT_KEY) === "1",
  paused: false,
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
  minUsd: document.getElementById("min-usd"),
  alerts: document.getElementById("alerts"),
};

function typesParam() {
  if (state.allTypes) return "all";
  return [...state.types].join(",");
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
        event.fromName = p.name;
        event.fromUrl = p.url;
      }
      if (event.to === p.address) {
        event.toName = p.name;
        event.toUrl = p.url;
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
  if (state.alerts) pingNewSignals(state.heat, state.sweeps);
  renderHeat();
  renderSweeps();
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
      connect();
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
      } else if (state.types.size > 1) {
        state.types.delete(id);
      } else {
        state.types = new Set(["sale"]);
      }
      renderTypes();
      renderChips();
      connect();
    });
  });
}

async function reloadSnapshot() {
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
      if (from) from.innerHTML = party(event.from, event.fromName, event.fromUrl);
      if (to) to.innerHTML = party(event.to, event.toName, event.toUrl);
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
    els.rows.insertBefore(node, anchor);
    anchor = node.nextSibling;
  }
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
  const usd = e.price?.usd != null ? formatUsd(e.price.usd) : "—";
  const native =
    e.price?.amount != null
      ? `${formatAmt(e.price.amount)} ${e.price.symbol ?? ""}`.trim()
      : "";
  const img = e.image
    ? `<img class="thumb" src="${esc(e.image)}" alt="" />`
    : `<span class="thumb"></span>`;
  const icon = ICONS[e.type] || ICONS.transfer;
  const colName = e.collectionName || e.slug;
  const heat = state.heat.find((h) => h.slug === e.slug);
  const flags = heat?.flags ?? [];
  const flagClass = [
    flags.includes("hot") ? "hot" : "",
    flags.includes("sweep") ? "sweep-row" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const badges = flags
    .map((f) => `<span class="flag ${f}">${f}</span>`)
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
    <div class="price"><span class="usd">${usd}</span>${native ? `<span class="native">${esc(native)}</span>` : ""}</div>
    <div class="qty">${e.quantity ?? 1}</div>
    <div class="party" data-side="from">${party(e.from, e.fromName, e.fromUrl)}</div>
    <div class="party" data-side="to">${party(e.to, e.toName, e.toUrl)}</div>
    <div class="time">${timeHtml(e)}</div>
  </article>`;
}

function timeHtml(e) {
  const label = relTime(e.ts);
  if (!e.txUrl) return esc(label);
  return `<a href="${esc(e.txUrl)}" target="_blank" rel="noreferrer">${esc(label)}</a>`;
}

function party(addr, name, url) {
  if (!addr) return "—";
  const label = name || short(addr);
  const href = url || `https://opensea.io/${addr}`;
  const known = KNOWN.has(String(label).toLowerCase());
  return `${avatar(addr)}<a class="${known ? "known" : ""}" href="${esc(href)}" target="_blank" rel="noreferrer">${esc(label)}</a>`;
}

function avatar(addr) {
  const hue = parseInt(String(addr).replace("0x", "").slice(0, 6), 16) % 360;
  const letters = String(addr).slice(2, 4).toUpperCase();
  return `<span class="avatar" style="background:hsl(${hue} 42% 32%)">${esc(letters)}</span>`;
}

function renderHeat() {
  if (!state.heat.length) {
    els.heat.innerHTML = `<div class="hint">Waiting for sale velocity.</div>`;
    return;
  }
  els.heat.innerHTML = state.heat
    .map((h) => {
      const flags = (h.flags ?? [])
        .map((f) => `<span class="flag ${f}">${f}</span>`)
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
      return `<button type="button" class="heat-row" data-focus="${esc(s.slug)}">
        <span class="ph"></span>
        <span class="heat-meta">
          <span class="name">${esc(s.name)}</span>
          <span class="sub">${esc(who)} bought ${s.count}${s.usd ? ` · $${s.usd}` : ""}</span>
        </span>
        <span class="flags"><span class="flag sweep">sweep</span></span>
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

function hydrateLocalMutes() {
  try {
    const rows = JSON.parse(localStorage.getItem(MUTE_KEY) ?? "[]");
    if (!Array.isArray(rows) || !rows.length) return;
    for (const row of rows) {
      if (row?.slug) state.mutes.set(row.slug, row);
    }
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

function pingNewSignals(heat, sweeps) {
  const hot = new Set([
    ...heat.filter((h) => h.flags?.some((f) => f === "hot" || f === "new" || f === "organic")).map((h) => h.slug),
    ...sweeps.map((s) => `${s.buyer}:${s.slug}`),
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
  await fetch(`/api/mutes/${encodeURIComponent(slug)}`, { method: "DELETE" });
  await reloadSnapshot();
  renderRows();
}

function showToast(message, onUndo) {
  els.toast.classList.remove("hidden");
  els.toast.innerHTML = `<span>${esc(message)}</span><button class="linkish" type="button">Undo</button>`;
  els.toast.querySelector("button").addEventListener("click", () => {
    els.toast.classList.add("hidden");
    onUndo();
  });
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 5000);
}

async function refreshNoise() {
  const res = await fetch(`/api/noise?types=${encodeURIComponent(typesParam())}`);
  const data = await res.json();
  state.noise = data.noise ?? [];
  if (!state.search.trim()) renderResults();
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

renderTypes();
renderChips();
connect();
