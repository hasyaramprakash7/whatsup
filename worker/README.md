# Agent Desk — WhatsApp agent for any business (Cloudflare)

One Cloudflare Worker runs everything: the dashboard, the API, the Meta webhook and live updates.

| Piece | Cloudflare product | What it does |
|---|---|---|
| API, webhook, dashboard | **Workers** (+ static assets) | `src/index.js`, `public/` |
| Businesses, flows, leads, messages | **D1** (SQLite) | `migrations/0001_init.sql` |
| One per customer chat | **Durable Object** `ConversationDO` | Stores each incoming message before Meta gets its 200, processes them strictly in order, remembers where the customer is in the flow |
| One per business | **Durable Object** `BusinessHub` | Live dashboard WebSockets, paced + retried broadcasts |
| AI assistant | **Workers AI** | Answers from the Business Profile, maps typed answers to buttons, hands over to a person (`src/lib/ai.js`) |
| Brochures / menus / catalogues | **R2** | Public PDF links sent on WhatsApp |

Industry templates (real estate, clinic, salon, restaurant, coaching, shop, general) live in `src/lib/templates.js`; every step is editable in the dashboard's Flow Builder.

## Run locally

```powershell
cd worker
npm install
npx wrangler d1 migrations apply whatsapp-agent --local
npx wrangler dev
```

Create `worker/.dev.vars` (never committed):

```
ADMIN_API_KEY=<at least 32 random characters>
TOKEN_ENCRYPTION_KEY=<at least 16 random characters>
WHATSAPP_VERIFY_TOKEN=<any string, also entered in Meta>
META_APP_SECRET=<Meta app secret>            # or ALLOW_UNSIGNED_WEBHOOKS=true for local tests only
# GRAPH_BASE_URL=http://127.0.0.1:4999       # optional: point sends at a fake WhatsApp API while testing
```

Open http://localhost:8787 and sign in with `ADMIN_API_KEY`. Workers AI always runs on Cloudflare (uses your account's AI allowance) even in local dev.

## Deploy

1. `npx wrangler d1 create whatsapp-agent` → put the printed `database_id` into `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply whatsapp-agent --remote`
3. Secrets (each command asks for the value):
   `npx wrangler secret put ADMIN_API_KEY`, `TOKEN_ENCRYPTION_KEY`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`
4. `npx wrangler deploy` → note the `https://whatsapp-agent.<your-subdomain>.workers.dev` URL.
5. In Meta → WhatsApp → Configuration, set the webhook to `https://…workers.dev/webhook` with your verify token, and subscribe to `messages`.

### Move data from the old Node/MongoDB app

```powershell
$env:MONGO_URI="mongodb://127.0.0.1:27017/whatsapp_realestate"; $env:TOKEN_ENCRYPTION_KEY="<same as the Worker secret>"; node scripts/migrate-from-mongo.mjs migration.sql
npx wrangler d1 execute whatsapp-agent --remote --file migration.sql
```

Businesses keep their dashboard API keys; their Bot Studio texts become a real-estate flow. Delete `migration.sql` afterwards (it contains encrypted tokens).

## Settings (`wrangler.jsonc` → `vars`)

- `AI_MODEL` — any Workers AI chat model with JSON output, default `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- `BROADCAST_RATE_PER_SECOND` — template sends per second per business (default 10).
- `DEFAULT_BROADCAST_TEMPLATE` / `DEFAULT_BROADCAST_LANGUAGE` — used when a business hasn't set its own.
- `SITE_UTC_OFFSET` — time zone for appointment slots (default `+05:30`).
- `R2_PUBLIC_BASE_URL` — public URL of the R2 bucket.
