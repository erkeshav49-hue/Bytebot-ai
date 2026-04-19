// ─── Technical Indicator Calculations ────────────────────────────────────────

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Indicators {
  ema: { e9: string; e21: string; e50: string; status: string };
  rsi: { value: string; zone: string };
  macd: { h: string; sig: string };
  adx: { adx: string; dp: string; dn: string };
  bb: { u: string; lo: string; pos_pct: string; pos_label: string; squeeze: boolean; bw: string };
  atr_pct: string;
  volume_ratio: string;
  last_5_closes: string[];
}

export function emaArr(cl: number[], p: number): number[] {
  const k = 2 / (p + 1);
  let e = cl[0];
  const r = [e];
  for (let i = 1; i < cl.length; i++) {
    e = cl[i] * k + e * (1 - k);
    r.push(e);
  }
  return r;
}

export function calcRSI(cl: number[], p = 14): number {
  if (cl.length < p + 2) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) {
    const d = cl[i] - cl[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    ag = (ag * (p - 1) + Math.max(d, 0)) / p;
    al = (al * (p - 1) + Math.max(-d, 0)) / p;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

export function calcMACD(cl: number[]): { h: string; sig: string } {
  if (cl.length < 27) return { h: '0', sig: 'flat' };
  const e12 = emaArr(cl, 12), e26 = emaArr(cl, 26);
  const ml = cl.map((_, i) => (e12[i] || 0) - (e26[i] || 0));
  const sg = emaArr(ml.slice(-20), 9), sg2 = emaArr(ml.slice(-21), 9);
  const h = ml[ml.length - 1] - sg[sg.length - 1];
  const hp = ml[ml.length - 2] - (sg2[sg2.length - 1] || 0);
  return {
    h: h.toFixed(6),
    sig: h > 0 && h > hp ? 'rising_bullish' : h < 0 && h < hp ? 'falling_bearish' : h > 0 ? 'bullish_weakening' : 'bearish_weakening',
  };
}

export function calcADX(h: number[], lo: number[], cl: number[]): { adx: string; dp: string; dn: string } {
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
  return {
    adx: (Math.abs(dp - dn) / ((dp + dn) || 1) * 100).toFixed(1),
    dp: dp.toFixed(1),
    dn: dn.toFixed(1),
  };
}

export function calcBB(cl: number[]): { u: string; lo: string; pos_pct: string; pos_label: string; squeeze: boolean; bw: string } {
  const p = 20;
  if (cl.length < p) {
    return { u: (cl[cl.length - 1] * 1.02).toFixed(2), lo: (cl[cl.length - 1] * 0.98).toFixed(2), pos_pct: '50', pos_label: 'middle', squeeze: false, bw: '4' };
  }
  const sl = cl.slice(-p);
  const m = sl.reduce((a, b) => a + b, 0) / p;
  const s = Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / p);
  const u = m + 2 * s, lo = m - 2 * s;
  const pos = (cl[cl.length - 1] - lo) / ((u - lo) || 1);
  const bw = (s / m) * 100 * 2;
  return {
    u: u.toFixed(2),
    lo: lo.toFixed(2),
    pos_pct: (pos * 100).toFixed(0),
    pos_label: pos < 0.2 ? 'near_lower' : pos > 0.8 ? 'near_upper' : 'middle',
    squeeze: bw < 2.5,
    bw: bw.toFixed(2),
  };
}

export function buildIndicators(candles: Candle[]): Indicators {
  const cl = candles.map(c => c.c), h = candles.map(c => c.h), lo = candles.map(c => c.l), v = candles.map(c => c.v);
  const n = cl.length;
  const e9 = emaArr(cl, 9), e21 = emaArr(cl, 21), e50 = emaArr(cl, 50);
  const rsi = calcRSI(cl, 14), macd = calcMACD(cl), adx = calcADX(h, lo, cl), bb = calcBB(cl);
  let atrS = 0;
  const aLen = Math.min(14, n - 1);
  for (let i = n - aLen; i < n; i++) {
    atrS += Math.max(h[i] - lo[i], Math.abs(h[i] - (cl[i - 1] || cl[i])), Math.abs(lo[i] - (cl[i - 1] || cl[i])));
  }
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
    macd,
    adx,
    bb,
    atr_pct: atrPct,
    volume_ratio: volR,
    last_5_closes: cl.slice(-5).map(v => v.toFixed(2)),
  };
}
