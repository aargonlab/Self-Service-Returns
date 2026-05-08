# Self-Service Return

**A self-service returns management platform for Shopify merchants.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Shopify API](https://img.shields.io/badge/Shopify%20Admin%20API-2026--04-green)](https://shopify.dev/docs/api/usage/versioning)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520.10-brightgreen)](https://nodejs.org)
[![Made by aargonlab](https://img.shields.io/badge/Made%20by-aargonlab-orange)](https://www.aargonlab.com)

A complete, open-source returns management solution that gives Shopify merchants a branded customer portal, configurable policy automation, and a backoffice for managing returns, refunds, and exchanges.

Built on Remix + Shopify App Bridge + Polaris, with PostgreSQL via Prisma.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start (local development)](#quick-start-local-development)
- [Configuration](#configuration)
  - [Environment variables](#environment-variables)
  - [Shopify scopes](#shopify-scopes)
  - [Shopify app config](#shopify-app-config)
- [Available scripts](#available-scripts)
- [Production build](#production-build)
- [Docker](#docker)
- [Deploying to Fly.io](#deploying-to-flyio)
- [Architecture](#architecture)
- [API reference](#api-reference)
- [Return state machine](#return-state-machine)
- [Internationalization](#internationalization)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Customer experience
- Branded, mobile-responsive self-service portal with customizable logo, colors, and fonts.
- 27 languages out of the box, with per-shop translation overrides.
- Order lookup by order number + email, or via the Shopify customer account.
- Real-time eligibility checks against return windows and policy rules.
- Optional serial-number selection for ERP-integrated workflows.
- Image attachments for item-condition documentation.
- Status tracking from submission through refund.

### Merchant management
- Embedded admin app built with Polaris 13 and App Bridge 4.
- Policy engine with auto-approval, auto-rejection, and manual-review triggers.
- Structured 12-state return lifecycle.
- Multi-warehouse routing with market-aware rules.
- Optional automated label generation through ProcessWeaver (FedEx, UPS, DHL, Canada Post, …).
- Exchange / replacement order creation directly from a return.
- Agent-initiated refunds protected by email OTP.
- Custom return reasons with per-market visibility.
- Full timeline and audit trail per return.

### Integrations & API
- REST API at `/api/v1/*` with API-key auth.
- HMAC-SHA256 signed outbound webhooks.
- Bidirectional sync with Shopify Orders + Returns.
- Transactional emails via [Resend](https://resend.com).

### Security & compliance
- AES-256-GCM at-rest encryption for stored carrier credentials.
- HMAC-signed outbound webhooks.
- Shop-scoped data isolation.
- Audit logging on all state transitions.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | [Remix](https://remix.run/) 2 (Vite) |
| Admin UI | [Shopify Polaris](https://polaris.shopify.com/) 13 + [App Bridge](https://shopify.dev/docs/api/app-bridge-library) 4 |
| Portal UI | Tailwind CSS 3 |
| Shopify SDK | `@shopify/shopify-app-remix` 4.2 (Admin API **2026-04**) |
| Database | PostgreSQL 13+ via [Prisma](https://www.prisma.io/) 6 |
| Email | [Resend](https://resend.com) |
| Validation | [Zod](https://zod.dev/) |
| Language | TypeScript 5 |

---

## Prerequisites

- **Node.js** ≥ 20.10 (an `.nvmrc` is included — `nvm use` to pick it up).
- **PostgreSQL** ≥ 13 — locally or via the bundled `docker-compose.yml`.
- A **Shopify Partner account** ([create one](https://partners.shopify.com/)) and a development store.
- A **Resend** account for transactional email ([sign up](https://resend.com)).

The Shopify CLI is bundled as a devDependency, so you do **not** need to install it globally.

---

## Quick start (local development)

```bash
# 1. Clone
git clone https://github.com/aargonlab/self-service-return.git
cd self-service-return

# 2. Install dependencies (also installs the Shopify CLI locally)
npm install

# 3. Configure environment
cp .env.example .env
# then edit .env — see "Environment variables" below

# 4. Start PostgreSQL (skip if you already have one running)
docker compose up -d

# 5. Generate the Prisma client and apply migrations
npm run setup

# 6. Link this repo to a Shopify app in your Partner Dashboard
#    (creates a shopify.app.<handle>.toml from your Partner config)
npm run config:link

# 7. Start the dev server (Shopify CLI tunnels and opens the dev store)
npm run dev
```

`npm run dev` will:
- launch the Remix dev server,
- tunnel it through the Shopify CLI,
- install / update the app on your development store,
- open the embedded admin in your browser.

---

## Configuration

### Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `SHOPIFY_API_KEY` | yes | Client ID from the Shopify Partner Dashboard. |
| `SHOPIFY_API_SECRET` | yes | Client secret from the Partner Dashboard. |
| `SHOPIFY_APP_URL` | yes | Public URL where the app is hosted (the Shopify CLI sets this automatically in `dev`). |
| `APP_URL` | yes | Same as `SHOPIFY_APP_URL` for most deployments. Used for portal and email links. |
| `SCOPES` | yes | Comma-separated OAuth scopes (must match `shopify.app.toml`). |
| `RESEND_API_KEY` | yes | API key from [Resend](https://resend.com). |
| `EMAIL_FROM` | yes | Verified sender address for transactional email. |
| `CREDENTIALS_ENCRYPTION_KEY` | yes | 32-byte hex string (`openssl rand -hex 32`). Used for AES-256-GCM. |
| `SESSION_SECRET` | yes | 32+ char random string. |
| `OTP_HASH_SECRET` | no | HMAC secret for OTP hashing. Falls back to `SESSION_SECRET`. |
| `ENCRYPTION_SALT` | no | Custom salt for credential key derivation. |

> Generate a strong secret quickly with `openssl rand -hex 32`.

### Shopify scopes

The default recommended scopes:

```
read_orders,write_orders,read_customers,read_returns,write_returns,read_products,read_markets,write_draft_orders,read_merchant_managed_fulfillment_orders,read_third_party_fulfillment_orders
```

`app/shopify.server.ts` validates these at startup and warns on unknown scopes.

### Shopify app config

`shopify.app.toml.example` is included as a reference. The recommended path is to let the Shopify CLI generate the real file for you:

```bash
npm run config:link    # creates shopify.app.<handle>.toml
npm run config:use     # switches between linked configs (multi-environment)
```

The generated `shopify.app.<handle>.toml` is gitignored — each developer / environment has its own.

The Admin API version is pinned in `app/shopify.server.ts` and `vite.config.ts`. Update both files if you bump it.

---

## Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Remix + Shopify CLI tunnel against your dev store. |
| `npm run build` | Production build (Remix + Vite). |
| `npm start` | Serve the production build (`remix-serve`). |
| `npm run setup` | `prisma generate` + `prisma migrate deploy`. |
| `npm run typecheck` | Run `tsc --noEmit`. |
| `npm run lint` | ESLint with cache. |
| `npm run config:link` | Link this repo to an app in your Shopify Partner Dashboard. |
| `npm run config:use` | Switch the active linked config. |
| `npm run deploy` | `shopify app deploy` — push extensions / config to the Partner Dashboard. |
| `npm run env` | Inspect / pull env values from the linked Shopify app. |
| `npm run generate` | Scaffold a new Shopify extension via the CLI. |
| `npm run docker-start` | `setup` then `start` — used as the Docker entrypoint. |

---

## Production build

```bash
npm install
npm run setup        # prisma generate + migrate deploy
npm run build
npm start            # serves on $PORT (default 3000)
```

The build output lives in `build/` and contains both the server and client bundles.

---

## Docker

A multi-stage `Dockerfile` and a `docker-compose.yml` (Postgres only) are included.

```bash
# Run a local Postgres for development
docker compose up -d

# Build and run the app image
docker build -t self-service-return .
docker run --rm -p 3000:3000 --env-file .env self-service-return
```

The container's `CMD` runs `npm run docker-start` which executes Prisma migrations before starting the server.

---

## Deploying to Fly.io

A `fly.toml` is included. Typical first deploy:

```bash
flyctl launch --copy-config --no-deploy
flyctl postgres create               # or attach an external Postgres
flyctl secrets set \
  SHOPIFY_API_KEY=... \
  SHOPIFY_API_SECRET=... \
  SHOPIFY_APP_URL=https://<your-app>.fly.dev \
  APP_URL=https://<your-app>.fly.dev \
  SCOPES="read_orders,write_orders,read_customers,read_returns,write_returns,read_products,read_markets,write_draft_orders,read_merchant_managed_fulfillment_orders,read_third_party_fulfillment_orders" \
  RESEND_API_KEY=... \
  EMAIL_FROM=returns@yourdomain.com \
  CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  SESSION_SECRET=$(openssl rand -hex 32)
flyctl deploy
```

Then update the `application_url` and redirect URLs in your Shopify Partner Dashboard (or in `shopify.app.<handle>.toml` and `npm run deploy`) to point at the Fly URL.

---

## Architecture

```
app/
├── routes/
│   ├── app.*           Embedded Shopify admin (Polaris + App Bridge)
│   ├── returns.*       Public customer portal (Tailwind)
│   ├── api.v1.*        REST API for external integrations
│   └── webhooks.tsx    Shopify webhook handler
├── services/           Business logic — state machine, policies, email, shipping, …
├── models/             Prisma data access
├── components/         UI (admin + portal)
├── utils/              Validators, constants, encryption, translations
└── shopify.server.ts   Shopify app + Admin API wiring
```

### Highlights
- **State machine** (`services/stateMachine.server.ts`) orchestrates the 12-state return lifecycle.
- **Policy engine** (`services/policyEngine.server.ts`) evaluates per-shop rules to drive auto-approval / rejection.
- **Encryption** (`utils/encryption.server.ts`) wraps Node's `crypto` for AES-256-GCM.
- **Webhooks** are signed with HMAC-SHA256 (see `services/webhook.server.ts`).

---

## API reference

All endpoints live under `/api/v1` and require an `X-API-Key` header. Generate keys from the embedded admin → Settings → API.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/returns` | List returns (filtering + pagination). |
| `POST` | `/api/v1/returns` | Create a return request. |
| `GET` | `/api/v1/returns/:id` | Fetch one return. |
| `PATCH` | `/api/v1/returns/:id` | Update return details. |
| `POST` | `/api/v1/returns/:id/actions` | Approve / reject / close / cancel. |
| `POST` | `/api/v1/returns/:id/comments` | Add a comment. |
| `GET` | `/api/v1/returns/:id/timeline` | Fetch timeline events. |
| `POST` | `/api/v1/returns/:id/label` | Generate a shipping label. |
| `GET` | `/api/v1/settings` | Fetch shop settings. |

Interactive docs are also exposed inside the embedded admin at `/app/api-docs`.

---

## Return state machine

```
SUBMITTED
    │
    ▼
PENDING_REVIEW ──► REJECTED ──► CLOSED
    │
    ▼
APPROVED
    │
    ▼
AWAITING_SHIPMENT
    │
    ▼
IN_TRANSIT
    │
    ▼
RECEIVED
    │
    ▼
REFUNDED ──► CLOSED

(any non-terminal state can transition to CANCELLED)
```

| State | Meaning |
|---|---|
| `SUBMITTED` | Customer just submitted the request. |
| `PENDING_REVIEW` | Awaiting merchant decision. |
| `APPROVED` | Awaiting shipment from customer. |
| `REJECTED` | Merchant rejected the return. |
| `AWAITING_SHIPMENT` | Label generated; not yet shipped. |
| `IN_TRANSIT` | Package on its way back. |
| `RECEIVED` | Items received by merchant. |
| `REFUNDED` | Refund processed. |
| `CLOSED` / `CANCELLED` | Terminal states. |

---

## Internationalization

The customer portal ships with 27 locales. Translations are stored per shop in the `PortalTranslation` model and can be overridden from the embedded admin (Settings → Translations).

Supported out of the box: English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Swedish, Danish, Norwegian, Finnish, Czech, Hungarian, Romanian, Bulgarian, Croatian, Slovak, Slovenian, Lithuanian, Latvian, Estonian, Greek, Turkish, Japanese, Korean, Chinese (Simplified).

---

## Security

- **Credential encryption:** `CREDENTIALS_ENCRYPTION_KEY` is used with AES-256-GCM to encrypt carrier credentials and API keys at rest.
- **Webhook signatures:** outbound webhooks include `X-Webhook-Signature: HMAC-SHA256(secret, body)`.
- **Sessions:** stored in PostgreSQL via `@shopify/shopify-app-session-storage-prisma` with refresh-token rotation.
- **OTPs:** agent-initiated refunds are gated behind a hashed OTP delivered via email.

To report a security vulnerability privately, please open a draft security advisory on GitHub instead of a public issue.

---

## Contributing

1. Fork the repo and create a feature branch (`git checkout -b feat/my-thing`).
2. Run `npm install` and `npm run setup`.
3. Make your changes — keep them focused.
4. Verify before pushing:
   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```
5. Open a PR with a clear description and rationale.

Issues and feature requests are welcome on the [GitHub issue tracker](https://github.com/aargonlab/self-service-return/issues).

---

## License

MIT — see [LICENSE](LICENSE).

Maintained by [aargonlab](https://www.aargonlab.com).
