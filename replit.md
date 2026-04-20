# ByteBot AI

An AI-powered crypto trading bot with a React Native (Expo) frontend and Node.js (Express) backend.

## Architecture

- **Frontend**: Expo (React Native) with Expo Router, running on web via Metro bundler
- **Backend**: Express server with tRPC API
- **Database**: MySQL/TiDB via Drizzle ORM
- **AI**: Groq AI for trading decisions
- **Package Manager**: pnpm

## Project Structure

- `app/` - Expo Router screens and layouts
- `server/` - Backend Express server
  - `_core/` - Framework code (auth, db, tRPC, OAuth)
  - `routers.ts` - tRPC API routes
  - `bot-engine.ts` - Trading bot logic
- `shared/` - Shared types and constants
- `components/` - Reusable React Native components
- `lib/` - Frontend utilities (tRPC client, hooks)
- `constants/` - App constants including OAuth config
- `drizzle/` - Database schema and migrations

## Ports

- **5000** - Expo Web (Metro bundler) - main frontend
- **3000** - Express API server (backend)

## Dev Commands

- `pnpm dev` - Start both Metro and Express server concurrently
- `pnpm dev:server` - Start only the Express backend
- `pnpm dev:metro` - Start only the Metro/Expo frontend
- `pnpm build` - Bundle backend with esbuild
- `pnpm db:push` - Run Drizzle migrations

## Environment Variables

- `DATABASE_URL` - MySQL connection string
- `JWT_SECRET` - Cookie/session secret
- `OAUTH_SERVER_URL` - OAuth server URL
- `VITE_APP_ID` / `EXPO_PUBLIC_APP_ID` - App ID for OAuth
- `OWNER_OPEN_ID` - Owner user ID
- `GROQ_API_KEY` (or configured via bot settings UI)
- `PORT` - Server port (default: 3000)

## Deployment

Configured for autoscale deployment. Build step bundles the server with esbuild, then runs `node dist/index.js`.
