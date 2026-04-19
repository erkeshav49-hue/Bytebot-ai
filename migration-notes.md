# Server-Side Migration Notes

## Status
- All 4 screens migrated to tRPC polling (3s interval for snapshot, 5s for config)
- BotProvider removed from root layout
- Server bot-engine.ts contains full scan loop, indicators, Groq AI, Bybit API, Telegram
- TypeScript: 0 errors
- Dashboard shows "SERVER-SIDE 24/7" badge
- Preview renders correctly with all sections visible
