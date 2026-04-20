// ─── Server-Side Bot Engine ──────────────────────────────────────────────────
// Runs the 30-second scan loop in the Node.js server process (24/7).
// All state is kept in memory; the mobile app polls via tRPC.
// Includes Telegram command handler so Groq AI responds to user messages.

import type {
  BotConfig, BotStatus, BotStats, OpenTrade, TradeLogEntry,
  AIDecision, BotSnapshot, StrategyNote, TradeLearning, StrategyState,
} from "../shared/bot-types";
import { DEFAULT_CONFIG } from "../shared/bot-types";

// ─── Risk Presets ──────────────────────────────────────────────────────────────

const PRESETS: Record<string, { sz: number; lv: number; tp: number; sl: number }> = {
  low: { sz: 10, lv: 3, tp: 0.3, sl: 0.15 },
  med: { sz: 20, lv: 5, tp: 0.5, sl: 0.25 },
  high: { sz: 50, lv: 10, tp: 0.8, sl: 0.4 },
};

// ─── Indicator calculations ────────────────────────────────────────────────────

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

// OKX public price feed (Bybit/Binance are geo-blocked from Replit servers)
function toOkxSymbol(sym: string, cat: string): string {
  const m = sym.match(/^([A-Z0-9]+?)(USDT|USDC|BTC|ETH)$/);
  const base = m ? m[1] : sym.replace(/USDT$/, '');
  const quote = m ? m[2] : 'USDT';
  const pair = `${base}-${quote}`;
  return cat === 'linear' || cat === 'inverse' ? `${pair}-SWAP` : pair;
}

function toOkxBar(interval: string): string {
  const map: Record<string, string> = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '20': '15m', '30': '30m', '60': '1H', '120': '2H', '240': '4H', '360': '6H', '720': '12H', 'D': '1D', 'W': '1W' };
  return map[interval] || (interval.match(/^\d+$/) ? interval + 'm' : interval);
}

async function fetchKlines(_base: string, sym: string, cat: string, interval = '5', limit = 80): Promise<Candle[]> {
  const instId = toOkxSymbol(sym, cat);
  const bar = toOkxBar(interval);
  const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`);
  if (!r.ok) throw new Error(`OKX candles HTTP ${r.status}`);
  const d = await r.json();
  if (d.code !== '0') throw new Error(`OKX candles: ${d.msg || 'error'}`);
  // OKX returns newest first; reverse to oldest first like Bybit. Format: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
  return ((d.data || []) as string[][]).slice().reverse().map(row => ({ o: +row[1], h: +row[2], l: +row[3], c: +row[4], v: +row[5] }));
}

async function fetchTicker(_base: string, sym: string, cat: string): Promise<{ last: number; chg: number; vol: number } | null> {
  const instId = toOkxSymbol(sym, cat);
  const r = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`);
  if (!r.ok) return null;
  const d = await r.json();
  if (d.code !== '0' || !d.data?.[0]) return null;
  const t = d.data[0];
  const open24 = +t.open24h, last = +t.last;
  const chg = open24 ? (last - open24) / open24 : 0;
  return { last, chg, vol: +t.vol24h };
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

async function callGroq(groqKey: string, body: string): Promise<any> {
  if (!groqKey || !groqKey.trim()) {
    throw new Error('Groq API key missing — add it in Settings');
  }
  let r: Response;
  try {
    r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey.trim() },
      body,
    });
  } catch (e: any) {
    throw new Error('Network error reaching Groq: ' + (e.message || 'unknown'));
  }
  const raw = await r.text();
  const ct = r.headers.get('content-type') || '';
  if (!r.ok) {
    if (r.status === 401) throw new Error('Groq API key invalid (401). Generate a new key at console.groq.com/keys and update Settings.');
    if (r.status === 403) throw new Error('Groq API forbidden (403). Check key permissions or region.');
    if (r.status === 429) throw new Error('Groq rate limit hit (429). Bot will retry next scan.');
    if (r.status >= 500) throw new Error('Groq server error (' + r.status + '). Will retry next scan.');
    const snippet = raw.slice(0, 120).replace(/\s+/g, ' ');
    throw new Error('Groq HTTP ' + r.status + ': ' + snippet);
  }
  if (!ct.includes('application/json')) {
    throw new Error('Groq returned non-JSON response — likely key invalid or service blocked. Try regenerating key at console.groq.com/keys');
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Groq returned malformed JSON');
  }
  if (data.error) throw new Error('Groq: ' + (data.error.message || 'unknown error'));
  return data;
}


interface GroqDecision {
  action: 'long' | 'short' | 'wait';
  confidence: number;
  reasoning: string;
  key_factor: string;
  risk_level: string;
  market_regime: string;
  warnings: string[];
}

// ─── Label helpers: add human-readable context to numeric indicators ─────────
function rsiLabel(v: number): string {
  if (v >= 75) return 'EXTREME OVERBOUGHT — reversal risk';
  if (v >= 70) return 'OVERBOUGHT — caution for longs';
  if (v >= 60) return 'BULLISH momentum — room to run';
  if (v >= 45) return 'NEUTRAL';
  if (v >= 30) return 'BEARISH momentum';
  if (v >= 25) return 'OVERSOLD — bounce possible';
  return 'EXTREME OVERSOLD — reversal possible';
}
function macdLabel(h: number, sig: string): string {
  if (h > 0 && sig === 'bullish') return 'POSITIVE & RISING — bullish momentum building';
  if (h > 0) return 'POSITIVE — bullish but slowing';
  if (h < 0 && sig === 'bearish') return 'NEGATIVE & FALLING — bearish momentum building';
  if (h < 0) return 'NEGATIVE — bearish but slowing';
  return 'FLAT — no momentum';
}
function adxLabel(v: number): string {
  if (v >= 40) return 'VERY STRONG TREND';
  if (v >= 25) return 'STRONG TREND — tradeable';
  if (v >= 20) return 'DEVELOPING TREND';
  return 'WEAK / RANGING — chop risk';
}
function bbLabel(pct: number, squeeze: string): string {
  let pos = 'MIDDLE';
  if (pct >= 90) pos = 'AT UPPER BAND — extension risk';
  else if (pct >= 70) pos = 'NEAR UPPER BAND';
  else if (pct <= 10) pos = 'AT LOWER BAND — bounce zone';
  else if (pct <= 30) pos = 'NEAR LOWER BAND';
  return squeeze === 'true' || squeeze === 'yes' ? `${pos} | SQUEEZE — breakout pending` : pos;
}
function volLabel(r: number): string {
  if (r >= 2) return 'HIGH PARTICIPATION — strong move';
  if (r >= 1.3) return 'ABOVE AVERAGE';
  if (r >= 0.7) return 'NORMAL';
  return 'LOW VOLUME — weak conviction';
}
function atrLabel(p: number): string {
  if (p >= 4) return 'EXTREME VOLATILITY';
  if (p >= 2) return 'HIGH VOLATILITY';
  if (p >= 0.8) return 'NORMAL';
  if (p >= 0.3) return 'LOW VOLATILITY';
  return 'DEAD MARKET — no edge';
}

