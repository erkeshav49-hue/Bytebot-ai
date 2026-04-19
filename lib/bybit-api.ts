import { Candle } from './indicators';

// ─── HMAC-SHA256 ──────────────────────────────────────────────────────────────

async function hmac(sec: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(sec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Bybit API ────────────────────────────────────────────────────────────────

export function getBase(testnet: boolean) {
  return testnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
}

export async function apiPost(base: string, apiKey: string, apiSecret: string, path: string, body: object) {
  const ts = Date.now() + '', rw = '5000', bs = JSON.stringify(body);
  const sig = await hmac(apiSecret, ts + apiKey + rw + bs);
  const r = await fetch(base + path, {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-SIGN': sig,
      'X-BAPI-RECV-WINDOW': rw,
      'Content-Type': 'application/json',
    },
    body: bs,
  });
  return r.json();
}

export async function apiGet(base: string, apiKey: string, apiSecret: string, path: string, p: Record<string, string> = {}) {
  const ts = Date.now() + '', rw = '5000', qs = new URLSearchParams(p).toString();
  const sig = await hmac(apiSecret, ts + apiKey + rw + qs);
  const r = await fetch(`${base}${path}?${qs}`, {
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-SIGN': sig,
      'X-BAPI-RECV-WINDOW': rw,
    },
  });
  return r.json();
}

export async function pubGet(base: string, path: string, p: Record<string, string>) {
  const r = await fetch(`${base}${path}?${new URLSearchParams(p)}`);
  return r.json();
}

export async function fetchKlines(base: string, sym: string, cat: string, interval = '5', limit = 80): Promise<Candle[]> {
  const d = await pubGet(base, '/v5/market/kline', { category: cat, symbol: sym, interval, limit: String(limit) });
  return ((d.result?.list || []) as string[][]).slice().reverse().map(r => ({
    o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5],
  }));
}

export async function fetchTicker(base: string, sym: string, cat: string): Promise<{ last: number; chg: number; vol: number } | null> {
  const d = await pubGet(base, '/v5/market/tickers', { category: cat, symbol: sym });
  const t = d.result?.list?.[0];
  return t ? { last: +t.lastPrice, chg: +t.price24hPcnt, vol: +t.volume24h } : null;
}

export async function fetchBalance(base: string, apiKey: string, apiSecret: string) {
  return apiGet(base, apiKey, apiSecret, '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
}

export async function fetchPositions(base: string, apiKey: string, apiSecret: string) {
  return apiGet(base, apiKey, apiSecret, '/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
}

export async function placeOrder(base: string, apiKey: string, apiSecret: string, body: object) {
  return apiPost(base, apiKey, apiSecret, '/v5/order/create', body);
}
