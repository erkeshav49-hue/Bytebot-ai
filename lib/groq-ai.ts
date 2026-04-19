import { Indicators } from './indicators';

export interface GroqDecision {
  action: 'long' | 'short' | 'wait';
  confidence: number;
  reasoning: string;
  key_factor: string;
  risk_level: 'low' | 'medium' | 'high';
  market_regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'quiet';
  warnings: string[];
}

export interface RecentTrade {
  side: string;
  sym: string;
  mkt: string;
  pnl: string;
  reason: string;
}

export async function askGroq(
  groqKey: string,
  sym: string,
  mkt: string,
  indicators: Indicators,
  htfTrend: string,
  ticker: { last: number; chg: number; vol: number },
  newsHeadlines: string[],
  recentTrades: RecentTrade[],
): Promise<GroqDecision> {
  const newsCtx = newsHeadlines.length
    ? 'RECENT CRYPTO NEWS:\n' + newsHeadlines.slice(0, 4).map((h, i) => `${i + 1}. ${h}`).join('\n')
    : 'No news available.';
  const tradeCtx = recentTrades.length
    ? 'RECENT TRADE HISTORY (learn from these):\n' + recentTrades.slice(0, 5).map(t => `- ${t.side.toUpperCase()} ${t.sym} [${t.mkt}]: P&L ${+t.pnl >= 0 ? '+' : ''}${t.pnl} USDT (${t.reason})`).join('\n')
    : 'No recent trades yet.';

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

  let data: any;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
      body,
    });
    data = await r.json();
  } catch (e) {
    // CORS fallback
    const r2 = await fetch('https://corsproxy.io/?url=https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey, 'x-requested-with': 'XMLHttpRequest' },
      body,
    });
    data = await r2.json();
  }

  if (data.error) throw new Error(data.error.message || 'Groq API error');
  const text = data.choices[0].message.content.trim().replace(/```json|```/g, '').trim();
  return JSON.parse(text) as GroqDecision;
}

export async function askGroqQuestion(groqKey: string, question: string): Promise<string> {
  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 350,
    messages: [
      { role: 'system', content: 'You are a crypto trading assistant. Be brief and practical. Max 150 words.' },
      { role: 'user', content: question },
    ],
  });
  let data: any;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
      body,
    });
    data = await r.json();
  } catch (e) {
    const r2 = await fetch('https://corsproxy.io/?url=https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey, 'x-requested-with': 'XMLHttpRequest' },
      body,
    });
    data = await r2.json();
  }
  return data.choices[0].message.content;
}