// Robust JSON extractor: handles markdown fences, leading/trailing text, etc.
function safeParseJSON<T = any>(text: string): T {
  let s = (text || '').trim().replace(/```json|```/gi, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in response');
  }
  return JSON.parse(s.substring(start, end + 1));
}

async function askGroq(groqKey: string, sym: string, mkt: string, indicators: Indicators, htfTrend: string, ticker: { last: number; chg: number; vol: number }, headlines: string[], recentTrades: TradeLogEntry[]): Promise<GroqDecision> {
  const newsCtx = headlines.length ? 'RECENT CRYPTO NEWS (factor these into your analysis — bullish news supports longs, bearish news supports shorts or wait):\n' + headlines.slice(0, 6).map((h, i) => `${i + 1}. ${h}`).join('\n') : 'No news available.';
  const tradeCtx = recentTrades.length ? 'RECENT TRADE HISTORY (learn from these — avoid repeating losing patterns):\n' + recentTrades.slice(0, 5).map(t => `- ${t.side.toUpperCase()} ${t.sym} [${t.mkt}]: P&L ${+t.pnl >= 0 ? '+' : ''}${t.pnl} USDT (${t.reason})`).join('\n') : 'No recent trades yet.';

  const stratCtx = getStrategyContext();
  const rsiV = +indicators.rsi.value;
  const macdH = +indicators.macd.h;
  const adxV = +indicators.adx.adx;
  const bbPct = +indicators.bb.pos_pct;
  const volR = +indicators.volume_ratio;
  const atrP = +indicators.atr_pct;

  const prompt = `You are an expert cryptocurrency scalping trader. Analyze ALL data below — technical indicators, higher timeframe trend, news sentiment, recent trade history, AND strategy notes — then return a trading decision as JSON only.

IMPORTANT RULES:
- You MUST follow USER STRATEGY INSTRUCTIONS if any are provided below. These are direct orders from the user.
- You MUST consider AI SELF-LEARNED NOTES and TRADE PATTERN ANALYSIS to avoid repeating mistakes.
- You MUST consider the NEWS section. Bullish news (ETF approvals, institutional buying, regulatory clarity) supports LONG. Bearish news (hacks, bans, crashes) supports SHORT or WAIT.
- You MUST consider the HIGHER TIMEFRAME trend. Do NOT go against the HTF trend unless you have very strong reasons.
- If you see recent losing trades, analyze WHY they lost and avoid the same pattern.
- Only recommend "long" or "short" if confidence >= 65. Otherwise say "wait".
- For spot market, you can ONLY recommend "long" or "wait" (no shorting spot).

INTERNAL REASONING PROCESS (think through these silently before producing JSON — do NOT include this thinking in your output):
1. What is the higher timeframe trend saying? (Aligns or conflicts with my entry?)
2. Do the indicators agree with each other? (EMA + MACD + RSI same direction?)
3. Does news sentiment support or contradict the technical setup?
4. What did recent losing trades have in common? Am I about to repeat that pattern?
5. Is volatility (ATR%) appropriate — not too dead, not too wild?
6. Final confidence: how many independent factors agree? (3+ aligned = high conf)

${stratCtx}

SYMBOL: ${sym} | MARKET: ${mkt.toUpperCase()} | TIMEFRAME: 5min
PRICE: ${ticker.last} | 24H CHANGE: ${(ticker.chg * 100).toFixed(2)}% | VOLUME: ${(ticker.vol / 1e6).toFixed(1)}M USDT

TECHNICAL INDICATORS (with context labels):
EMA Stack: ${indicators.ema.status.toUpperCase()}
  EMA-9: ${indicators.ema.e9} | EMA-21: ${indicators.ema.e21} | EMA-50: ${indicators.ema.e50}
RSI(14): ${rsiV.toFixed(1)} [${rsiLabel(rsiV)}]
MACD Histogram: ${macdH > 0 ? '+' : ''}${macdH} [${macdLabel(macdH, indicators.macd.sig)}]
ADX: ${adxV.toFixed(1)} [${adxLabel(adxV)}] | +DI: ${indicators.adx.dp} | -DI: ${indicators.adx.dn}
Bollinger: Position ${bbPct.toFixed(0)}% [${bbLabel(bbPct, String(indicators.bb.squeeze))}] | BW: ${indicators.bb.bw}%
ATR%: ${atrP.toFixed(2)}% [${atrLabel(atrP)}]
Volume Ratio: ${volR.toFixed(2)}x [${volLabel(volR)}]
Last 5 Closes: ${indicators.last_5_closes.join(' > ')}

HIGHER TIMEFRAME (20min): ${htfTrend}

${newsCtx}

${tradeCtx}

Respond with ONLY this JSON object — no markdown, no backticks, no explanation outside JSON. Start with { and end with }:
{"action":"long|short|wait","confidence":0-100,"reasoning":"2-3 sentences explaining decision including how news + HTF affected it","key_factor":"single most decisive reason","risk_level":"low|medium|high","market_regime":"trending_up|trending_down|ranging|volatile|quiet","warnings":["any risk or concern"]}`;

  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 400,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a crypto trading analyst. Output ONLY a single valid JSON object. No markdown. No backticks. No explanation outside JSON. Start with { and end with }. Think through your reasoning internally but never expose chain-of-thought in the response.' },
      { role: 'user', content: prompt },
    ],
  });

  const data = await callGroq(groqKey, body);
  const rawContent = data?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('Groq returned empty response');
  }
  try {
    return safeParseJSON<GroqDecision>(rawContent);
  } catch (e: any) {
    const snippet = rawContent.slice(0, 100).replace(/\s+/g, ' ');
    throw new Error('Groq returned invalid JSON content: ' + snippet + ' (' + (e.message || 'parse error') + ')');
  }
}

// ─── Groq AI: Answer any question (for Telegram /ask command & free chat) ────

