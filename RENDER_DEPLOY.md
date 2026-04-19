# ByteBot AI — Render.com Deployment Guide

## Step 1: Sign Up on Render

Go to [render.com](https://render.com) and sign up (GitHub or email).

## Step 2: Create a New Web Service

1. Click **"New"** → **"Web Service"**
2. Select **"Build and deploy from a Git repository"** or **"Deploy an existing image from a registry"**
3. If you don't have a Git repo, select **"Upload files"** or connect your GitHub

## Step 3: Configure the Service

| Setting | Value |
|---------|-------|
| **Name** | `bytebot-ai` |
| **Region** | Singapore (or closest to you) |
| **Runtime** | Node |
| **Build Command** | `pnpm install && pnpm build` |
| **Start Command** | `pnpm start` |
| **Instance Type** | Free |

## Step 4: Add Environment Variables

Go to **Environment** tab and add these:

| Key | Value | Required? |
|-----|-------|-----------|
| `NODE_ENV` | `production` | Yes |
| `PORT` | `3000` | Yes |

The bot's API keys (Groq, Bybit, Telegram) are configured through the app's Settings screen or Telegram commands — no need to add them as env vars.

## Step 5: Deploy

Click **"Create Web Service"**. Render will build and deploy automatically.

Your server URL will be: `https://bytebot-ai.onrender.com`

## Step 6: Update Mobile App

In the mobile app's Settings, update the API URL to point to your Render server.

## Notes

- Free tier sleeps after 15 min of inactivity
- ByteBot's Telegram polling keeps the server awake while the bot is running
- If the bot is stopped, the server may sleep — just open the app or send a Telegram message to wake it up
