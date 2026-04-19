# Audit Findings

## Order Lifecycle
- Open: Works correctly. Paper mode creates in-memory trades, live mode sends Market order to Bybit with TP/SL.
- Close: Paper mode checks price vs TP/SL every scan (45s). Live mode checks if position disappeared from Bybit.
- Both match the original HTML exactly.

## News Integration
- CryptoCompare API is called, headlines stored in newsHeadlines array.
- Headlines ARE passed to Groq AI prompt via newsCtx variable (line 192, 212).
- News refresh every 5 min (original was 2 min). Should match original at 2 min.
- Only 1 source (CryptoCompare). Could add more for richer context.

## Trade Parameters
- All config values (sz, lv, tp, sl, mc, mx) are correctly used in openPosition().
- Confidence multiplier applied: 85%+ = 1.5x size, 75%+ = 1.2x, else 1.0x.
- Min confidence gate at line 388-389 correctly blocks low-confidence trades.
- Spot short correctly blocked at line 390.

## Missing from Original HTML (now needs to be added)
1. Telegram polling (getUpdates) - the bot never reads incoming messages
2. Full command handler: /help, /status, /positions, /trades, /balance, /ask, /startbot, /stopbot, /pause, /resume, /size, /tp, /sl, /leverage, /confidence, /risk, /settings
3. askGroqQuestion() - lets user ask any question and Groq responds via Telegram
4. Risk presets: low={sz:10,lv:3,tp:.3,sl:.15}, med={sz:20,lv:5,tp:.5,sl:.25}, high={sz:50,lv:10,tp:.8,sl:.4}
5. News refresh was 2 min in original, currently 5 min
