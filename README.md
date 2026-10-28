# Propniti

**AI property operations for US multifamily and commercial portfolios.**
Agents chase rent, check every vendor invoice against its purchase order and keep each lease on track. A person approves anything that moves money.

Live demo: **[propniti.ai](https://propniti.ai)** · runs on sample data, no sign-up needed.

![Property manager dashboard](public/marketing/dashboard.png)

## What it does

| Use case | In the app |
| --- | --- |
| Run more properties per manager | One dashboard: portfolio stats, alerts with one-click actions, live agent activity |
| Vendor work-order automation | The agent compares invoice line items, totals and job photos with the PO; the manager approves or sends it back; the vendor sees the payout and 1099 status |
| Track critical events | Overdue rent and lease renewals become alerts; nudges go out on each person's preferred channel |
| Keep the agent honest | Every result has a confidence score and evidence; a rule-based policy check stops the model approving what the rules flag; every payment needs a human |
| Ask your portfolio | "Who is late on rent?" — answers from your data plus suggested next actions |
| A view per role | Property manager, owner, tenant, maintenance, vendor and admin |

The demo keeps its data in the browser (`localStorage`), so each visitor gets their own sandbox. Use the **Demo** control at the bottom of the app to switch roles; Admin → *Reset demo data* starts over.

## Quick start

Requires Node.js 24.

```bash
npm install
npm run dev          # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run build` | Next.js production build |
| `npm run dev:vinext` | Dev server on the Cloudflare Workers runtime |
| `npm run build:vinext` | Cloudflare Workers build |
| `npm run deploy:vinext` | Deploy to Cloudflare Workers |

## AI providers

AI features run on **built-in mock results by default** — no key required. To use a real model, copy `.env.example` to `.env.local` and set one of:

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Use Claude (default model `claude-opus-5`, override with `ANTHROPIC_MODEL`) |
| `OPENAI_API_KEY` | Use OpenAI (default model `gpt-5.5`, override with `OPENAI_MODEL`) |
| `AI_PROVIDER` | Force `anthropic`, `openai` or `mock` when more than one key is set |

If a key is set but the call fails (bad key, timeout, refusal), the app falls back to the mock result and says so next to it. The rule-based checks in [`src/lib/mockAi.ts`](src/lib/mockAi.ts) double as the policy check on real model output ([`src/lib/llm.ts`](src/lib/llm.ts)).

## Deploy

The app runs on any host; nothing in the application code depends on one cloud.

**Cloudflare Workers** (how propniti.ai is hosted), built with [vinext](https://github.com/cloudflare/vinext):

```bash
npx cf auth login
npm run deploy:vinext
npx wrangler secret put ANTHROPIC_API_KEY   # optional
```

Edit `cloudflare.config.ts` to change the Worker name or custom domains. On the first deploy, pass placeholder secrets (`ANTHROPIC_API_KEY=unset`, etc.) with `npx cf deploy --secrets-file <file>`; the app treats `unset` as "no key".

**Docker** (AWS, GCP, Azure, Fly, Render, Kubernetes…):

```bash
docker build -t propniti .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... propniti
```

## Project layout

```
src/
  app/                 routes: marketing (/), auth (/login, /signup, /forgot-password),
                       demo picker (/demo), one route per role, /api/ai/*
  components/
    marketing/         landing page and auth building blocks
    views/             screens for each role
    Shell.tsx          in-app chrome; DemoSwitcher.tsx is the demo-only role switcher
    ui.tsx             cards, badges, buttons, tables, AI result card
  lib/
    llm.ts             provider selection, real model calls, mock fallback, policy check
    mockAi.ts          rule-based invoice validation and assistant answers
    requests.ts        input validation for the public API routes
    store.tsx          demo state and actions (browser-local)
    seed.ts            sample portfolio
```

## Limits of this demo

- Sign-in and sign-up are screens only: no accounts are created and nothing is sent.
- Payments, SMS, WhatsApp, email and voice are simulated; messages land in each persona's in-app inbox.
- Demo data lives in each browser; there is no shared database.
- The AI routes validate and size-cap input but are not rate limited. Add rate limiting before putting a paid API key behind a public deployment.

## Contributing

Issues and pull requests are welcome. Please run `npm run lint && npm test` before opening a PR.

## License

[GNU Affero General Public License v3.0](LICENSE). You can use, modify and self-host Propniti; if you run a modified version as a network service, you must publish your changes under the same license.
