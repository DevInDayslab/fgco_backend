# FG Media Hub — Backend API

Express API for nominations, sponsorship payments, contact, R2 uploads, and webhooks.

## GoDaddy / cloud deploy

1. Set the app root to the `backend/` folder (or deploy only `backend/` contents).
2. Build command: `npm run build`
3. Start command: `npm start`
4. Set `PORT` in the host environment (GoDaddy usually injects this automatically).
5. Verify: `https://your-domain/health` → `{"ok":true,"service":"fg-media-hub-api"}`

The server binds to `0.0.0.0` so container hosts can reach it.

## Setup

```sh
cd backend
npm install
cp .env.example .env
npm run dev
```

Health check: `http://localhost:3001/health`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled server |
