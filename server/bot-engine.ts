// ─── Server-Side Bot Engine ──────────────────────────────────────────────────
// Runs the 45-second scan loop in the Node.js server process (24/7).
// All state is kept in memory; the mobile app polls via tRPC.

import type {
  BotConfig, BotStatus, BotStats, OpenTrade, TradeLogEntry,
  AIDecision, BotSnapshot,
} from "../shared/bot-types";
import { DEFAULT_CONFIG } from "../shared/bot-types";

// ─── Indicator calculations (ported from lib/indicators.ts) ─────────────────

interface Candle { o: number; h: number; l: number; c: number; v: number; }
interface Indicators {
  ema: { e9: string; e21: string; e50: string; status: string };
  rsi: { value: string; zone: string };
  macd: { h: string; sig: string };
  adx: { adx: string; dp: string; dn: string };
  bb: { u: string; lo: string; pos_pct: string; pos_label: string; squeeze: boolean; bw: string };
  atr_pct: string;
  volume_ratio: string;
  last_5_closes: string[];
}

function emaArr(cl: number[], p: number): number[] {
  const k = 2 / (p + 1); let e = cl[0]; const r = [e];
  for (let i = 1; i < cl.length; i++) { e = cl[i] * k + e * (1 - k); r.push(e); }
  return r;
}

function calcRSI(cl: number[], p = 14): number {
  if (cl.length < p + 2) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = cl[i] - cl[i - 1]; d > 0 ? (g += d) : (l -= d); }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; ag = (ag * (p - 1) + Math.max(d, 0)) / p; al = (al * (p - 1) + Math.max(-d, 0)) / p; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function calcMACD(cl: number[]): { h: string; sig: string } {
  if (cl.length < 27) return { h: '0', sig: 'flat' };
  const e12 = emaArr(cl, 12), e26 = emaArr(cl, 26);
  const ml = cl.map((_, i) => (e12[i] || 0) - (e26[i] || 0));
  const sg = emaArr(ml.slice(-20), 9), sg2 = emaArr(ml.slice(-21), 9);
  const h = ml[ml.length - 1] - sg[sg.length - 1];
  const hp = ml[ml.length - 2] - (sg2[sg2.length - 1] || 0);
  return { h: h.toFixed(6), sig: h > 0 && h > hp ? 'rising_bullish' : h < 0 && h < hp ? 'falling_bearish' : h > 0 ? 'bullish_weakening' : 'bearish_weakening' };
}

function calcADX(h: number[], lo: number[], cl: number[]): { adx: string; dp: string; dn: string } {
  const p = 14;
  if (cl.length < p + 2) return { adx: '0', dp: '0', dn: '0' };
  const tr: number[] = [], pd: number[] = [], nd: number[] = [];
  for (let i = 1; i < cl.length; i++) {
    tr.push(Math.max(h[i] - lo[i], Math.abs(h[i] - cl[i - 1]), Math.abs(lo[i] - cl[i - 1])));
    pd.push(h[i] - h[i - 1] > lo[i - 1] - lo[i] ? Math.max(h[i] - h[i - 1], 0) : 0);
    nd.push(lo[i - 1] - lo[i] > h[i] - h[i - 1] ? Math.max(lo[i - 1] - lo[i], 0) : 0);
  }
  const st = tr.slice(-p).reduce((a, b) => a + b, 1);
  const dp = (pd.slice(-p).reduce((a, b) => a + b, 0) / st) * 100;
  const dn = (nd.slice(-p).reduce((a, b) => a + b, 0) / st) * 100;
  return { adx: (Math.abs(dp - dn) / ((dp + dn) || 1) * 100).toFixed(1), dp: dp.toFixed(1), dn: dn.toFixed(1) };
}

function calcBB(cl: number[]) {
  const p = 20;
  if (cl.length < p) return { u: (cl[cl.length - 1] * 1.02).toFixed(2), lo: (cl[cl.length - 1] * 0.98).toFixed(2), pos_pct: '50', pos_label: 'middle', squeeze: false, bw: '4' };
  const sl = cl.slice(-p); const m = sl.reduce((a, b) => a + b, 0) / p;
  const s = Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / p);
  const u = m + 2 * s, lo = m - 2 * s;
  const pos = (cl[cl.length - 1] - lo) / ((u - lo) || 1);
  const bw = (s / m) * 100 * 2;
  return { u: u.toFixed(2), lo: lo.toFixed(2), pos_pct: (pos * 100).toFixed(0), pos_label: pos < 0.2 ? 'near_lower' : pos > 0.8 ? 'near_upper' : 'middle', squeeze: bw < 2.5, bw: bw.toFixed(2) };
}