function buildBotContextForChat(): string {
  const wr = stats.trades ? ((stats.wins / stats.trades) * 100).toFixed(0) + '%' : 'no trades yet';
  const posKeys = Object.keys(openTrades);
  const positionsCtx = posKeys.length
    ? posKeys.map(k => {
        const t = openTrades[k];
        return `  - ${t.sym} [${t.mkt}] ${t.side.toUpperCase()} | Entry: ${t.entry} | TP: ${t.tp} | SL: ${t.sl} | Confidence: ${t.conf}%`;
      }).join('\n')
    : '  None';
  const recentTradesCtx = tradeLog.length
    ? tradeLog.slice(0, 5).map(t => `  - ${t.sym} ${t.side.toUpperCase()} → ${+t.pnl >= 0 ? '+' : ''}${t.pnl} USDT (${t.reason})`).join('\n')
    : '  None yet';
  const newsCtx = newsHeadlines.length
    ? newsHeadlines.slice(0, 5).map((h, i) => `  ${i + 1}. ${h}`).join('\n')
    : '  No news fetched yet';
  const aiCtx = Object.keys(aiDecisions).length
    ? Object.keys(aiDecisions).map(k => {
        const d = aiDecisions[k];
        if (d.thinking) return `  - ${d.sym} [${d.mkt}]: ANALYZING...`;
        return `  - ${d.sym} [${d.mkt}]: ${(d as any).action?.toUpperCase() || 'WAIT'} (${(d as any).confidence || 0}%) — ${((d as any).reasoning || '').slice(0, 80)}`;
      }).join('\n')
    : '  No analysis yet — bot may not have started scanning';

  return `YOUR CURRENT STATE (this is real-time data — use it to answer the user):

Bot Status: ${status !== 'offline' ? (paused ? 'PAUSED' : 'RUNNING') : 'STOPPED'}
Mode: ${config.paper ? 'PAPER TRADING (simulated, no real money)' : config.testnet ? 'TESTNET' : 'LIVE TRADING (real money!)'}
Total Scans: ${scanCount}
P&L: ${stats.pnl >= 0 ? '+' : ''}${stats.pnl.toFixed(3)} USDT
Trades: ${stats.trades} | Win Rate: ${wr}
Settings: Size ${config.sz} USDT | Leverage ${config.lv}× | TP ${config.tp}% | SL ${config.sl}% | Min Confidence ${config.mc || 65}%
Max Open Positions: ${config.mx || 2}

OPEN POSITIONS:
${positionsCtx}

LATEST AI DECISIONS:
${aiCtx}

RECENT TRADE HISTORY:
${recentTradesCtx}

CRYPTO NEWS (you are reading these):
${newsCtx}`;
}

async function askGroqQuestion(groqKey: string, question: string): Promise<string> {
  try {
    const botContext = buildBotContextForChat();
    const stratCtx = getStrategyContext();
    const systemPrompt = `You are ByteBot AI — an autonomous crypto trading bot that is ACTIVELY running on the user's server 24/7. You are NOT a generic assistant. You ARE the bot.

IMPORTANT IDENTITY RULES:
- You scan crypto markets every 30 seconds using technical indicators (EMA, RSI, MACD, ADX, Bollinger Bands) and Groq AI analysis.
- You open and close trades automatically based on your analysis. You set TP/SL targets and monitor them.
- You read crypto news and factor it into every trading decision.
- You LEARN from past trades and adapt your strategy over time.
- You accept strategy changes from the user via natural language. When the user tells you to change strategy, you remember it and apply it to future trades.
- When the user asks "how are you doing" or "what's your status" — report YOUR actual state from the data below.
- When the user asks about positions, trades, P&L — answer from YOUR real data below.
- When the user asks about your capabilities or limitations — you CAN trade, you CAN scan markets, you CAN open/close positions. You are connected to Bybit exchange. You CAN learn and adapt.
- When the user tells you to change strategy (e.g. "be more aggressive", "avoid shorting ETH", "only trade BTC"), confirm you understood and tell them to use /strategy <instruction> to make it permanent.
- Be conversational, confident, and helpful. You are the user's AI trading partner.
- Keep responses under 200 words. Be specific with numbers from your state data.

${botContext}

${stratCtx ? 'YOUR CURRENT STRATEGY MEMORY:\n' + stratCtx : 'No strategy notes yet. The user can tell you to change strategy and you will remember.'}`;

    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
    });
    const data = await callGroq(groqKey, body);
    return data.choices[0].message.content.trim();
  } catch (e: any) {
    return '⚠️ ' + (e.message || 'unknown error');
  }
}

// ─── Bot State (in-memory singleton, persisted to DB) ───────────────────────

import { loadBotState, saveBotState } from './db';

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

// ─── Strategy Memory & Learning State ─────────────────────────────────────
let strategyNotes: StrategyNote[] = [];
let tradeLearnings: TradeLearning[] = [];
let lastAnalysisTime: string | null = null;
let totalAnalyses = 0;
let analysisTimer: ReturnType<typeof setInterval> | null = null;

let scanTimer: ReturnType<typeof setInterval> | null = null;
let tickerTimer: ReturnType<typeof setInterval> | null = null;
let newsTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let tgPollTimer: ReturnType<typeof setInterval> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let tgOffset = 0;

// ─── Persistence ────────────────────────────────────────────────────────────

function buildPersistedState() {
  return {
    config, status, paused, scanCount,
    openTrades, tradeLog, aiDecisions, stats,
    lastScanTime,
    strategyNotes, tradeLearnings, lastAnalysisTime, totalAnalyses,
  };
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      await saveBotState(JSON.stringify(buildPersistedState()));
    } catch (e) {
      console.warn('[BotEngine] Persist failed:', e);
    }
  }, 2000);
}

