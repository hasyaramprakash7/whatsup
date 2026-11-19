# WhatsApp Real Estate Engine

Multi-tenant WhatsApp Cloud API engine — BullMQ broadcasts, HMAC-verified webhooks, tier-aware quota guard, Cloudflare R2 brochure hosting, MongoDB persistence.

## Infrastructure Used (no AWS services)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Messaging | Meta WhatsApp Cloud API | Templates, interactive messages, documents, location |
| File Storage | **Cloudflare R2** | S3-compatible. **Zero egress**. Uses `@aws-sdk/client-s3` pointed at Cloudflare's endpoint — NOT AWS storage |
| Database | MongoDB | Tenants + leads |
| Queue | Redis + BullMQ | Broadcast jobs, rate-limited, restart-safe |
| Session State | Redis | Conversation state machine (24h TTL) |
| Web/UI | Express + vanilla JS | Admin dashboard at `/` |

**AWS EMR, S3, EC2, Lambda, DynamoDB are NOT used.**

## Quick Start

```bash
cp .env.example .env
# Fill MONGO_URI, REDIS_*, WHATSAPP_VERIFY_TOKEN, META_APP_SECRET, R2_*

npm install
docker run -d --name redis -p 6379:6379 redis:7
docker run -d --name mongo -p 27017:27017 mongo:7

# Create indexes
mongosh "mongodb://127.0.0.1:27017/whatsapp_realestate" --eval '
  db.leads.createIndex({ tenantId: 1, phone: 1 }, { unique: true });
  db.leads.createIndex({ tenantId: 1, lastBroadcastAt: -1 });
  db.tenants.createIndex({ phoneNumberId: 1 }, { unique: true });
'

npm run dev          # terminal 1 — web/API
npm run dev:worker   # terminal 2 — broadcast worker