function buildIndicators(candles: Candle[]): Indicators {
  const cl = candles.map(c => c.c), h = candles.map(c => c.h), lo = candles.map(c => c.l), v = candles.map(c => c.v);
  const n = cl.length;
  const e9 = emaArr(cl, 9), e21 = emaArr(cl, 21), e50 = emaArr(cl, 50);
  const rsi = calcRSI(cl, 14), macd = calcMACD(cl), adx = calcADX(h, lo, cl), bb = calcBB(cl);
  let atrS = 0; const aLen = Math.min(14, n - 1);
  for (let i = n - aLen; i < n; i++) atrS += Math.max(h[i] - lo[i], Math.abs(h[i] - (cl[i - 1] || cl[i])), Math.abs(lo[i] - (cl[i - 1] || cl[i])));
  const atrPct = aLen > 0 ? ((atrS / aLen / cl[n - 1]) * 100).toFixed(2) : '0';
  const rv = v.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const av = v.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volR = (av > 0 ? rv / av : 1).toFixed(2);
  const xUp = e9[n - 2] <= e21[n - 2] && e9[n - 1] > e21[n - 1];
  const xDn = e9[n - 2] >= e21[n - 2] && e9[n - 1] < e21[n - 1];
  const emaStatus = xUp ? 'BULLISH_CROSSOVER' : xDn ? 'BEARISH_CROSSOVER' : e9[n - 1] > e21[n - 1] && e21[n - 1] > e50[n - 1] ? 'BULL_STACK' : e9[n - 1] < e21[n - 1] && e21[n - 1] < e50[n - 1] ? 'BEAR_STACK' : 'MIXED';
  return {
    ema: { e9: e9[n - 1].toFixed(2), e21: e21[n - 1].toFixed(2), e50: e50[n - 1].toFixed(2), status: emaStatus },
    rsi: { value: rsi.toFixed(1), zone: rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : rsi > 55 ? 'bullish_momentum' : 'neutral' },
    macd, adx, bb, atr_pct: atrPct, volume_ratio: volR,
    last_5_closes: cl.slice(-5).map(v => v.toFixed(2)),
  };
}

// ─── Bybit API (server-side, no CORS) ───────────────────────────────────────

import { createHmac } from "crypto";

function hmacSync(sec: string, msg: string): string {
  return createHmac('sha256', sec).update(msg).digest('hex');
}

function getBase(testnet: boolean) {
  return testnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
}

async function pubGet(base: string, path: string, p: Record<string, string>) {
  const r = await fetch(`${base}${path}?${new URLSearchParams(p)}`);
  return r.json();
}

async function apiPost(base: string, apiKey: string, apiSecret: string, path: string, body: object) {
  const ts = Date.now() + '', rw = '5000', bs = JSON.stringify(body);
  const sig = hmacSync(apiSecret, ts + apiKey + rw + bs);
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': rw, 'Content-Type': 'application/json' },
    body: bs,
  });
  return r.json();
}

async function apiGet(base: string, apiKey: string, apiSecret: string, path: string, p: Record<string, string> = {}) {
  const ts = Date.now() + '', rw = '5000', qs = new URLSearchParams(p).toString();
  const sig = hmacSync(apiSecret, ts + apiKey + rw + qs);
  const r = await fetch(`${base}${path}?${qs}`, {
    headers: { 'X-BAPI-API-KEY': apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-SIGN': sig, 'X-BAPI-RECV-WINDOW': rw },
  });
  return r.json();
}

async function fetchKlines(base: string, sym: string, cat: string, interval = '5', limit = 80): Promise<Candle[]> {
  const d = await pubGet(base, '/v5/market/kline', { category: cat, symbol: sym, interval, limit: String(limit) });
  return ((d.result?.list || []) as string[][]).slice().reverse().map(r => ({ o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));
}

async function fetchTicker(base: string, sym: string, cat: string): Promise<{ last: number; chg: number; vol: number } | null> {
  const d = await pubGet(base, '/v5/market/tickers', { category: cat, symbol: sym });
  const t = d.result?.list?.[0];
  return t ? { last: +t.lastPrice, chg: +t.price24hPcnt, vol: +t.volume24h } : null;
}

async function fetchPositions(base: string, apiKey: string, apiSecret: string) {
  return apiGet(base, apiKey, apiSecret, '/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
}

async function placeOrder(base: string, apiKey: string, apiSecret: string, body: object) {
  return apiPost(base, apiKey, apiSecret, '/v5/order/create', body);
}

// ─── Telegram (server-side) ─────────────────────────────────────────────────

async function tgSend(token: string, chatId: string, msg: string): Promise<void> {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
    });
  } catch (e) { /* silent */ }
}