export async function botRestoreFromDb(): Promise<void> {
  try {
    const json = await loadBotState();
    if (!json) {
      console.log('[BotEngine] No saved state found, starting fresh');
      return;
    }
    const s = JSON.parse(json);
    if (s.config) config = { ...DEFAULT_CONFIG, ...s.config };
    if (s.openTrades) openTrades = s.openTrades;
    if (s.tradeLog) tradeLog = s.tradeLog;
    if (s.aiDecisions) aiDecisions = s.aiDecisions;
    if (s.stats) stats = s.stats;
    if (s.lastScanTime) lastScanTime = s.lastScanTime;
    if (s.strategyNotes) strategyNotes = s.strategyNotes;
    if (s.tradeLearnings) tradeLearnings = s.tradeLearnings;
    if (s.lastAnalysisTime) lastAnalysisTime = s.lastAnalysisTime;
    if (typeof s.totalAnalyses === 'number') totalAnalyses = s.totalAnalyses;
    if (typeof s.scanCount === 'number') scanCount = s.scanCount;
    if (typeof s.paused === 'boolean') paused = s.paused;
    console.log(`[BotEngine] Restored state from DB (last status: ${s.status}, scans: ${scanCount}, trades: ${stats.trades})`);

    // Auto-resume if bot was running before restart
    if (s.status && s.status !== 'offline') {
      console.log('[BotEngine] Auto-resuming bot (was running before restart)');
      const result = botStart();
      if (result.error) console.warn('[BotEngine] Auto-resume failed:', result.error);
    }
  } catch (e) {
    console.warn('[BotEngine] Failed to restore state:', e);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Migrate legacy pair config { bs, es, bf, ef } → new shape { BTC: {s,f}, ETH: {s,f}, ... }
function migratePairs(p: any): Record<string, { s?: boolean; f?: boolean }> {
  if (!p || typeof p !== 'object') return { BTC: { s: true, f: true }, ETH: { s: true, f: true } };
  // Already in new shape if any value is an object
  const firstVal = Object.values(p)[0];
  if (firstVal && typeof firstVal === 'object') return p as Record<string, { s?: boolean; f?: boolean }>;
  // Legacy: bs/es/bf/ef → new
  return {
    BTC: { s: p.bs !== false, f: p.bf !== false },
    ETH: { s: p.es !== false, f: p.ef !== false },
  };
}

function getPairs(cfg: BotConfig) {
  const p = migratePairs(cfg.p);
  const r: { sym: string; mkt: string; cat: string }[] = [];
  for (const [coin, toggles] of Object.entries(p)) {
    if (!toggles) continue;
    const sym = coin.toUpperCase() + 'USDT';
    if (toggles.s) r.push({ sym, mkt: 'spot', cat: 'spot' });
    if (toggles.f) r.push({ sym, mkt: 'futures', cat: 'linear' });
  }
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
  const tgMsg = (pnl > 0 ? '✅' : '❌') + ` <b>Trade Closed [${reason}]</b>\n${t.sym} ${t.side.toUpperCase()} [${t.mkt}]\nEntry: ${t.entry} → Exit: ${ep}\nP&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)} USDT\nTotal: ${stats.pnl >= 0 ? '+' : ''}${stats.pnl.toFixed(3)} USDT`;
  tgSend(config.tgt, config.tgc, tgMsg);

  // Auto-analyze after every 5 trades
  if (stats.trades > 0 && stats.trades % 5 === 0) {
    setTimeout(() => analyzeTradePerformance(), 5000);
  }
  schedulePersist();
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

        // Trailing stop loss logic — update peak + raise/lower SL as price moves favorably
        if (t.trail) {
          const dist = +(t.trailDist || 0.5);
          if (isLong) {
            if (price > (t.peak || t.entry)) t.peak = price;
            const newSL = +((t.peak || t.entry) * (1 - dist / 100)).toFixed(4);
            if (newSL > t.sl) t.sl = newSL;  // only raise, never lower
          } else {
            if (price < (t.peak || t.entry)) t.peak = price;
            const newSL = +((t.peak || t.entry) * (1 + dist / 100)).toFixed(4);
            if (newSL < t.sl) t.sl = newSL;  // only lower, never raise
          }
          // For trailing trades, ONLY exit on SL hit (TP is disabled)
          if (isLong && price <= t.sl) closeTrade(k, t.sl, (t.sl - t.entry) * t.qty, `Trailing SL hit ✅ (peak: ${t.peak})`);
          else if (!isLong && price >= t.sl) closeTrade(k, t.sl, (t.entry - t.sl) * t.qty, `Trailing SL hit ✅ (peak: ${t.peak})`);
        } else {
          // Fixed TP/SL behavior
          if (isLong && price >= t.tp) closeTrade(k, t.tp, (t.tp - t.entry) * t.qty, 'Paper TP hit ✅');
          else if (isLong && price <= t.sl) closeTrade(k, t.sl, (t.sl - t.entry) * t.qty, 'Paper SL hit ❌');
          else if (!isLong && price <= t.tp) closeTrade(k, t.tp, (t.entry - t.tp) * t.qty, 'Paper TP hit ✅');
          else if (!isLong && price >= t.sl) closeTrade(k, t.sl, (t.entry - t.sl) * t.qty, 'Paper SL hit ❌');
        }
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
  const trailOn = !!config.trail;
  // Validate trailDist: must be positive, clamp to reasonable range (0.05% - 20%)
  let trailDist = +(config.trailDist || 0.5);
  if (!isFinite(trailDist) || trailDist <= 0) trailDist = 0.5;
  if (trailDist > 20) trailDist = 20;

  // For trailing trades, initial SL uses trailDist (not fixed config.sl) so behavior matches UI
  const slPct = trailOn ? trailDist : (config.sl || 0.25);
  const sl = decision.action === 'long'
    ? +(price * (1 - slPct / 100)).toFixed(4)
    : +(price * (1 + slPct / 100)).toFixed(4);

  if (config.paper) {
    const trade: OpenTrade = { sym, mkt, cat, side: decision.action as 'long' | 'short', entry: price, qty, tp, sl, time: Date.now(), conf: decision.confidence, reasoning: decision.reasoning, key_factor: decision.key_factor, regime: decision.market_regime, paper: true, peak: price, trail: trailOn, trailDist };
    openTrades[key] = trade;
    const exitInfo = trailOn ? `Trailing SL: ${trailDist}% (TP disabled)` : `TP: ${tp} | SL: ${sl}`;
    tgSend(config.tgt, config.tgc, `📄 <b>Paper Trade Opened</b>\n\n<b>${sym}</b> [${mkt.toUpperCase()}] ${decision.action.toUpperCase()}\nEntry: ${price} | ${exitInfo}\nSize: ${usdt.toFixed(0)} USDT | Lev: ${lev}×\nConfidence: ${decision.confidence}%\n\n🧠 <b>Groq AI Reasoning:</b>\n${decision.reasoning}\n\n💡 ${decision.key_factor}\n\n<i>This is a simulated paper trade — no real money used.</i>`);
    return;
  }

  const base = getBase(config.testnet);
  const body: any = { category: cat, symbol: sym, side, orderType: 'Market', qty: '' + qty };
  if (cat === 'linear') { body.takeProfit = '' + tp; body.stopLoss = '' + sl; body.tpslMode = 'Full'; }
  try {
    const resp = await placeOrder(base, config.key, config.secret, body);
    if (resp.retCode !== 0) {
      console.log('[BotEngine] Order failed:', resp.retMsg);
      tgSend(config.tgt, config.tgc, `⚠️ <b>Order Failed</b>\n${sym} ${decision.action.toUpperCase()} [${mkt}]\nError: ${resp.retMsg || 'Unknown'}`);
      return;
    }
    const trade: OpenTrade = { sym, mkt, cat, side: decision.action as 'long' | 'short', entry: price, qty, tp, sl, time: Date.now(), conf: decision.confidence, reasoning: decision.reasoning, key_factor: decision.key_factor, regime: decision.market_regime };
    openTrades[key] = trade;
    tgSend(config.tgt, config.tgc, `${decision.action === 'long' ? '🟢' : '🔴'} <b>AI Trade Opened</b>\n\n<b>${sym}</b> [${mkt.toUpperCase()}] ${decision.action.toUpperCase()}\nEntry: ${price} | TP: ${tp} | SL: ${sl}\nSize: ${usdt.toFixed(0)} USDT | Lev: ${lev}×\nConfidence: ${decision.confidence}%\n\n🧠 <b>Groq AI Reasoning:</b>\n${decision.reasoning}\n\n💡 ${decision.key_factor}`);
  } catch (e: any) {
    tgSend(config.tgt, config.tgc, `⚠️ <b>Order Error</b>\n${sym} ${decision.action.toUpperCase()}\n${e.message || 'Network error'}`);
  }
}

// ─── Strategy Memory & Self-Learning ────────────────────────────────────────

function getStrategyContext(): string {
  const userNotes = strategyNotes.filter(n => n.type === 'user');
  const aiLearnings = strategyNotes.filter(n => n.type === 'learning');
  let ctx = '';
  if (userNotes.length) {
    ctx += 'USER STRATEGY INSTRUCTIONS (MUST follow these — the user explicitly told you):\n';
    ctx += userNotes.map((n, i) => `  ${i + 1}. ${n.text}`).join('\n');
    ctx += '\n\n';
  }
  if (aiLearnings.length) {
    ctx += 'AI SELF-LEARNED NOTES (patterns you discovered from past trades):\n';
    ctx += aiLearnings.map((n, i) => `  ${i + 1}. ${n.text}`).join('\n');
    ctx += '\n\n';
  }
  if (tradeLearnings.length) {
    ctx += 'TRADE PATTERN ANALYSIS:\n';
    ctx += tradeLearnings.map(l =>
      `  - ${l.pattern}: ${l.outcome} (${l.winRate.toFixed(0)}% win rate, ${l.sampleSize} trades) → ${l.recommendation}`
    ).join('\n');
    ctx += '\n\n';
  }
  return ctx;
}

function addNote(type: 'user' | 'learning', text: string, source: string): StrategyNote {
  const note: StrategyNote = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type, text, createdAt: new Date().toISOString(), source,
  };
  strategyNotes = [note, ...strategyNotes].slice(0, 50); // keep max 50 notes
  return note;
}

async function analyzeTradePerformance() {
  if (tradeLog.length < 3 || !config.groq) return; // need at least 3 trades
  totalAnalyses++;
  lastAnalysisTime = new Date().toISOString();

  const existingNotes = strategyNotes.map(n => n.text).join('; ');
  const tradesCtx = tradeLog.slice(0, 20).map(t =>
    `${t.sym} ${t.side.toUpperCase()} [${t.mkt}] conf:${t.conf}% pnl:${t.pnl} reason:${t.reason} reasoning:${(t.reasoning || '').slice(0, 100)}`
  ).join('\n');

  const prompt = `You are ByteBot AI's self-analysis module. Analyze the trade history below and identify patterns.

EXISTING STRATEGY NOTES: ${existingNotes || 'None yet'}

TRADE HISTORY (most recent first):
${tradesCtx}

OVERALL STATS: ${stats.trades} trades, ${stats.wins} wins, P&L: ${stats.pnl.toFixed(3)} USDT

Analyze and return JSON with:
1. "patterns" - array of {"pattern": "description", "outcome": "winning|losing", "win_rate": 0-100, "sample_size": number, "recommendation": "what to do"}
2. "new_learnings" - array of short strings (max 3) with NEW insights not already in existing notes
3. "strategy_adjustments" - array of short strings (max 2) suggesting parameter changes (e.g. "increase min confidence to 75%")

Respond with ONLY valid JSON. Be specific with symbols, timeframes, and market conditions.`;

  try {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 600,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a trade performance analyst. Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
    });
    const data = await callGroq(config.groq, body);
    const text = data.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(text);

    // Update trade learnings
    if (Array.isArray(result.patterns)) {
      tradeLearnings = result.patterns.slice(0, 10).map((p: any) => ({
        pattern: p.pattern || 'Unknown',
        outcome: p.outcome === 'winning' ? 'winning' : 'losing',
        winRate: +p.win_rate || 0,
        sampleSize: +p.sample_size || 0,
        insight: p.pattern || '',
        recommendation: p.recommendation || '',
        createdAt: new Date().toISOString(),
      } as TradeLearning));
    }

    // Add new AI-learned notes
    if (Array.isArray(result.new_learnings)) {
      for (const learning of result.new_learnings.slice(0, 3)) {
        if (typeof learning === 'string' && learning.length > 5) {
          addNote('learning', learning, 'auto-analysis');
        }
      }
    }

    // Notify via Telegram
    if (config.tgt && config.tgc) {
      let msg = '🧠 <b>Self-Analysis Complete</b>\n\n';
      if (tradeLearnings.length) {
        msg += '<b>Patterns Found:</b>\n';
        msg += tradeLearnings.slice(0, 3).map(l =>
          `${l.outcome === 'winning' ? '✅' : '❌'} ${l.pattern} (${l.winRate.toFixed(0)}% WR)\n→ ${l.recommendation}`
        ).join('\n');
      }
      if (Array.isArray(result.new_learnings) && result.new_learnings.length) {
        msg += '\n\n<b>New Learnings:</b>\n';
        msg += result.new_learnings.slice(0, 3).map((l: string) => '💡 ' + l).join('\n');
      }
      if (Array.isArray(result.strategy_adjustments) && result.strategy_adjustments.length) {
        msg += '\n\n<b>Suggested Adjustments:</b>\n';
        msg += result.strategy_adjustments.slice(0, 2).map((a: string) => '🔧 ' + a).join('\n');
      }
      tgSend(config.tgt, config.tgc, msg);
    }
  } catch { /* silent */ }
}

