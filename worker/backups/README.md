# Database backups (not in git)

`npm run deploy` saves a full copy of the live database here before every release (`db-<date>.sql`), kept for 30 days.

**Restore** (replaces the live data with the backup; do it only when something went wrong):

```
npx wrangler d1 execute whatsapp-agent --remote --file backups/db-<date>.sql
```

Cloudflare also keeps its own 30-day history ("Time Travel"): `npx wrangler d1 time-travel restore whatsapp-agent --timestamp <ISO time>`.
