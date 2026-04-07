# Self Service Return

**A self-service returns management platform for Shopify merchants**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Shopify](https://img.shields.io/badge/Shopify-Embedded%20App-green)](https://shopify.dev)
[![Made by aargonlab](https://img.shields.io/badge/Made%20by-aargonlab-orange)](https://www.aargonlab.com)

A complete, open-source returns management solution that empowers Shopify merchants with branded customer portals, intelligent policy automation, and comprehensive backoffice tools for managing returns, refunds, and exchanges.

Created and maintained by [aargonlab](https://www.aargonlab.com).

---

## Features

### Customer Experience
- **Branded Self-Service Portal**: Mobile-responsive return portal with customizable branding (logo, colors, fonts)
- **Multi-language Support**: 27 languages supported out of the box
- **Order Lookup**: Search by order number + email, or authenticate with customer account
- **Smart Eligibility Check**: Real-time validation of return windows and policy compliance
- **Serial Number Tracking**: Optional serial number selection for ERP-integrated workflows
- **Attachment Support**: Customers can upload images for item condition documentation
- **Real-time Status Updates**: Track return progress from submission to refund

### Merchant Management
- **Embedded Shopify Admin**: Seamless Polaris-based interface within Shopify Admin
- **Policy Engine**: Configurable rules for auto-approval, auto-rejection, and manual review triggers
- **State Machine**: Structured return lifecycle management with 12 distinct states
- **Return Routing**: Multi-warehouse support with market-based routing rules
- **Shipping Label Generation**: Optional integration with ProcessWeaver for automated label creation
- **Exchange Management**: Create replacement orders directly from return requests
- **Refund OTP Verification**: Secure agent-initiated refunds with email verification
- **Custom Return Reasons**: Define reason codes with market-specific visibility
- **Timeline & Audit Trail**: Complete history of all actions and state transitions

### Integrations & API
- **REST API v1**: Full CRUD operations for external systems
- **Webhook System**: HMAC-SHA256 signed webhooks for real-time event notifications
- **Shopify Sync**: Bidirectional sync with Shopify Orders and Returns API
- **ProcessWeaver Integration**: Carrier-agnostic shipping label generation (FedEx, UPS, DHL, Canada Post, etc.)
- **Email Notifications**: Transactional emails via Resend (confirmation, approval, rejection, refund)

### Security & Compliance
- **AES-256-GCM Encryption**: Secure credential storage for carrier accounts and API keys
- **GDPR-Compliant**: Data retention controls and audit logging
- **HMAC Webhooks**: Cryptographically signed outbound webhooks
- **Role-Based Access Control**: Shop-scoped data isolation and session management

---

## Screenshots

*Screenshots coming soon*

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: 18+ or 20+ (recommended)
- **PostgreSQL**: 13+ (or Docker container)
- **Shopify Partner Account**: [Create one here](https://partners.shopify.com/)
- **Shopify CLI**: Install via `npm install -g @shopify/cli`

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/self-service-return.git
cd self-service-return
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and configure the following:

```bash
cp .env.example .env
```

See the [Configuration](#configuration) section for detailed descriptions of all environment variables.

### 4. Database Setup

Run Prisma migrations to set up your PostgreSQL database:

```bash
npx prisma migrate deploy
npx prisma generate
```

### 5. Create a Shopify App

Use the Shopify CLI to configure your app:

```bash
npm run shopify app config link
```

Follow the prompts to connect your Partner account and create a new app (or link to an existing one).

### 6. Start Development Server

```bash
npm run dev
```

This will:
- Start the Remix dev server
- Tunnel the app via Shopify CLI
- Open the app in your development store

---

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string (e.g., `postgresql://user:pass@localhost:5432/dbname`) | Yes |
| `SHOPIFY_API_KEY` | Your Shopify app's API key from Partner Dashboard | Yes |
| `SHOPIFY_API_SECRET` | Your Shopify app's API secret | Yes |
| `SCOPES` | Comma-separated Shopify API scopes (see recommended scopes below) | Yes |
| `APP_URL` | Public URL where your app is hosted (e.g., `https://returns.yourshop.com`) | Yes |
| `SHOPIFY_APP_URL` | Shopify app URL (same as APP_URL for most deployments) | Yes |
| `RESEND_API_KEY` | API key from [Resend](https://resend.com) for email notifications | Yes |
| `EMAIL_FROM` | Sender email address (must be verified in Resend) | Yes |
| `CREDENTIALS_ENCRYPTION_KEY` | 32-byte hex string for AES-256 encryption of stored credentials | Yes |
| `SESSION_SECRET` | Secret for signing session cookies (32+ random characters) | Yes |
| `OTP_HASH_SECRET` | HMAC secret for OTP hashing (falls back to SESSION_SECRET if not set) | No |
| `ENCRYPTION_SALT` | Custom salt for key derivation (optional, auto-generated if not provided) | No |

### Recommended Shopify Scopes

```
read_orders,write_orders,read_customers,read_returns,write_returns,read_products,read_markets,write_draft_orders,read_merchant_managed_fulfillment_orders,read_third_party_fulfillment_orders
```

---

## Architecture

This application is built with a clean, layered architecture:

### Application Layer (`app/routes/`)
- **Admin Routes (`app.*`)**: Embedded Shopify app built with Polaris 13 and App Bridge
  - Dashboard, returns management, policy configuration, settings
- **Customer Portal (`returns.*`)**: Public-facing portal built with Tailwind CSS
  - Order lookup, return submission, status tracking
- **API Routes (`api.v1.*`)**: RESTful API for external integrations
  - Supports API key authentication and scoped access
- **Webhooks (`webhooks.tsx`)**: Shopify webhook handler for order and return events

### Business Logic Layer (`app/services/`)
- **State Machine**: Orchestrates return lifecycle state transitions
- **Policy Engine**: Evaluates eligibility rules and automation conditions
- **Email Service**: Transactional email delivery via Resend
- **Shipping Service**: ProcessWeaver integration for label generation and tracking
- **Encryption Service**: AES-256-GCM credential encryption/decryption

### Data Access Layer (`app/models/`)
- Prisma-based data access with transaction support
- Models for returns, items, policies, settings, webhooks, shipping labels, serial numbers

### UI Components (`app/components/`)
- **Admin Components**: Shopify Polaris UI components
- **Portal Components**: Tailwind CSS components for customer portal

### Utilities (`app/utils/`)
- Validators (Zod schemas for API requests)
- Constants (status definitions, reason codes)
- Encryption utilities
- Translation system (27 languages)

---

## API Documentation

The app exposes a REST API at `/api/v1/*` for external integrations. Key endpoints include:

- `GET /api/v1/returns` — List returns with filtering and pagination
- `POST /api/v1/returns` — Create a new return request
- `GET /api/v1/returns/:id` — Retrieve a single return
- `PATCH /api/v1/returns/:id` — Update return details
- `POST /api/v1/returns/:id/actions` — Perform actions (approve, reject, close, cancel)
- `POST /api/v1/returns/:id/comments` — Add comments
- `GET /api/v1/returns/:id/timeline` — Retrieve timeline events
- `POST /api/v1/returns/:id/label` — Generate shipping label
- `GET /api/v1/settings` — Retrieve shop settings

### Authentication

API requests require an API key passed in the `X-API-Key` header. API keys can be generated from the admin settings panel.

### Full API Documentation

Interactive API documentation is available at `/app/api-docs` after installing the app in your Shopify store.

---

## Return Status Flow

Returns follow a structured state machine with the following primary flow:

```
SUBMITTED
    |
    v
PENDING_REVIEW ──────┐
    |                │
    v                │ (auto-reject)
APPROVED             │
    |                │
    v                │
AWAITING_SHIPMENT    │
    |                │
    v                │
IN_TRANSIT           │
    |                │
    v                │
RECEIVED             │
    |                │
    v                │
REFUNDED ────────────┤
    |                │
    v                │
CLOSED <─────────────┘
    ^
    |
REJECTED
    |
    v
CLOSED

(Any non-terminal state can transition to CANCELLED)
```

### State Definitions

- **SUBMITTED**: Initial state when customer submits return
- **PENDING_REVIEW**: Awaiting merchant approval (manual or automated)
- **APPROVED**: Merchant approved; awaiting customer to ship items back
- **REJECTED**: Merchant rejected the return
- **AWAITING_SHIPMENT**: Label generated; customer has not shipped yet
- **IN_TRANSIT**: Items are in transit back to merchant
- **RECEIVED**: Merchant received the returned items
- **REFUNDED**: Refund has been processed
- **CLOSED**: Return is finalized (terminal state)
- **CANCELLED**: Customer or system cancelled the return (terminal state)

---

## Internationalization

The customer portal supports 27 languages with automatic locale detection:

**Supported Languages**: English, Spanish, French, German, Italian, Portuguese, Dutch, Polish, Swedish, Danish, Norwegian, Finnish, Czech, Hungarian, Romanian, Bulgarian, Croatian, Slovak, Slovenian, Lithuanian, Latvian, Estonian, Greek, Turkish, Japanese, Korean, Chinese (Simplified)

Translations are managed via the `PortalTranslation` model and can be customized per shop through the admin panel.

---

## Security

### Credential Encryption
All sensitive data (ProcessWeaver API keys, carrier passwords) is encrypted at rest using AES-256-GCM before storage in the database. The encryption key is derived from `CREDENTIALS_ENCRYPTION_KEY` with optional custom salting.

### Webhook Security
Outbound webhooks include an `X-Webhook-Signature` header with HMAC-SHA256 signature for verification:

```
HMAC-SHA256(webhook_secret, request_body)
```

### GDPR Compliance
- Customer PII is scoped to shop-level data
- Audit trail for all data access and modifications
- Data retention policies configurable per shop
- Export and deletion capabilities via API

### Session Management
Sessions are stored in PostgreSQL with automatic expiration. Shopify App OAuth tokens are securely stored with refresh token rotation support.

---

## Contributing

We welcome contributions from the community! Here's how you can help:

### Reporting Issues
- Use [GitHub Issues](https://github.com/your-org/self-service-return/issues) to report bugs or request features
- Provide detailed reproduction steps for bugs
- Include screenshots, logs, or error messages when applicable

### Submitting Pull Requests
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-new-feature`
3. Make your changes following the code style
4. Add tests if applicable
5. Ensure all tests pass: `npm run lint`
6. Commit with clear messages: `git commit -m "feat: add new feature"`
7. Push to your fork: `git push origin feature/my-new-feature`
8. Open a Pull Request with a detailed description

### Development Guidelines
- Follow TypeScript strict mode conventions
- Use Prettier for code formatting
- Add JSDoc comments for public APIs
- Update documentation for user-facing changes
- Keep commits atomic and well-described

### Code of Conduct
Be respectful, inclusive, and professional. We're building a welcoming community for all contributors.

---

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 [aargonlab](https://www.aargonlab.com). You are free to use, modify, and distribute this software for personal or commercial purposes. See the LICENSE file for full terms.

---

## Support

- **Documentation**: [View full docs](https://github.com/your-org/self-service-return/wiki)
- **Issues**: [GitHub Issues](https://github.com/your-org/self-service-return/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/self-service-return/discussions)

---

## Acknowledgments

Built with:
- [Remix](https://remix.run/) - Full-stack web framework
- [Shopify Polaris](https://polaris.shopify.com/) - Admin UI components
- [Prisma](https://www.prisma.io/) - Type-safe database ORM
- [Resend](https://resend.com/) - Email delivery
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework

Made with care by [aargonlab](https://www.aargonlab.com) — designed for developers who want full control over their returns workflow.
