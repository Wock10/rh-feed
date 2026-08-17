const STABLES = new Set(["USDG", "USDC", "USDT", "DAI", "USD", "USDC.E"]);
const ZERO = "0x0000000000000000000000000000000000000000";

const STREAM_TO_TYPE = {
  item_sold: "sale",
  item_listed: "listing",
  item_received_bid: "offer",
  item_received_offer: "offer",
  collection_offer: "collection_offer",
  trait_offer: "trait_offer",
  item_cancelled: "cancel",
};

export const FEED_TYPES = [
  "sale",
  "mint",
  "listing",
  "offer",
  "collection_offer",
  "trait_offer",
  "transfer",
  "cancel",
];

function lc(v) {
  return String(v ?? "").toLowerCase();
}

function shortAddr(addr) {
  const a = String(addr ?? "");
  if (a.length < 12) return a || "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function parseTs(value) {
  if (value == null || value === "") return Date.now();
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }
  const n = Number(value);
  if (Number.isFinite(n) && String(value).trim() !== "" && !String(value).includes("-")) {
    return n < 1e12 ? n * 1000 : n;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : Date.now();
}

function splitNftId(nftId) {
  const parts = String(nftId ?? "").split("/");
  if (parts.length >= 3) {
    return { chain: parts[0], contract: parts[1], tokenId: parts[2] };
  }
  return { chain: "", contract: "", tokenId: "" };
}

function priceFromStream(inner) {
  const token = inner.payment_token ?? {};
  const raw = inner.sale_price ?? inner.base_price ?? null;
  const symbol = String(token.symbol ?? "").toUpperCase() || null;
  const decimals = Number(token.decimals ?? 18);
  if (raw == null) {
    return { amount: null, symbol, usd: null, raw: null };
  }
  let amount = 0;
  try {
    amount = Number(BigInt(String(raw))) / 10 ** decimals;
  } catch {
    amount = Number(raw) / 10 ** decimals;
  }
  if (!Number.isFinite(amount)) amount = null;
  let usd = null;
  if (amount != null && STABLES.has(symbol)) {
    usd = amount;
  } else if (amount != null) {
    const ethPrice = Number(token.eth_price);
    const usdPrice = Number(token.usd_price);
    if (ethPrice > 0 && usdPrice > 0) {
      usd = (amount * usdPrice) / ethPrice;
    } else if (usdPrice > 0 && amount > 0 && usdPrice / amount < 1e7) {
      usd = usdPrice;
    }
  }
  return { amount, symbol, usd, raw: String(raw) };
}

function mapStreamType(eventName, inner) {
  if (eventName === "item_transferred") {
    const from = lc(inner.from_account?.address);
    if (!from || from === ZERO) return "mint";
    return "transfer";
  }
  return STREAM_TO_TYPE[eventName] ?? eventName;
}

function partyName(account) {
  if (!account || typeof account !== "object") return null;
  return account.username || account.user?.username || account.ens_name || account.display_name || null;
}

function partyImage(account) {
  if (!account || typeof account !== "object") return null;
  return (
    account.profile_img_url ||
    account.profile_image_url ||
    account.image_url ||
    account.user?.profile_img_url ||
    account.user?.profile_image_url ||
    null
  );
}

function titleFromSlug(slug) {
  return String(slug ?? "")
    .replace(/-\d{5,}$/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || slug;
}

export function normalizeStreamEvent(eventName, framePayload) {
  const inner = framePayload?.payload ?? framePayload;
  if (!inner || typeof inner !== "object") return null;
  const item = inner.item ?? {};
  const chain = lc(inner.chain?.name ?? inner.chain ?? item.chain?.name);
  if (chain !== "robinhood") return null;

  const type = mapStreamType(eventName, inner);
  const ids = splitNftId(item.nft_id);
  const slug = inner.collection?.slug ?? "";
  const tx = inner.transaction?.hash ?? inner.order_hash ?? "";
  const ts = parseTs(inner.event_timestamp ?? inner.transaction?.timestamp);
  const from =
    inner.from_account?.address ??
    inner.maker?.address ??
    inner.seller ??
    null;
  const to =
    inner.to_account?.address ??
    inner.taker?.address ??
    inner.buyer ??
    null;
  const fromName = partyName(inner.from_account) || partyName(inner.maker);
  const toName = partyName(inner.to_account) || partyName(inner.taker);
  const fromImage = partyImage(inner.from_account) || partyImage(inner.maker);
  const toImage = partyImage(inner.to_account) || partyImage(inner.taker);
  const price = priceFromStream(inner);
  const tokenId = ids.tokenId || item.identifier || "";
  const name = item.metadata?.name || (tokenId ? `#${tokenId}` : slug || "Unknown");
  const id = [type, tx || inner.order_hash || ts, ids.contract, tokenId, slug].join(":");
  const collectionName = inner.collection?.name || titleFromSlug(slug);

  return {
    id,
    type,
    ts,
    chain,
    slug,
    collectionName,
    contract: ids.contract || null,
    tokenId: tokenId || null,
    name,
    image: item.metadata?.image_url ?? null,
    permalink:
      item.permalink ||
      (ids.contract && tokenId
        ? `https://opensea.io/item/robinhood/${ids.contract}/${tokenId}`
        : null),
    collectionUrl: slug ? `https://opensea.io/collection/${encodeURIComponent(slug)}` : null,
    from: from ? lc(from) : null,
    to: to ? lc(to) : null,
    fromName,
    toName,
    fromImage,
    toImage,
    fromUrl: fromName ? `https://opensea.io/${encodeURIComponent(fromName)}` : from ? `https://opensea.io/${lc(from)}` : null,
    toUrl: toName ? `https://opensea.io/${encodeURIComponent(toName)}` : to ? `https://opensea.io/${lc(to)}` : null,
    quantity: Number(inner.quantity ?? 1) || 1,
    price,
    tx: tx || null,
    txUrl: tx ? `https://robinhoodchain.blockscout.com/tx/${tx}` : null,
  };
}

export function formatAmount(amount, symbol) {
  if (amount == null || !Number.isFinite(amount)) return null;
  const pretty =
    amount >= 1
      ? amount.toLocaleString("en-US", { maximumFractionDigits: 4 })
      : amount >= 0.0001
        ? amount.toPrecision(4)
        : amount.toExponential(2);
  return symbol ? `${pretty} ${symbol}` : pretty;
}

export function formatUsd(usd) {
  if (usd == null || !Number.isFinite(usd)) return null;
  if (usd < 0.01) return "< $0.01";
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: usd < 10 ? 2 : 0,
    maximumFractionDigits: usd < 10 ? 2 : 0,
  })}`;
}

export { shortAddr, ZERO, titleFromSlug };
