# FG Media Hub — Backend API

Express API for nominations, sponsorship payments, contact, R2 uploads, and webhooks.

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