async function tgTest(token: string, chatId: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ <b>ByteBot AI connected!</b>\n🤖 Brain: Groq AI (llama-3.3-70b) FREE\n\nSend /help for all commands 👇', parse_mode: 'HTML' }),
    });
    const d = await r.json();
    return d.ok === true;
  } catch { return false; }
}

// ─── Groq AI (server-side, no CORS) ─────────────────────────────────────────

interface GroqDecision {
  action: 'long' | 'short' | 'wait';
  confidence: number;
  reasoning: string;
  key_factor: string;
  risk_level: string;
  market_regime: string;
  warnings: string[];
}

async function askGroq(groqKey: string, sym: string, mkt: string, indicators: Indicators, htfTrend: string, ticker: { last: number; chg: number; vol: number }, newsHeadlines: string[], recentTrades: TradeLogEntry[]): Promise<GroqDecision> {
  const newsCtx = newsHeadlines.length ? 'RECENT CRYPTO NEWS:\n' + newsHeadlines.slice(0, 4).map((h, i) => `${i + 1}. ${h}`).join('\n') : 'No news available.';
  const tradeCtx = recentTrades.length ? 'RECENT TRADE HISTORY (learn from these):\n' + recentTrades.slice(0, 5).map(t => `- ${t.side.toUpperCase()} ${t.sym} [${t.mkt}]: P&L ${+t.pnl >= 0 ? '+' : ''}${t.pnl} USDT (${t.reason})`).join('\n') : 'No recent trades yet.';

  const prompt = `You are an expert cryptocurrency scalping trader. Analyze this market data and return a trading decision as JSON only.

SYMBOL: ${sym} | MARKET: ${mkt.toUpperCase()} | TIMEFRAME: 5min
PRICE: ${ticker.last} | 24H CHANGE: ${(ticker.chg * 100).toFixed(2)}% | VOLUME: ${(ticker.vol / 1e6).toFixed(1)}M USDT

TECHNICAL INDICATORS:
EMA Status: ${indicators.ema.status}
EMA-9: ${indicators.ema.e9} | EMA-21: ${indicators.ema.e21} | EMA-50: ${indicators.ema.e50}
RSI(14): ${indicators.rsi.value} [${indicators.rsi.zone}]
MACD: ${indicators.macd.h} [${indicators.macd.sig}]
ADX: ${indicators.adx.adx} | +DI: ${indicators.adx.dp} | -DI: ${indicators.adx.dn}
Bollinger: Position ${indicators.bb.pos_pct}% [${indicators.bb.pos_label}] | BW: ${indicators.bb.bw}% | Squeeze: ${indicators.bb.squeeze}
ATR%: ${indicators.atr_pct}% | Volume Ratio: ${indicators.volume_ratio}x avg
Last 5 Closes: ${indicators.last_5_closes.join(' > ')}

HIGHER TIMEFRAME (20min): ${htfTrend}

${newsCtx}

${tradeCtx}

Respond with ONLY this JSON, no other text:
{"action":"long|short|wait","confidence":0-100,"reasoning":"2-3 sentences explaining your decision","key_factor":"single most decisive reason","risk_level":"low|medium|high","market_regime":"trending_up|trending_down|ranging|volatile|quiet","warnings":["any risk or concern"]}`;

  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 400,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an expert cryptocurrency scalp trader. Respond with ONLY valid JSON. No markdown, no explanation, no extra text.' },
      { role: 'user', content: prompt },
    ],
  });

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
    body,
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || 'Groq API error');
  const text = data.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(text) as GroqDecision;
}

// ─── Bot State (in-memory singleton) ────────────────────────────────────────

let config: BotConfig = { ...DEFAULT_CONFIG };
let status: BotStatus = 'offline';
let paused = false;
let scanCount = 0;
let nextScanIn = 0;
let openTrades: Record<string, OpenTrade> = {};
let tradeLog: TradeLogEntry[] = [];
let aiDecisions: Record<string, AIDecision> = {};
let stats: BotStats = { pnl: 0, trades: 0, wins: 0 };
let newsHeadlines: string[] = [];
let tickers: Record<string, { last: number; chg: number; vol: number } | null> = {};
let lastScanTime: string | null = null;

