# FG Media Hub — Backend API

Express API for nominations, sponsorship payments, contact, R2 uploads, and webhooks.

## Local development

1. Copy env templates:

```sh
cp .env.example .env
cp .env.local.example .env.local
```

2. Set **local MySQL** credentials in `.env.local` (`LOCAL_DB_*`). Development always uses `LOCAL_DB_*` when `NODE_ENV` is not `production`.

3. Push schema to your local database:

```sh
npm run db:push
```

4. Start the API:

```sh
npm run dev
```

Health: `http://localhost:3000/health`

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | `drizzle-kit push` then run compiled server |
| `npm run db:push` | Sync Drizzle schema to the configured database |
| `npm run db:studio` | Open Drizzle Studio |

## GoDaddy / production deploy

1. Set the app root to the `backend/` folder (or deploy only `backend/` contents).
2. Build command: `npm run build`
3. Start command: `npm start` (runs `drizzle-kit push` before boot)
4. Set `PORT` in the host environment (GoDaddy usually injects this automatically).
5. Verify: `https://your-domain/health` → `{"ok":true,"service":"fg-media-hub-api"}`

The server binds to `0.0.0.0` so container hosts can reach it.

Set variables in GoDaddy’s environment panel (never commit `.env`).

### Required production environment variables

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` |
| `PORT` | Host port (often injected by platform) |
| `CORS_ORIGIN` | Comma-separated frontend origins |
| `CPANEL_DB_HOST` | GoDaddy MySQL hostname |
| `CPANEL_DB_PORT` | Usually `3306` |
| `CPANEL_DB_NAME` | Database name |
| `CPANEL_DB_USER` | Database user |
| `CPANEL_DB_PASS` | Database password |
| `ADMIN_USERNAME` | Bootstrap admin username when `admins` is empty (default `admin`) |
| `ADMIN_PASSWORD` | Bootstrap admin password when `admins` is empty |
| `ADMIN_PASSCODE` | Optional bootstrap fallback if `ADMIN_PASSWORD` is unset |
| `ADMIN_JWT_SECRET` | Secret used to sign admin JWTs (required) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Outbound email |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Payments (when wired) |

Do **not** set `LOCAL_DB_*` on production unless you intentionally want to override cPanel credentials.

### Frontend admin pairing

- `VITE_API_BASE_URL` → your API origin (e.g. `https://api.fgco.in`)

Admin login is username + password against the API. Passwords are never stored in frontend env.

Apply the admins migration on MySQL before first boot:

```bash
mysql ... < drizzle/0002_admins.sql
```

The API bootstraps the first admin from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (or `ADMIN_PASSCODE`) when the table is empty. Change the password later under `/admin/settings`.
