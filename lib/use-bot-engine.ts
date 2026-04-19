import { useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBotContext, BotConfig, OpenTrade, TradeLog } from './bot-context';
import { buildIndicators, emaArr, calcRSI, Candle } from './indicators';
import { getBase, fetchKlines, fetchTicker, fetchPositions, placeOrder } from './bybit-api';
import { askGroq } from './groq-ai';
import { tgSend } from './telegram';

const STORAGE_KEY_LOG = 'bbg5_log';
const STORAGE_KEY_STATS = 'bbg5_stats';

export function useBotEngine() {
  const { state, dispatch } = useBotContext();
  const botTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const newsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef(45);

  const C = state.config;

  function getPairs(config: BotConfig) {
    const p = config.p || {};
    const r: { sym: string; mkt: string; cat: string }[] = [];
    if (p.bs !== false) r.push({ sym: 'BTCUSDT', mkt: 'spot', cat: 'spot' });
    if (p.es !== false) r.push({ sym: 'ETHUSDT', mkt: 'spot', cat: 'spot' });
    if (p.bf !== false) r.push({ sym: 'BTCUSDT', mkt: 'futures', cat: 'linear' });
    if (p.ef !== false) r.push({ sym: 'ETHUSDT', mkt: 'futures', cat: 'linear' });
    return r;
  }

  const persistLog = useCallback(async (log: TradeLog[], stats: { pnl: number; trades: number; wins: number }) => {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_LOG, JSON.stringify(log)),
      AsyncStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats)),
    ]);
  }, []);

  const closeTrade = useCallback((key: string, ep: number, pnl: number, reason: string) => {
    const t = state.openTrades[key];
    if (!t) return;
    dispatch({ type: 'REMOVE_OPEN_TRADE', key });
    const win = pnl > 0;
    dispatch({ type: 'UPDATE_STATS', pnl, win });
    const logEntry: TradeLog = {
      time: new Date().toLocaleTimeString(),
      sym: t.sym,
      mkt: t.mkt,
      side: t.side,
      entry: t.entry,
      exit: ep,
      pnl: pnl.toFixed(3),
      reason,
      conf: t.conf,
      reasoning: t.reasoning || '',
    };
    dispatch({ type: 'ADD_TRADE_LOG', payload: logEntry });
    const newStats = {
      pnl: state.stats.pnl + pnl,
      trades: state.stats.trades + 1,
      wins: state.stats.wins + (win ? 1 : 0),
    };
    persistLog([logEntry, ...state.tradeLog].slice(0, 200), newStats);
    const tgMsg = (pnl > 0 ? '✅' : '❌') + ` <b>Trade Closed [${reason}]</b>\n${t.sym} ${t.side.toUpperCase()} [${t.mkt}]\nEntry: ${t.entry} → Exit: ${ep}\nP&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)} USDT`;
    tgSend(C.tgt, C.tgc, tgMsg);
  }, [state, dispatch, C, persistLog]);

  const syncPositions = useCallback(async () => {
    const base = getBase(C.testnet);
    if (C.paper) {
      for (const k of Object.keys(state.openTrades)) {
        const t = state.openTrades[k];
        try {
          const tk = await fetchTicker(base, t.sym, t.cat === 'linear' ? 'linear' : 'spot');
          if (!tk) continue;
          const price = tk.last;
          const isLong = t.side === 'long';
          if (isLong && price >= t.tp) {
            closeTrade(k, t.tp, (t.tp - t.entry) * t.qty, 'Paper TP hit ✅');
          } else if (isLong && price <= t.sl) {
            closeTrade(k, t.sl, (t.sl - t.entry) * t.qty, 'Paper SL hit ❌');
          } else if (!isLong && price <= t.tp) {
            closeTrade(k, t.tp, (t.entry - t.tp) * t.qty, 'Paper TP hit ✅');
          } else if (!isLong && price >= t.sl) {
            closeTrade(k, t.sl, (t.entry - t.sl) * t.qty, 'Paper SL hit ❌');
          }
        } catch (e) { /* silent */ }
      }
      return;
    }
    // Live mode: check real positions
    try {
      const resp = await fetchPositions(base, C.key, C.secret);
      const active = new Set<string>((resp.result?.list || []).filter((p: any) => +p.size > 0).map((p: any) => p.symbol));
      for (const k of Object.keys(state.openTrades)) {
        const t = state.openTrades[k];
        if (t.mkt === 'futures' && !active.has(t.sym)) {
          try {
            const tk = await fetchTicker(base, t.sym, 'linear');
            const ep = tk?.last || t.entry;
            const pnl = (t.side === 'long' ? 1 : -1) * (ep - t.entry) * t.qty;
            closeTrade(k, ep, pnl, 'TP/SL hit');
          } catch (e) { /* silent */ }
        }
      }
    } catch (e) { /* silent */ }
  }, [state, C, closeTrade]);

  const openPosition = useCallback(async (sym: string, mkt: string, cat: string, decision: any, price: number) => {
    const key = mkt + '_' + sym;
    const side = decision.action === 'long' ? 'Buy' : 'Sell';
    const rm = decision.confidence >= 85 ? 1.5 : decision.confidence >= 75 ? 1.2 : 1.0;
    const usdt = (C.sz || 20) * rm;
    const lev = mkt === 'futures' ? (C.lv || 5) : 1;
    const qty = parseFloat(((usdt * lev) / price).toFixed(6));
    const tp = decision.action === 'long'
      ? +(price * (1 + (C.tp || 0.5) / 100)).toFixed(4)
      : +(price * (1 - (C.tp || 0.5) / 100)).toFixed(4);
    const sl = decision.action === 'long'
      ? +(price * (1 - (C.sl || 0.25) / 100)).toFixed(4)
      : +(price * (1 + (C.sl || 0.25) / 100)).toFixed(4);

    if (C.paper) {
      const trade: OpenTrade = { sym, mkt, cat, side: decision.action, entry: price, qty, tp, sl, time: Date.now(), conf: decision.confidence, reasoning: decision.reasoning, key_factor: decision.key_factor, regime: decision.market_regime, paper: true };
      dispatch({ type: 'ADD_OPEN_TRADE', key, payload: trade });
      tgSend(C.tgt, C.tgc, `📄 <b>Paper Trade Opened</b>\n\n<b>${sym}</b> [${mkt.toUpperCase()}] ${decision.action.toUpperCase()}\nEntry: ${price} | TP: ${tp} | SL: ${sl}\nConfidence: ${decision.confidence}%\n\n🧠 <b>Groq AI Reasoning:</b>\n${decision.reasoning}\n\n💡 ${decision.key_factor}\n\n<i>This is a simulated paper trade — no real money used.</i>`);
      return;
    }

    const base = getBase(C.testnet);
    const body: any = { category: cat, symbol: sym, side, orderType: 'Market', qty: '' + qty };
    if (cat === 'linear') { body.takeProfit = '' + tp; body.stopLoss = '' + sl; body.tpslMode = 'Full'; }
    try {
      const resp = await placeOrder(base, C.key, C.secret, body);
      if (resp.retCode !== 0) return;
      const trade: OpenTrade = { sym, mkt, cat, side: decision.action, entry: price, qty, tp, sl, time: Date.now(), conf: decision.confidence, reasoning: decision.reasoning, key_factor: decision.key_factor, regime: decision.market_regime };
      dispatch({ type: 'ADD_OPEN_TRADE', key, payload: trade });
      tgSend(C.tgt, C.tgc, `${decision.action === 'long' ? '🟢' : '🔴'} <b>AI Trade Opened</b>\n\n<b>${sym}</b> [${mkt.toUpperCase()}] ${decision.action.toUpperCase()}\nEntry: ${price} | TP: ${tp} | SL: ${sl}\nConfidence: ${decision.confidence}%\n\n🧠 <b>Groq AI Reasoning:</b>\n${decision.reasoning}\n\n💡 ${decision.key_factor}`);
    } catch (e) { /* silent */ }
  }, [C, dispatch]);

  const doScan = useCallback(async () => {
    if (state.paused) return;
    dispatch({ type: 'INCREMENT_SCAN' });
    dispatch({ type: 'SET_STATUS', payload: 'thinking' });
    const base = getBase(C.testnet);
    await syncPositions();
    const pairs = getPairs(C);
    for (const { sym, mkt, cat } of pairs) {
      const key = mkt + '_' + sym;
      if (state.openTrades[key]) continue;
      if (Object.keys(state.openTrades).length >= (C.mx || 2)) break;
      try {
        dispatch({ type: 'SET_AI_DECISION', key, payload: { sym, mkt, thinking: true } });
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
        const recentTrades = state.tradeLog.slice(0, 5).map(t => ({ side: t.side, sym: t.sym, mkt: t.mkt, pnl: t.pnl, reason: t.reason }));
        const decision = await askGroq(C.groq, sym, mkt, inds, `${htfDir} | RSI: ${htfRSI}`, tk, state.newsHeadlines, recentTrades);
        dispatch({ type: 'SET_AI_DECISION', key, payload: { ...decision, sym, mkt, thinking: false, time: new Date().toLocaleTimeString(), price: tk.last } });
        const minConf = C.mc || 65;
        if (decision.action !== 'wait' && decision.confidence >= minConf) {
          if (mkt === 'spot' && decision.action === 'short') continue;
          await openPosition(sym, mkt, cat, decision, tk.last);
        }
      } catch (e: any) {
        dispatch({ type: 'SET_AI_DECISION', key, payload: { thinking: false, sym, mkt, action: 'wait', confidence: 0, reasoning: 'Error: ' + e.message, key_factor: 'API error', risk_level: 'high', market_regime: 'volatile', warnings: [e.message], time: new Date().toLocaleTimeString() } });
      }
    }
    dispatch({ type: 'SET_STATUS', payload: 'running' });
  }, [state, C, dispatch, syncPositions, openPosition]);

  const refreshTickers = useCallback(async () => {
    const base = getBase(C.testnet);
    const pairs = [
      { s: 'BTCUSDT', c: 'spot', key: 'spot_BTC' },
      { s: 'ETHUSDT', c: 'spot', key: 'spot_ETH' },
      { s: 'BTCUSDT', c: 'linear', key: 'linear_BTC' },
      { s: 'ETHUSDT', c: 'linear', key: 'linear_ETH' },
    ];
    for (const p of pairs) {
      try {
        const tk = await fetchTicker(base, p.s, p.c);
        dispatch({ type: 'SET_TICKER', key: p.key, payload: tk });
      } catch (e) { /* silent */ }
    }
  }, [C.testnet, dispatch]);

  const fetchNews = useCallback(async () => {
    try {
      const r = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,ETH&limit=5');
      const d = await r.json();
      const headlines = (d.Data || []).slice(0, 5).map((n: any) => n.title);
      dispatch({ type: 'SET_NEWS', payload: headlines });
    } catch (e) {
      dispatch({ type: 'SET_NEWS', payload: ['Unable to fetch news — AI will use price data only'] });
    }
  }, [dispatch]);

  const startBot = useCallback(() => {
    if (!C.groq) return { error: 'Add Groq API key in Settings' };
    if (!C.paper && !C.key) return { error: 'Add Bybit API keys in Settings' };
    dispatch({ type: 'SET_STATUS', payload: 'running' });
    dispatch({ type: 'SET_PAUSED', payload: false });
    tgSend(C.tgt, C.tgc, `🤖 <b>ByteBot AI Started</b>\nMode: ${C.paper ? '📄 PAPER TRADING (simulated)' : C.testnet ? 'TESTNET 🔵' : 'LIVE 🔴'}\nBrain: Groq llama-3.3-70b (FREE)\nMin confidence: ${C.mc || 65}%\n\nSend /help for commands 👇`);
    doScan();
    countdownRef.current = 45;
    dispatch({ type: 'SET_NEXT_SCAN', payload: 45 });
    botTimerRef.current = setInterval(() => {
      countdownRef.current -= 1;
      dispatch({ type: 'SET_NEXT_SCAN', payload: countdownRef.current });
      if (countdownRef.current <= 0) {
        doScan();
        countdownRef.current = 45;
      }
    }, 1000);
    // Ticker refresh every 10s
    refreshTickers();
    tickerTimerRef.current = setInterval(refreshTickers, 10000);
    // News refresh every 5 min
    fetchNews();
    newsTimerRef.current = setInterval(fetchNews, 300000);
    return { error: null };
  }, [C, dispatch, doScan, refreshTickers, fetchNews]);

  const stopBot = useCallback(() => {
    dispatch({ type: 'SET_STATUS', payload: 'offline' });
    dispatch({ type: 'SET_NEXT_SCAN', payload: 0 });
    if (botTimerRef.current) { clearInterval(botTimerRef.current); botTimerRef.current = null; }
    if (tickerTimerRef.current) { clearInterval(tickerTimerRef.current); tickerTimerRef.current = null; }
    if (newsTimerRef.current) { clearInterval(newsTimerRef.current); newsTimerRef.current = null; }
    tgSend(C.tgt, C.tgc, '⏹ <b>ByteBot AI Stopped</b>');
  }, [dispatch, C]);

  return { startBot, stopBot, refreshTickers, fetchNews };
}
