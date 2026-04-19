# ByteBot AI — Mobile App Design

## Brand Identity
- **App Name:** ByteBot AI
- **Tagline:** AI-Powered Crypto Trading Bot
- **Color Palette:**
  - Background: `#04080f` (near-black deep blue)
  - Surface: `#080d18` (dark navy)
  - Surface2: `#0d1422` (slightly lighter navy)
  - Border: `#1a2d48` (steel blue border)
  - Green (profit/long): `#00f5a0`
  - Red (loss/short): `#ff4060`
  - Amber (warning): `#ffbe30`
  - Purple (thinking/AI): `#a855f7`
  - Blue (accent): `#3d9bff`
  - Text dim: `#3d5470`
  - Text muted: `#9ab3ce`
  - Text bright: `#daeaf8`
- **Fonts:** JetBrains Mono (data/mono), Syne (headings)

## Screen List

1. **Setup Wizard** — First-run onboarding to configure API keys
2. **Dashboard (Home)** — Bot controls, stats, live prices, AI decisions, news
3. **Positions** — Open trades with entry/TP/SL details
4. **Trade Log** — Closed trade history with P&L
5. **Settings** — Full configuration: API keys, trading params, pairs, Telegram

## Screen Details

### 1. Setup Wizard
- Welcome screen with ByteBot logo and tagline
- Step 1: Groq API key input (required)
- Step 2: Trading mode selection (Paper / Testnet / Live)
- Step 3: Bybit API keys (hidden if Paper mode)
- Step 4: Optional Telegram bot config
- CTA: "Launch ByteBot" button

### 2. Dashboard
- **Header:** ByteBot AI logo + mode badge (PAPER/TESTNET/LIVE) + status pill (OFFLINE/RUNNING/THINKING)
- **Stats Grid (2x2):**
  - Total P&L (green/red)
  - Trades count + win rate
  - Open positions count
  - AI Scans + next scan countdown
- **START/STOP Button:** Large hero button
- **Live Prices:** BTC/ETH spot + perp tickers with 24h change
- **Crypto News:** 5 headlines (AI reads these)
- **AI Decisions:** Cards per pair showing action (LONG/SHORT/WAIT), confidence bar, reasoning, key factor, warnings

### 3. Positions
- List of open trades
- Each card: symbol, market type, LONG/LONG badge, entry price, TP/SL, quantity, AI confidence, reasoning snippet
- Empty state with icon

### 4. Trade Log
- Closed trades list (most recent first)
- Each item: side badge, symbol, market, P&L (green/red), time, close reason, AI reasoning snippet
- Clear log button
- Empty state

### 5. Settings
- **AI Brain:** Groq API key input
- **Trading Mode:** Paper mode toggle, Bybit API key/secret, Testnet toggle
- **Telegram:** Bot token + Chat ID + Test button
- **Trading Pairs:** BTC Spot, ETH Spot, BTC Futures, ETH Futures toggles
- **Risk Parameters:** Order size, Max open trades, Take Profit %, Stop Loss %, Leverage, Min AI Confidence
- **Risk Presets:** LOW / MED / HIGH buttons
- **Save button**
- **Danger Zone:** Reset app button

## Key User Flows

1. **First Launch:** Setup Wizard → enter Groq key → select Paper mode → Launch → Dashboard
2. **Start Bot:** Dashboard → tap START → bot scans every 45s → AI decisions appear → trades open automatically
3. **Monitor Trade:** Dashboard → see AI decision card → tap Positions tab → see open trade details
4. **Review History:** Tap Trade Log tab → see all closed trades with P&L
5. **Change Settings:** Tap Settings tab → modify params → Save → bot uses new settings on next scan

## Navigation
- Bottom tab bar with 4 tabs: Dashboard, Positions, Log, Settings
- Tab icons: chart-bar, trending-up, list, gear
- Active tab: green (#00f5a0)
- Inactive: dim (#3d5470)