let scanTimer: ReturnType<typeof setInterval> | null = null;
let tickerTimer: ReturnType<typeof setInterval> | null = null;
let newsTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getPairs(cfg: BotConfig) {
  const p = cfg.p || {} as BotConfig['p'];
  const r: { sym: string; mkt: string; cat: string }[] = [];
  if (p.bs !== false) r.push({ sym: 'BTCUSDT', mkt: 'spot', cat: 'spot' });
  if (p.es !== false) r.push({ sym: 'ETHUSDT', mkt: 'spot', cat: 'spot' });
  if (p.bf !== false) r.push({ sym: 'BTCUSDT', mkt: 'futures', cat: 'linear' });
  if (p.ef !== false) r.push({ sym: 'ETHUSDT', mkt: 'futures', cat: 'linear' });
  return r;
}

function closeTrade(key: string, ep: number, pnl: number, reason: string) {
  const t = openTrades[key];
  if (!t) return;
  delete openTrades[key];
  const win = pnl > 0;
  stats = { pnl: stats.pnl + pnl, trades: stats.trades + 1, wins: stats.wins + (win ? 1 : 0) };
  const logEntry: TradeLogEntry = {
    time: new Date().toLocaleTimeString(),
    sym: t.sym, mkt: t.mkt, side: t.side,
    entry: t.entry, exit: ep, pnl: pnl.toFixed(3),
    reason, conf: t.conf, reasoning: t.reasoning || '',
  };
  tradeLog = [logEntry, ...tradeLog].slice(0, 200);
  const tgMsg = (pnl > 0 ? '✅' : '❌') + ` <b>Trade Closed [${reason}]</b>\n${t.sym} ${t.side.toUpperCase()} [${t.mkt}]\nEntry: ${t.entry} → Exit: ${ep}\nP&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)} USDT`;
  tgSend(config.tgt, config.tgc, tgMsg);
}

async function syncPositions() {
  const base = getBase(config.testnet);
  if (config.paper) {
    for (const k of Object.keys(openTrades)) {
      const t = openTrades[k];
      try {
        const tk = await fetchTicker(base, t.sym, t.cat === 'linear' ? 'linear' : 'spot');
        if (!tk) continue;
        const price = tk.last;
        const isLong = t.side === 'long';
        if (isLong && price >= t.tp) closeTrade(k, t.tp, (t.tp - t.entry) * t.qty, 'Paper TP hit ✅');
        else if (isLong && price <= t.sl) closeTrade(k, t.sl, (t.sl - t.entry) * t.qty, 'Paper SL hit ❌');
        else if (!isLong && price <= t.tp) closeTrade(k, t.tp, (t.entry - t.tp) * t.qty, 'Paper TP hit ✅');
        else if (!isLong && price >= t.sl) closeTrade(k, t.sl, (t.entry - t.sl) * t.qty, 'Paper SL hit ❌');
      } catch { /* silent */ }
    }
    return;
  }
  // Live mode
  try {
    const resp = await fetchPositions(base, config.key, config.secret);
    const active = new Set<string>((resp.result?.list || []).filter((p: any) => +p.size > 0).map((p: any) => p.symbol));
    for (const k of Object.keys(openTrades)) {
      const t = openTrades[k];
      if (t.mkt === 'futures' && !active.has(t.sym)) {
        try {
          const tk = await fetchTicker(base, t.sym, 'linear');
          const ep = tk?.last || t.entry;
          const pnl = (t.side === 'long' ? 1 : -1) * (ep - t.entry) * t.qty;
          closeTrade(k, ep, pnl, 'TP/SL hit');
        } catch { /* silent */ }
      }
    }
  } catch { /* silent */ }
}

