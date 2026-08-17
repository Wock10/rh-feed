import { EventEmitter } from "node:events";

const WS_URL = "wss://stream-api.opensea.io/socket/websocket";
const EVENT_TYPES = [
  "item_sold",
  "item_listed",
  "item_transferred",
  "item_received_bid",
  "item_received_offer",
  "collection_offer",
  "trait_offer",
];

export class OpenSeaStream extends EventEmitter {
  constructor({ apiKey, chain = "robinhood" }) {
    super();
    this.apiKey = apiKey;
    this.chain = chain;
    this.ws = null;
    this.heartbeat = null;
    this.reconnectTimer = null;
    this.ref = 1;
    this.closed = false;
    this.connected = false;
    this.backoffMs = 1000;
  }

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    this.teardown();
  }

  connect() {
    if (this.closed) return;
    this.teardown(false);
    const url = `${WS_URL}?token=${encodeURIComponent(this.apiKey)}&vsn=2.0.0`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.connected = true;
      this.backoffMs = 1000;
      this.join();
      this.startHeartbeat();
      this.emit("status", { state: "live" });
    });

    ws.addEventListener("message", (ev) => {
      this.onMessage(ev.data);
    });

    ws.addEventListener("close", () => {
      this.connected = false;
      this.emit("status", { state: "reconnecting" });
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    });
  }

  join() {
    this.send(["1", String(this.ref++), "collection:*", "phx_join", { event_types: EVENT_TYPES }]);
  }

  startHeartbeat() {
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.send([null, String(this.ref++), "phoenix", "heartbeat", {}]);
    }, 25_000);
  }

  send(frame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(frame));
  }

  onMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(frame) || frame.length < 5) return;
    const eventName = frame[3];
    const payload = frame[4];
    if (eventName === "phx_reply") {
      if (payload?.status && payload.status !== "ok") {
        this.emit("error", new Error(`OpenSea stream join ${payload.status}`));
      }
      return;
    }
    if (eventName === "phx_error" || eventName === "phx_close") {
      this.emit("status", { state: "reconnecting" });
      return;
    }
    this.emit("event", eventName, payload);
  }

  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.8, 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  teardown(clearReconnect = true) {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (clearReconnect) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
  }
}