async function processStrategyCommand(groqKey: string, userMessage: string): Promise<string> {
  const currentNotes = strategyNotes.map(n => `[${n.type}] ${n.text}`).join('\n');
  const currentPairs = Object.entries(migratePairs(config.p)).map(([c, t]) => `${c}(spot=${t.s ? 'on' : 'off'}, futures=${t.f ? 'on' : 'off'})`).join(', ');
  const prompt = `You are ByteBot AI's strategy manager. The user wants to change the trading strategy.

CURRENT STRATEGY NOTES:
${currentNotes || 'No notes yet.'}

CURRENT SETTINGS: Size ${config.sz} USDT | Leverage ${config.lv}× | TP ${config.tp}% | SL ${config.sl}% | Min Confidence ${config.mc}% | Max Open Trades ${config.mx}
ACTIVE PAIRS: ${currentPairs}

SUPPORTED COINS: BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, MATIC

USER REQUEST: "${userMessage}"

Analyze the request and return JSON:
{
  "understood": true/false,
  "summary": "brief summary of what you understood",
  "new_notes": ["strategy note 1", "strategy note 2"],
  "param_changes": { "sz": null, "lv": null, "tp": null, "sl": null, "mc": null, "mx": null },
  "pair_changes": [ {"coin":"SOL","spot":true,"futures":false}, {"coin":"BTC","spot":false,"futures":false} ],
  "response": "conversational response confirming the changes (mention exact numeric values changed)"
}

Rules:
- new_notes: short, actionable strategy instructions (e.g. "Avoid shorting ETH in ranging markets")
- param_changes: numeric values if user wants to change them; null if not mentioned. mc=min confidence %, mx=max open trades, sz=USDT per trade, lv=leverage, tp=take profit %, sl=stop loss %
- pair_changes: array of coins to enable/disable. Use spot/futures booleans. Only include coins user mentioned. To disable a coin entirely use spot:false, futures:false.
- If user says "add SOL" → pair_changes: [{"coin":"SOL","spot":true,"futures":true}]. If "remove DOGE" → [{"coin":"DOGE","spot":false,"futures":false}].
- If unclear, set understood:false and ask in response.`;

  try {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a strategy manager. Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
    });
    const data = await callGroq(groqKey, body);
    const text = data.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(text);

    if (!result.understood) return result.response || 'I didn\'t understand that strategy change. Can you rephrase?';

    // Add new strategy notes
    if (Array.isArray(result.new_notes)) {
      for (const note of result.new_notes) {
        if (typeof note === 'string' && note.length > 3) {
          addNote('user', note, 'telegram');
        }
      }
    }

    // Apply parameter changes
    const changedParams: string[] = [];
    if (result.param_changes) {
      const pc = result.param_changes;
      if (pc.sz != null && +pc.sz >= 5) { config.sz = +pc.sz; changedParams.push(`size=${config.sz} USDT`); }
      if (pc.lv != null && +pc.lv >= 1 && +pc.lv <= 50) { config.lv = +pc.lv; changedParams.push(`leverage=${config.lv}×`); }
      if (pc.tp != null && +pc.tp > 0) { config.tp = +pc.tp; changedParams.push(`TP=${config.tp}%`); }
      if (pc.sl != null && +pc.sl > 0) { config.sl = +pc.sl; changedParams.push(`SL=${config.sl}%`); }
      if (pc.mc != null && +pc.mc >= 1 && +pc.mc <= 100) { config.mc = +pc.mc; changedParams.push(`min confidence=${config.mc}%`); }
      if (pc.mx != null && +pc.mx >= 1 && +pc.mx <= 10) { config.mx = +pc.mx; changedParams.push(`max trades=${config.mx}`); }
    }

    // Apply pair changes
    const changedPairs: string[] = [];
    if (Array.isArray(result.pair_changes) && result.pair_changes.length) {
      const pairs = migratePairs(config.p);
      const SUPPORTED = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'MATIC'];
      for (const pc of result.pair_changes) {
        const coin = String(pc.coin || '').toUpperCase();
        if (!SUPPORTED.includes(coin)) continue;
        pairs[coin] = { s: !!pc.spot, f: !!pc.futures };
        const status = !pc.spot && !pc.futures ? 'disabled' : `spot=${pc.spot ? 'on' : 'off'}, futures=${pc.futures ? 'on' : 'off'}`;
        changedPairs.push(`${coin} (${status})`);
      }
      config.p = pairs;
    }

    schedulePersist();

    let suffix = '';
    if (changedParams.length) suffix += '\n\n⚙️ Settings: ' + changedParams.join(', ');
    if (changedPairs.length) suffix += '\n📊 Pairs: ' + changedPairs.join(', ');
    if (Array.isArray(result.new_notes) && result.new_notes.length) suffix += '\n📝 Added ' + result.new_notes.length + ' note(s)';

    return (result.response || 'Strategy updated!') + suffix;
  } catch (e: any) {
    return 'Error processing strategy: ' + (e.message || 'unknown');
  }
}