async function openPosition(sym: string, mkt: string, cat: string, decision: GroqDecision, price: number) {
  const key = mkt + '_' + sym;
  const side = decision.action === 'long' ? 'Buy' : 'Sell';
  const rm = decision.confidence >= 85 ? 1.5 : decision.confidence >= 75 ? 1.2 : 1.0;
  const usdt = (config.sz || 20) * rm;
  const lev = mkt === 'futures' ? (config.lv || 5) : 1;
  const qty = parseFloat(((usdt * lev) / price).toFixed(6));
  const tp = decision.action === 'long'
    ? +(price * (1 + (config.tp || 0.5) / 100)).toFixed(4)
    : +(price * (1 - (config.tp || 0.5) / 100)).toFixed(4);
  const sl = decision.action === 'long'
    ? +(price * (1 - (config.sl || 0.25) / 100)).toFixed(4)
    : +(price * (1 + (config.sl || 0.25) / 100)).toFixed(4);

  if (config.paper) {
    const trade: OpenTrade = { sym, mkt, cat, side: decision.action as 'long' | 'short', entry: price, qty, tp, sl, time: Date.now(), conf: decision.confidence, reasoning: decision.reasoning, key_factor: decision.key_factor, regime: decision.market_regime, paper: true };
    openTrades[key] = trade;
    tgSend(config.tgt, config.tgc, `📄 <b>Paper Trade Opened</b>\n\n<b>${sym}</b> [${mkt.toUpperCase()}] ${decision.action.toUpperCase()}\nEntry: ${price} | TP: ${tp} | SL: ${sl}\nConfidence: ${decision.confidence}%\n\n🧠 <b>Groq AI Reasoning:</b>\n${decision.reasoning}\n\n💡 ${decision.key_factor}\n\n<i>This is a simulated paper trade — no real money used.</i>`);
    return;
  }

  const base = getBase(config.testnet);
  const body: any = { category: cat, symbol: sym, side, orderType: 'Market', qty: '' + qty };
  if (cat === 'linear') { body.takeProfit = '' + tp; body.stopLoss = '' + sl; body.tpslMode = 'Full'; }
  try {
    const resp = await placeOrder(base, config.key, config.secret, body);
    if (resp.retCode !== 0) return;
    const trade: OpenTrade = { sym, mkt, cat, side: decision.action as 'long' | 'short', entry: price, qty, tp, sl, time: Date.now(), conf: decision.confidence, reasoning: decision.reasoning, key_factor: decision.key_factor, regime: decision.market_regime };
    openTrades[key] = trade;
    tgSend(config.tgt, config.tgc, `${decision.action === 'long' ? '🟢' : '🔴'} <b>AI Trade Opened</b>\n\n<b>${sym}</b> [${mkt.toUpperCase()}] ${decision.action.toUpperCase()}\nEntry: ${price} | TP: ${tp} | SL: ${sl}\nConfidence: ${decision.confidence}%\n\n🧠 <b>Groq AI Reasoning:</b>\n${decision.reasoning}\n\n💡 ${decision.key_factor}`);
  } catch { /* silent */ }
}

// ─── Core scan loop ─────────────────────────────────────────────────────────

async function doScan() {
  if (paused || status === 'offline') return;
  scanCount++;
  status = 'thinking';
  const base = getBase(config.testnet);
  try { await syncPositions(); } catch { /* silent */ }
  const pairs = getPairs(config);
  for (const { sym, mkt, cat } of pairs) {
    const key = mkt + '_' + sym;
    if (openTrades[key]) continue;
    if (Object.keys(openTrades).length >= (config.mx || 2)) break;
    try {
      aiDecisions[key] = { sym, mkt, thinking: true };
      const [c, hc] = await Promise.all([
        fetchKlines(base, sym, cat, '5', 80),
        fetchKlines(base, sym, cat, '20', 40),
      ]);
      const inds = buildIndicators(c);
      const tk = await fetchTicker(base, sym, cat);
      if (!tk) continue;
      const hcl = hc.map((x: Candle) => x.c);
      const he21 = emaArr(hcl, 21), he50 = emaArr(hcl, 50);
      const htfDir = he21[he21.length - 1] > he50[he50.length - 1] ? 'UPTREND (EMA21>EMA50)' : 'DOWNTREND (EMA21<EMA50)';
      const htfRSI = calcRSI(hcl, 14).toFixed(1);
      const recentTrades = tradeLog.slice(0, 5);
      const decision = await askGroq(config.groq, sym, mkt, inds, `${htfDir} | RSI: ${htfRSI}`, tk, newsHeadlines, recentTrades);
      aiDecisions[key] = { ...decision, sym, mkt, thinking: false, time: new Date().toLocaleTimeString(), price: tk.last };
      const minConf = config.mc || 65;
      if (decision.action !== 'wait' && decision.confidence >= minConf) {
        if (mkt === 'spot' && decision.action === 'short') continue;
        await openPosition(sym, mkt, cat, decision, tk.last);
      }
    } catch (e: any) {
      aiDecisions[key] = { thinking: false, sym, mkt, action: 'wait', confidence: 0, reasoning: 'Error: ' + (e.message || 'unknown'), key_factor: 'API error', risk_level: 'high', market_regime: 'volatile', warnings: [e.message || 'unknown'], time: new Date().toLocaleTimeString() };
    }
  }
  status = 'running';
  lastScanTime = new Date().toISOString();
}

