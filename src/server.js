import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { OpenSeaStream } from "./stream.js";
import { OpenSeaRest } from "./rest.js";
import { FeedStore } from "./store.js";
import { normalizeStreamEvent } from "./normalize.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const PORT = Number(process.env.PORT ?? 8788);
const CHAIN = process.env.CHAIN ?? "robinhood";
const PUBLIC = path.join(ROOT, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const store = new FeedStore({ dataDir: path.join(ROOT, "data") });
const rest = new OpenSeaRest(process.env);
const stream = new OpenSeaStream({ apiKey: rest.keys[0], chain: CHAIN });

/** @type {Set<{ res: import('node:http').ServerResponse, types: Set<string>|null }>} */
const clients = new Set();
const pending = new Map();
const resolveQueue = [];
const resolveQueued = new Set();
let resolveTimer = null;
let streamState = "connecting";

function parseTypes(url) {
  const raw = url.searchParams.get("types");
  if (!raw || raw === "all") return null;
  const types = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return types.length ? types : null;
}

function json(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function payloadFor(event) {
  return event;
}

function flushClient(client, events) {
  if (!events.length) return;
  client.res.write(`event: events\ndata: ${JSON.stringify({ events })}\n\n`);
}

function broadcast(event) {
  for (const client of clients) {
    if (client.types && !client.types.has(event.type)) continue;
    if (store.isMuted(event.slug)) continue;
    let buf = pending.get(client);
    if (!buf) {
      buf = [];
      pending.set(client, buf);
    }
    buf.push(payloadFor(event));
  }
}

setInterval(() => {
  for (const [client, events] of pending) {
    if (!clients.has(client)) {
      pending.delete(client);
      continue;
    }
    flushClient(client, events);
    pending.delete(client);
  }
}, 80);

function broadcastStatus() {
  const data = JSON.stringify({
    stream: streamState,
    ...store.status(),
  });
  for (const client of clients) {
    client.res.write(`event: status\ndata: ${data}\n\n`);
  }
}

function enqueueResolve(addresses) {
  for (const addr of addresses) {
    if (!addr || store.accounts.has(addr) || resolveQueued.has(addr)) continue;
    resolveQueued.add(addr);
    resolveQueue.push(addr);
  }
  pumpResolve();
}

function pumpResolve() {
  if (resolveTimer || !resolveQueue.length || !rest.hasKeys) return;
  resolveTimer = setTimeout(async () => {
    resolveTimer = null;
    const addr = resolveQueue.shift();
    if (!addr) return;
    try {
      const profile = await rest.getAccount(addr);
      const name =
        profile?.username || profile?.ens_name || profile?.display_name || null;
      const slug = profile?.username || profile?.ens_name || addr;
      const row = {
        name,
        url: `https://opensea.io/${encodeURIComponent(slug)}`,
      };
      store.setAccount(addr, row);
      const data = JSON.stringify({ address: addr, ...row });
      for (const client of clients) {
        client.res.write(`event: profile\ndata: ${data}\n\n`);
      }
    } catch (err) {
      store.setAccount(addr, {
        name: null,
        url: `https://opensea.io/${addr}`,
      });
      console.warn("account lookup failed", addr, err.message);
    } finally {
      resolveQueued.delete(addr);
      if (store.accounts.size % 25 === 0) {
        store.saveAccounts().catch(() => {});
      }
      pumpResolve();
    }
  }, 550);
}

stream.on("event", (eventName, payload) => {
  const event = normalizeStreamEvent(eventName, payload);
  if (!event) return;
  const kept = store.ingest(event);
  if (!kept) return;
  broadcast(kept);
  if (kept.type === "sale" || kept.type === "mint") {
    enqueueResolve(store.unknownAddresses([kept], 8));
  }
});

stream.on("status", ({ state }) => {
  streamState = state;
  broadcastStatus();
});

stream.on("error", (err) => {
  console.warn("stream", err.message);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true, stream: streamState, ...store.status() });
  }

  if (req.method === "GET" && url.pathname === "/api/snapshot") {
    const types = parseTypes(url);
    const events = store.snapshot({ types, limit: Number(url.searchParams.get("limit") ?? 120) });
    enqueueResolve(store.unknownAddresses(events, 20));
    return json(res, 200, {
      events,
      mutes: [...store.mutes.values()],
      noise: store.noiseBoard({ types }),
      heat: store.heat({ types }),
      sweeps: store.sweeps(),
      collections: store.listCollections(),
      status: { stream: streamState, ...store.status() },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/trends") {
    const types = parseTypes(url);
    return json(res, 200, {
      heat: store.heat({ types }),
      sweeps: store.sweeps(),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/collections") {
    const q = String(url.searchParams.get("q") ?? "").trim().toLowerCase();
    let rows = store.listCollections();
    if (q) {
      rows = rows.filter(
        (c) =>
          c.slug.toLowerCase().includes(q) ||
          String(c.name).toLowerCase().includes(q),
      );
    }
    return json(res, 200, { collections: rows.slice(0, 40) });
  }

  if (req.method === "GET" && url.pathname === "/api/noise") {
    return json(res, 200, { noise: store.noiseBoard({ types: parseTypes(url) }) });
  }

  if (req.method === "GET" && url.pathname === "/api/mutes") {
    return json(res, 200, { mutes: [...store.mutes.values()] });
  }

  if (req.method === "PUT" && url.pathname === "/api/mutes/bulk") {
    const body = await readBody(req);
    const rows = Array.isArray(body.mutes) ? body.mutes : [];
    for (const row of rows) {
      const slug = String(row.slug ?? "").trim();
      if (slug) store.mute(slug, row.name);
    }
    await store.saveMutes();
    return json(res, 200, { mutes: [...store.mutes.values()] });
  }

  if (req.method === "PUT" && url.pathname === "/api/mutes") {
    const body = await readBody(req);
    const slug = String(body.slug ?? "").trim();
    if (!slug) return json(res, 400, { error: "slug is required" });
    const row = store.mute(slug, body.name);
    await store.saveMutes();
    const data = JSON.stringify({ mute: row });
    for (const client of clients) client.res.write(`event: mute\ndata: ${data}\n\n`);
    return json(res, 200, row);
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/mutes/")) {
    const slug = decodeURIComponent(url.pathname.slice("/api/mutes/".length));
    store.unmute(slug);
    await store.saveMutes();
    const data = JSON.stringify({ unmute: slug });
    for (const client of clients) client.res.write(`event: mute\ndata: ${data}\n\n`);
    return json(res, 200, { ok: true, slug });
  }

  if (req.method === "GET" && url.pathname === "/api/stream") {
    const types = parseTypes(url);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(":\n\n");
    const client = { res, types: types ? new Set(types) : null };
    clients.add(client);
    const hello = {
      events: store.snapshot({ types, limit: 80 }),
      mutes: [...store.mutes.values()],
      noise: store.noiseBoard({ types }),
      heat: store.heat({ types: types ?? ["sale"] }),
      sweeps: store.sweeps(),
      collections: store.listCollections(),
      status: { stream: streamState, ...store.status() },
    };
    res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);
    enqueueResolve(store.unknownAddresses(hello.events, 20));
    req.on("close", () => {
      clients.delete(client);
      pending.delete(client);
    });
    return;
  }

  json(res, 404, { error: "not found" });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    if (urlPath === "/") {
      res.writeHead(500, { "content-type": "text/plain" }).end("missing public/index.html");
      return;
    }
    res.writeHead(404).end("not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    return serveStatic(res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: String(err.message) });
  }
});

await store.load();
if (!rest.hasKeys) {
  console.error("Set OPENSEA_API_KEY in .env");
  process.exit(1);
}

stream.start();
broadcastStatus();
function broadcastTrends() {
  for (const client of clients) {
    const types = client.types ? [...client.types] : ["sale"];
    const data = JSON.stringify({
      heat: store.heat({ types: client.types ? types : ["sale"] }),
      sweeps: store.sweeps(),
    });
    client.res.write(`event: trends\ndata: ${data}\n\n`);
  }
}

setInterval(broadcastTrends, 2000);

rest
  .listChainCollections(CHAIN)
  .then((rows) => {
    store.addCollections(rows);
    console.log(`Loaded ${rows.length} ${CHAIN} collections`);
  })
  .catch((err) => console.warn("collection bootstrap failed:", err.message));

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RH feed  http://localhost:${PORT}`);
});
