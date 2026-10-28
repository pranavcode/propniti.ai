# Security review

Reviewed: 2026-10-29 · Scope: application code, public API routes, deployment configuration, dependencies.

## Summary

The app has no real accounts, money movement or stored personal data, so the main risks are abuse of the public AI routes (cost and prompt injection), unsafe file uploads, and leaking secrets. Each is addressed below; remaining gaps are listed at the end.

## Controls in place

| Area | Risk | Control | Where |
| --- | --- | --- | --- |
| AI routes | Cost abuse / denial of wallet | Per-IP rate limit, 20 requests a minute (Cloudflare rate-limiting binding on Workers, in-memory window elsewhere) | `src/lib/guard.ts`, `cloudflare.config.ts` |
| AI routes | Malformed or oversized input | Zod schemas and a 256 KB body cap; invalid input returns 400/413, never reaches a model | `src/lib/requests.ts` |
| Uploads | Malicious or wrong file types | 4 MB cap; type decided by file signature (JPEG, PNG, WebP, PDF), not by the client's name or MIME type; anything else returns 415 | `src/app/api/ai/extract/route.ts` |
| Uploads | Retention of personal data | Files are read in memory and discarded; nothing is stored | same |
| Model output | Prompt injection in invoices or questions | Documents are framed as data in every system prompt; output is schema-validated; a rule-based policy check overrides any model "approve" the rules flag; every payment needs a human | `src/lib/llm.ts` |
| Model output | XSS from model text | Rendered as React text only; no `dangerouslySetInnerHTML` anywhere | `src/components` |
| Errors | Information leakage | Users see a generic "call failed" note; provider error details go to server logs only | `src/lib/llm.ts` |
| Secrets | Keys in the repo | No secrets committed; `.env*` and `.dev.vars*` ignored; Cloudflare secrets set with `wrangler secret put`; placeholder `unset` treated as no key | `.gitignore`, `src/lib/llm.ts` |
| Browser | Clickjacking, sniffing, mixed content | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; `X-Powered-By` removed | `next.config.ts` |
| Forms | Credentials in URLs | Auth forms use POST and stay disabled until hydrated, so a fast submit can't fall back to a GET with fields in the query string | `src/components/marketing/AuthShell.tsx` |
| CI | Supply chain | Locked dependencies (`npm ci`); lint, type check, tests and both builds on every push | `.github/workflows/ci.yml` |

## Dependencies

`npm audit --omit=dev` (2026-10-29): 5 moderate findings, all in `fflate` pulled in through `@vercel/og` → `vinext`. The vulnerable code path (ZIP64 parsing in `unzipSync`) is used by Open Graph image generation, which this app does not use. The only fix offered is a downgrade of vinext; we will take the upstream fix when released. A high-severity finding in Vite's dev-only `launch-editor` was fixed by `npm audit fix`.

## Known gaps

- **No authentication.** Sign-in screens are UI only. Before real data, add an identity provider, server-side sessions and role checks on every route.
- **Client-held demo state.** The assistant receives the portfolio snapshot from the browser. With real data, load it server-side from the signed-in user's scope instead.
- **`'unsafe-inline'` in the CSP.** Required by the current framework hydration. Move to nonce-based CSP when supported by the runtime.
- **Rate limit is per IP and approximate.** Cloudflare's limiter counts per location and is eventually consistent; in a live test, rejections (429) began after about 40 requests in a minute against a limit of 20. Shared networks share a budget, and the in-memory fallback is per instance. Add a WAF rate-limiting rule for a hard cap, and put a shared limiter in front of non-Cloudflare deployments.