async function refreshTickers() {
  const base = getBase(config.testnet);
  const pairs = [
    { s: 'BTCUSDT', c: 'spot', key: 'spot_BTC' },
    { s: 'ETHUSDT', c: 'spot', key: 'spot_ETH' },
    { s: 'BTCUSDT', c: 'linear', key: 'linear_BTC' },
    { s: 'ETHUSDT', c: 'linear', key: 'linear_ETH' },
  ];
  for (const p of pairs) {
    try {
      const tk = await fetchTicker(base, p.s, p.c);
      tickers[p.key] = tk;
    } catch { /* silent */ }
  }
}

async function fetchNews() {
  try {
    const r = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH&limit=5');
    const d = await r.json();
    newsHeadlines = (d.Data || []).slice(0, 5).map((n: any) => n.title);
  } catch {
    newsHeadlines = ['Unable to fetch news — AI will use price data only'];
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function botGetSnapshot(): BotSnapshot {
  // Strip sensitive keys from config before sending to client
  const { groq: _g, key: _k, secret: _s, ...safeConfig } = config;
  return {
    config: safeConfig,
    status, paused, scanCount, nextScanIn,
    openTrades, tradeLog, aiDecisions, stats,
    newsHeadlines, tickers, lastScanTime,
  };
}

export function botGetConfig(): BotConfig {
  return { ...config };
}

export function botSetConfig(newConfig: BotConfig) {
  config = { ...newConfig };
  console.log('[BotEngine] Config updated');
}

export function botStart(): { error: string | null } {
  if (!config.groq) return { error: 'Add Groq API key in Settings' };
  if (!config.paper && !config.key) return { error: 'Add Bybit API keys in Settings' };
  if (status !== 'offline') return { error: null }; // already running

  status = 'running';
  paused = false;
  console.log('[BotEngine] Starting bot...');
  tgSend(config.tgt, config.tgc, `🤖 <b>ByteBot AI Started (Server-Side 24/7)</b>\nMode: ${config.paper ? '📄 PAPER TRADING (simulated)' : config.testnet ? 'TESTNET 🔵' : 'LIVE 🔴'}\nBrain: Groq llama-3.3-70b (FREE)\nMin confidence: ${config.mc || 65}%\n\nThe bot runs on the server — you can close the app. 🚀`);

  // Initial scan + ticker + news
  doScan();
  refreshTickers();
  fetchNews();

  // 45-second scan cycle
  nextScanIn = 45;
  countdownTimer = setInterval(() => {
    if (status === 'offline') return;
    nextScanIn--;
    if (nextScanIn <= 0) {
      doScan();
      nextScanIn = 45;
    }
  }, 1000);

  // Ticker refresh every 10s
  tickerTimer = setInterval(refreshTickers, 10000);

  // News refresh every 5 min
  newsTimer = setInterval(fetchNews, 300000);

  return { error: null };
}

export function botStop() {
  status = 'offline';
  nextScanIn = 0;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
  if (newsTimer) { clearInterval(newsTimer); newsTimer = null; }
  console.log('[BotEngine] Bot stopped');
  tgSend(config.tgt, config.tgc, '⏹ <b>ByteBot AI Stopped</b>');
}

export function botPause(p: boolean) {
  paused = p;
  if (p) tgSend(config.tgt, config.tgc, '⏸ <b>ByteBot AI Paused</b>');
  else tgSend(config.tgt, config.tgc, '▶️ <b>ByteBot AI Resumed</b>');
}

export function botClearLog() {
  tradeLog = [];
  stats = { pnl: 0, trades: 0, wins: 0 };
}

export function botResetAll() {
  botStop();
  config = { ...DEFAULT_CONFIG };
  openTrades = {};
  tradeLog = [];
  aiDecisions = {};
  stats = { pnl: 0, trades: 0, wins: 0 };
  newsHeadlines = [];
  tickers = {};
  lastScanTime = null;
  scanCount = 0;
}

export async function botTestTelegram(token: string, chatId: string): Promise<boolean> {
  return tgTest(token, chatId);
}