// Public API: called from app via tRPC
export async function botApplyStrategy(instruction: string): Promise<{ response: string }> {
  if (!config.groq) return { response: '⚠️ Groq API key not set. Add it in Settings first.' };
  if (!instruction || !instruction.trim()) return { response: 'Please enter an instruction.' };
  const response = await processStrategyCommand(config.groq, instruction.trim());
  return { response };
}

// Exported for tRPC
export function botAddStrategyNote(text: string, source: string = 'app'): StrategyNote {
  return addNote('user', text, source);
}

export function botRemoveStrategyNote(id: string): boolean {
  const before = strategyNotes.length;
  strategyNotes = strategyNotes.filter(n => n.id !== id);
  return strategyNotes.length < before;
}

export function botGetStrategy(): StrategyState {
  return { notes: strategyNotes, learnings: tradeLearnings, lastAnalysisTime, totalAnalyses };
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
      // Volatility guard: skip extremes — no edge in dead or chaotic markets
      const atrP = +inds.atr_pct;
      if (atrP > 4.0) {
        aiDecisions[key] = { thinking: false, sym, mkt, action: 'wait', confidence: 0, reasoning: `Skipped — ATR ${atrP.toFixed(2)}% (extreme volatility, unpredictable)`, key_factor: 'volatility guard', risk_level: 'high', market_regime: 'volatile', warnings: ['ATR > 4%'], time: new Date().toLocaleTimeString(), price: tk.last };
        continue;
      }
      if (atrP < 0.05) {
        aiDecisions[key] = { thinking: false, sym, mkt, action: 'wait', confidence: 0, reasoning: `Skipped — ATR ${atrP.toFixed(2)}% (market dead, no edge)`, key_factor: 'volatility guard', risk_level: 'low', market_regime: 'quiet', warnings: ['ATR < 0.05%'], time: new Date().toLocaleTimeString(), price: tk.last };
        continue;
      }
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
  schedulePersist();
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
  const headlines: string[] = [];
  // Source 1: CryptoCompare
  try {
    const r = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH&limit=6');
    const d = await r.json();
    const items = (d.Data || []).slice(0, 6).map((n: any) => n.title);
    headlines.push(...items);
  } catch { /* silent */ }

  // Source 2: CoinGecko trending / status (free, no key)
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/search/trending');
    const d = await r.json();
    const coins = (d.coins || []).slice(0, 3).map((c: any) => `Trending: ${c.item?.name || 'Unknown'} (${c.item?.symbol || '?'}) — Market Cap Rank #${c.item?.market_cap_rank || '?'}`);
    headlines.push(...coins);
  } catch { /* silent */ }

  if (headlines.length > 0) {
    newsHeadlines = headlines.slice(0, 8);
  } else {
    newsHeadlines = ['Unable to fetch news — AI will use price data only'];
  }
}

// ─── Telegram Polling & Command Handler ─────────────────────────────────────

async function pollTelegram() {
  if (!config.tgt || !config.tgc) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${config.tgt}/getUpdates?offset=${tgOffset}&limit=10&timeout=0`);
    const d = await r.json();
    for (const u of (d.result || [])) {
      tgOffset = u.update_id + 1;
      const msg = u.message || {};
      if ('' + ((msg.chat || {}).id || '') !== config.tgc || !msg.text) continue;
      await handleTelegramCommand(msg.text.trim());
    }
  } catch (e) { /* silent */ }
}

async function handleTelegramCommand(text: string) {
  const pts = text.split(/\s+/);
  const cmd = pts[0].replace('/', '').replace(/@.*/, '').toLowerCase();
  const args = pts.slice(1);
  const wr = stats.trades ? ((stats.wins / stats.trades) * 100).toFixed(0) + '%' : '—';

  switch (cmd) {
    case 'start':
    case 'help':
      tgSend(config.tgt, config.tgc,
        '🤖 <b>ByteBot AI Commands</b>\n\n' +
        '<b>Info</b>\n/status · /positions · /trades · /balance\n/ask &lt;question&gt;\n\n' +
        '<b>Control</b>\n/startbot · /stopbot · /pause · /resume\n\n' +
        '<b>Strategy 🧠</b>\n/strategy &lt;instruction&gt; — teach me a new rule\n/insights — view learned patterns\n/notes — view all strategy notes\n/forget &lt;id&gt; — remove a note\n/analyze — trigger self-analysis now\n\n' +
        '<b>Settings</b>\n/size &lt;n&gt; · /tp &lt;%&gt; · /sl &lt;%&gt;\n/leverage &lt;n&gt; · /confidence &lt;%&gt;\n/risk low|med|high · /settings\n\n' +
        '<i>Or just type any message and I\'ll respond with full context!</i>');
      break;

    case 'status':
      tgSend(config.tgt, config.tgc,
        '📊 <b>Status</b>\n' +
        `State: ${status !== 'offline' ? (paused ? '⏸ PAUSED' : '🧠 RUNNING') : '⏹ STOPPED'}\n` +
        `Mode: ${config.paper ? '📄 PAPER' : config.testnet ? 'TESTNET 🔵' : '⚠️ LIVE 🔴'}\n` +
        `Scans: ${scanCount} | Open: ${Object.keys(openTrades).length}\n` +
        `P&L: ${stats.pnl >= 0 ? '+' : ''}${stats.pnl.toFixed(3)} USDT\n` +
        `Trades: ${stats.trades} | Win: ${wr}\n` +
        `Size: ${config.sz} USDT | Lev: ${config.lv}× | MinConf: ${config.mc || 65}%`);
      break;

    case 'positions': {
      const ks = Object.keys(openTrades);
      if (!ks.length) { tgSend(config.tgt, config.tgc, '📭 No open positions'); break; }
      tgSend(config.tgt, config.tgc,
        '📈 <b>Positions</b>\n' + ks.map(k => {
          const t = openTrades[k];
          return `\n<b>${t.sym}</b> [${t.mkt}] ${t.side === 'long' ? '🟢 LONG' : '🔴 SHORT'}\nEntry: ${t.entry} | TP: ${t.tp} | SL: ${t.sl}\nConf: ${t.conf}% | ${(t.reasoning || '').slice(0, 80)}...`;
        }).join(''));
      break;
    }

    case 'trades':
      if (!tradeLog.length) { tgSend(config.tgt, config.tgc, '📭 No trades yet'); break; }
      tgSend(config.tgt, config.tgc,
        '📋 <b>Last 5 Trades</b>\n' + tradeLog.slice(0, 5).map(t =>
          `${+t.pnl > 0 ? '✅' : '❌'} ${t.sym} ${t.side.toUpperCase()} → ${+t.pnl >= 0 ? '+' : ''}${t.pnl} USDT`
        ).join('\n'));
      break;

    case 'ask': {
      const q = args.join(' ');
      if (!q) { tgSend(config.tgt, config.tgc, 'Usage: /ask &lt;question&gt;'); break; }
      tgSend(config.tgt, config.tgc, '🧠 Asking Groq AI: "' + q + '"...');
      if (!config.groq) { tgSend(config.tgt, config.tgc, '⚠️ Groq API key not set. Add it in Settings.'); break; }
      const answer = await askGroqQuestion(config.groq, q);
      tgSend(config.tgt, config.tgc, '🧠 <b>Groq AI says:</b>\n\n' + answer);
      break;
    }

    case 'balance':
      if (!config.key || !config.secret) {
        tgSend(config.tgt, config.tgc, '⚠️ Bybit API keys not set');
        break;
      }
      try {
        const base = getBase(config.testnet);
        const d = await apiGet(base, config.key, config.secret, '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
        const coins = ((d.result?.list?.[0]?.coin || []) as any[]).filter((c: any) => +c.walletBalance > 0);
        tgSend(config.tgt, config.tgc,
          '💰 <b>Balance</b>\n' + (coins.length ? coins.map((c: any) => c.coin + ': ' + parseFloat(c.walletBalance).toFixed(4)).join('\n') : 'No balance found'));
      } catch {
        tgSend(config.tgt, config.tgc, '⚠️ Could not fetch balance');
      }
      break;

    case 'startbot':
      if (status !== 'offline') { tgSend(config.tgt, config.tgc, '⚠️ Already running'); break; }
      botStart();
      break;

    case 'stopbot':
      if (status === 'offline') { tgSend(config.tgt, config.tgc, '⚠️ Already stopped'); break; }
      botStop();
      break;

    case 'pause':
      paused = true;
      tgSend(config.tgt, config.tgc, '⏸ Paused — /resume to re-enable entries');
      break;

    case 'resume':
      paused = false;
      tgSend(config.tgt, config.tgc, '▶️ Resumed');
      break;

    case 'size': {
      const sz = +args[0];
      if (!sz || sz < 5) { tgSend(config.tgt, config.tgc, 'Usage: /size &lt;usdt&gt; (min 5)'); break; }
      config.sz = sz;
      tgSend(config.tgt, config.tgc, '✅ Size → ' + sz + ' USDT');
      break;
    }

    case 'tp': {
      const tp2 = +args[0];
      if (!tp2) { tgSend(config.tgt, config.tgc, 'Usage: /tp &lt;%&gt;'); break; }
      config.tp = tp2;
      tgSend(config.tgt, config.tgc, '✅ TP → ' + tp2 + '%');
      break;
    }

    case 'sl': {
      const sl2 = +args[0];
      if (!sl2) { tgSend(config.tgt, config.tgc, 'Usage: /sl &lt;%&gt;'); break; }
      config.sl = sl2;
      tgSend(config.tgt, config.tgc, '✅ SL → ' + sl2 + '%');
      break;
    }

    case 'leverage': {
      const lv = +args[0];
      if (!lv || lv < 1 || lv > 50) { tgSend(config.tgt, config.tgc, 'Usage: /leverage &lt;1-50&gt;'); break; }
      config.lv = lv;
      tgSend(config.tgt, config.tgc, '✅ Leverage → ' + lv + '×');
      break;
    }

    case 'confidence': {
      const mc = +args[0];
      if (!mc || mc < 1 || mc > 100) { tgSend(config.tgt, config.tgc, 'Usage: /confidence &lt;1-100&gt;'); break; }
      config.mc = mc;
      tgSend(config.tgt, config.tgc, '✅ Min confidence → ' + mc + '%');
      break;
    }

    case 'risk': {
      const pn = (args[0] || '').toLowerCase();
      if (!PRESETS[pn]) { tgSend(config.tgt, config.tgc, 'Options: /risk low|med|high'); break; }
      const pr = PRESETS[pn];
      config.sz = pr.sz; config.lv = pr.lv; config.tp = pr.tp; config.sl = pr.sl;
      tgSend(config.tgt, config.tgc, `✅ Risk preset ${pn.toUpperCase()}\nSize: ${pr.sz} | Lev: ${pr.lv}× | TP: ${pr.tp}% | SL: ${pr.sl}%`);
      break;
    }

    case 'strategy': {
      const instruction = args.join(' ');
      if (!instruction) { tgSend(config.tgt, config.tgc, 'Usage: /strategy <instruction>\nExample: /strategy avoid shorting ETH in ranging markets'); break; }
      if (!config.groq) { tgSend(config.tgt, config.tgc, '⚠️ Groq API key not set'); break; }
      tgSend(config.tgt, config.tgc, '🧠 Processing strategy change...');
      const response = await processStrategyCommand(config.groq, instruction);
      tgSend(config.tgt, config.tgc, '🧠 <b>Strategy Updated</b>\n\n' + response);
      break;
    }

    case 'insights': {
      if (!tradeLearnings.length) {
        tgSend(config.tgt, config.tgc, '📊 No trade insights yet. I need at least 3 trades to start learning. Use /analyze after some trades.');
        break;
      }
      let msg = '📊 <b>Trade Insights</b>\n\n';
      msg += tradeLearnings.slice(0, 5).map(l =>
        `${l.outcome === 'winning' ? '✅' : '❌'} <b>${l.pattern}</b>\nWin rate: ${l.winRate.toFixed(0)}% (${l.sampleSize} trades)\n→ ${l.recommendation}`
      ).join('\n\n');
      if (lastAnalysisTime) msg += `\n\nLast analysis: ${new Date(lastAnalysisTime).toLocaleString()} (${totalAnalyses} total)`;
      tgSend(config.tgt, config.tgc, msg);
      break;
    }

    case 'notes': {
      if (!strategyNotes.length) {
        tgSend(config.tgt, config.tgc, '📝 No strategy notes yet.\nUse /strategy <instruction> to teach me a rule.\nExample: /strategy only trade BTC during high volume');
        break;
      }
      let msg = '📝 <b>Strategy Notes</b>\n\n';
      msg += strategyNotes.slice(0, 15).map(n =>
        `${n.type === 'user' ? '👤' : '🤖'} <code>${n.id}</code> ${n.text}`
      ).join('\n');
      msg += '\n\nUse /forget <id> to remove a note.';
      tgSend(config.tgt, config.tgc, msg);
      break;
    }

    case 'forget': {
      const noteId = args[0];
      if (!noteId) { tgSend(config.tgt, config.tgc, 'Usage: /forget <note_id>\nUse /notes to see IDs.'); break; }
      const removed = botRemoveStrategyNote(noteId);
      tgSend(config.tgt, config.tgc, removed ? '✅ Note removed.' : '❌ Note not found. Use /notes to see IDs.');
      break;
    }

    case 'analyze': {
      if (tradeLog.length < 3) { tgSend(config.tgt, config.tgc, '⚠️ Need at least 3 trades to analyze. Keep trading!'); break; }
      if (!config.groq) { tgSend(config.tgt, config.tgc, '⚠️ Groq API key not set'); break; }
      tgSend(config.tgt, config.tgc, '🧠 Running self-analysis on trade history...');
      await analyzeTradePerformance();
      break;
    }

    case 'settings':
      tgSend(config.tgt, config.tgc,
        '⚙️ <b>Settings</b>\n' +
        `Mode: ${config.paper ? '📄 PAPER' : config.testnet ? 'TESTNET' : 'LIVE'}\n` +
        `Size: ${config.sz} USDT | Lev: ${config.lv}×\n` +
        `TP: ${config.tp}% | SL: ${config.sl}%\n` +
        `Min confidence: ${config.mc || 65}% | Max open: ${config.mx || 2}\n` +
        `Strategy notes: ${strategyNotes.length} | Learnings: ${tradeLearnings.length}`);
      break;

    default:
      // Any non-command message → forward to Groq AI as a question
      if (text.startsWith('/')) {
        tgSend(config.tgt, config.tgc, 'Unknown command. Send /help for all commands.');
      } else {
        // User sent a regular message — let Groq AI respond
        if (!config.groq) {
          tgSend(config.tgt, config.tgc, '⚠️ Groq API key not set. Add it in Settings to chat with AI.');
          break;
        }
        tgSend(config.tgt, config.tgc, '🧠 Thinking...');
        const answer = await askGroqQuestion(config.groq, text);
        tgSend(config.tgt, config.tgc, '🧠 <b>ByteBot AI:</b>\n\n' + answer);
      }
      break;
  }
}

function startTGPoll() {
  if (tgPollTimer) clearInterval(tgPollTimer);
  tgPollTimer = setInterval(pollTelegram, 3000);
  console.log('[BotEngine] Telegram polling started (every 3s)');
}

function stopTGPoll() {
  if (tgPollTimer) { clearInterval(tgPollTimer); tgPollTimer = null; }
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
    strategy: {
      notes: strategyNotes,
      learnings: tradeLearnings,
      lastAnalysisTime,
      totalAnalyses,
    },
  };
}

export function botGetConfig(): BotConfig {
  return { ...config };
}

export function botSetConfig(newConfig: BotConfig) {
  const oldTgt = config.tgt;
  const oldTgc = config.tgc;
  config = { ...newConfig, p: migratePairs(newConfig.p) };
  console.log('[BotEngine] Config updated');

  // If Telegram credentials changed, restart polling
  if (config.tgt && config.tgc && (config.tgt !== oldTgt || config.tgc !== oldTgc)) {
    startTGPoll();
  }
  schedulePersist();
}

export function botStart(): { error: string | null } {
  if (!config.groq) return { error: 'Add Groq API key in Settings' };
  if (!config.paper && !config.key) return { error: 'Add Bybit API keys in Settings' };
  if (status !== 'offline') return { error: null }; // already running

  status = 'running';
  paused = false;
  console.log('[BotEngine] Starting bot...');
  tgSend(config.tgt, config.tgc, `🤖 <b>ByteBot AI Started (Server-Side 24/7)</b>\nMode: ${config.paper ? '📄 PAPER TRADING (simulated)' : config.testnet ? 'TESTNET 🔵' : 'LIVE 🔴'}\nBrain: Groq llama-3.3-70b (FREE)\nMin confidence: ${config.mc || 65}%\n\nThe bot runs on the server — you can close the app.\nSend /help for commands 🚀`);

  // Initial scan + ticker + news
  doScan();
  refreshTickers();
  fetchNews();

  // 30-second scan cycle
  nextScanIn = 30;
  countdownTimer = setInterval(() => {
    if (status === 'offline') return;
    nextScanIn--;
    if (nextScanIn <= 0) {
      doScan();
      nextScanIn = 30;
    }
  }, 1000);

  // Ticker refresh every 10s
  tickerTimer = setInterval(refreshTickers, 10000);

  // News refresh every 2 min (matching original)
  newsTimer = setInterval(fetchNews, 120000);

  // Start Telegram polling (reads incoming messages)
  if (config.tgt && config.tgc) {
    startTGPoll();
  }

  // Periodic self-analysis every 10 minutes (if enough trades)
  if (analysisTimer) clearInterval(analysisTimer);
  analysisTimer = setInterval(() => {
    if (tradeLog.length >= 3) analyzeTradePerformance();
  }, 600000); // 10 minutes

  schedulePersist();
  return { error: null };
}

export function botStop() {
  status = 'offline';
  schedulePersist();
  nextScanIn = 0;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
  if (newsTimer) { clearInterval(newsTimer); newsTimer = null; }
  if (analysisTimer) { clearInterval(analysisTimer); analysisTimer = null; }
  stopTGPoll();
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
  strategyNotes = [];
  tradeLearnings = [];
  lastAnalysisTime = null;
  totalAnalyses = 0;
  if (analysisTimer) { clearInterval(analysisTimer); analysisTimer = null; }
}

export async function botTestTelegram(token: string, chatId: string): Promise<boolean> {
  return tgTest(token, chatId);
}
