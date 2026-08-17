# Digital Damage Reporting POC

A runnable Cloudflare Workers proof of concept for offline damage reports, approval routing, escalation, and an asynchronous credit-note write.

It is deliberately a POC: seeded users replace real SSO, D1 replaces the ERP, and a Durable Object replaces BPMN. The four behaviours to demonstrate are offline-first capture, idempotent sync, approval escalation, and understandable recoverable status.

## What is included

| Concern | POC implementation |
| --- | --- |
| Store capture | Browser form, IndexedDB and a Service Worker outbox |
| API and UI | Cloudflare Worker, HTML-first pages, htmx approval actions |
| Approval | One Durable Object state machine per report |
| Escalation | Durable Object alarm |
| Mock ERP | D1 reports, products and credit notes |
| Duplicate prevention | Client UUID, KV, D1 idempotency table and unique credit note constraint |
| Photos | Optional R2 upload independent from report sync |
| ERP write | Retryable Cloudflare Queue consumer |

## Prerequisites

- Node.js 20 or newer
- npm
- A Cloudflare account is only required for deployment; local development uses Wrangler's local resources.

## Run locally

From the project directory:

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Open <http://localhost:8787/login>. The health endpoint is available at <http://localhost:8787/hello>.

The migration and seed commands are safe to run again. Local D1 data is stored in Wrangler's `.wrangler` directory; delete that directory only when you deliberately want a completely fresh local environment.

### Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Worker. |
| `npm run db:migrate:local` | Apply D1 migrations locally. |
| `npm run db:seed:local` | Add the demo stores, users and products. |
| `npm run db:simulate:deactivate-product:local` | Make `SKU-200` inactive for the offline-validation demo. |
| `npm run db:simulate:reactivate-product:local` | Restore `SKU-200`. |
| `npm run typecheck` | Type-check the Worker. |
| `npm test` | Run the CHF routing policy tests. |
| `npx wrangler deploy --dry-run` | Bundle and validate the deploy configuration without deploying. |

## Sign in and use the app

`/login` presents three seeded users. There are no passwords in this POC.

| User | Role | Use it for |
| --- | --- | --- |
| Zoe Store | Store user | Create reports and view their business status. |
| Rene Regional | Regional manager | Approve or reject Zurich reports at the regional stage. |
| Quinn Quality | Quality | Approve/reject high-value reports and view `/ops`. |

After choosing Zoe Store, `/app` opens the capture form.

1. Enter a date and total in CHF.
2. Add one or more line items. Each needs a product, quantity, and reason. A photo is optional.
3. Select **Save report**.

The browser creates the report UUID before sending anything and saves the complete report to IndexedDB first. The report list is therefore the source of immediate feedback, whether online or offline.

## Demonstration flows

### 1. Offline capture and automatic sync

1. Visit `/app` once while online so the browser can install the Service Worker and cache the app shell.
2. In browser developer tools, select **Offline** (or disconnect the network).
3. Create a report with an active product such as `SKU-100`.
4. It appears immediately as **Pending Sync**. Reloading the page does not remove it.
5. Restore connectivity. Background Sync or the browser `online` event posts the existing UUID automatically; the status updates without pressing submit again.

The capture form is present in the cached document, so a fresh offline reload does not depend on an htmx request or external CDN asset.

### 2. Approval routing

Create reports using these totals:

| Total | Expected path |
| --- | --- |
| CHF 150 | Auto-approved, then **Credit Note Processing** and **Completed**. |
| CHF 250 | **With Regional Manager**; Rene can approve or reject it. |
| CHF 1,000 | Rene must approve first, then it becomes **With Quality Management** for Quinn. |

Sign in as the appropriate approver and open `/approvals`. Each available report has **Approve** and **Reject** controls. Rejection requires a reason, which appears in the store view.

The CHF 200 auto-approval assumption is configurable. Set this in `.dev.vars`, then restart `npm run dev`:

```dotenv
AUTO_APPROVE_BELOW_REGIONAL=false
```

### 3. Escalation

For a quick demo, the checked-in configuration escalates an unanswered stage after 120 seconds. Create a CHF 250 or CHF 1,000 report and leave the current approval step untouched. The store and approval lists show that it is escalated to the fallback **Quality Management** role.

Change the local demo delay before starting Wrangler if needed:

```dotenv
ESCALATION_DEMO_DELAY_SECONDS=10
```

An approval or rejection before the alarm fires cancels the escalation. The documented business policy is three working days; holiday/deputy logic is intentionally outside this POC.

### 4. Server-side validation after offline capture

This proves that browser validation is not authoritative.

1. Start a report using `SKU-200` while offline, but do not reconnect it yet.
2. In another terminal run `npm run db:simulate:deactivate-product:local`.
3. Reconnect the browser.
4. The server stores a visible, retryable `sync_error` with `product_inactive`; it does not start approval.
5. Run `npm run db:simulate:reactivate-product:local`, then choose **Retry now** in the store view.

`SKU-300` is already inactive and can be used for a simpler validation-error check.

### 5. Idempotency

The same report UUID is used as both the report ID and `Idempotency-Key`. Replayed sync requests return the original report instead of creating another. Approval enqueueing is similarly protected: `credit_notes.report_id` is unique, so Queue redelivery cannot create a duplicate credit note.

### 6. Simulated ERP failure

Set the following in `.dev.vars`, restart the Worker, and approve a report:

```dotenv
ERP_FAILURE_RATE=1
ERP_MAX_RETRIES=3
```

The Queue retries the mock ERP write. Once the limit is reached, the report becomes a visible, retryable **Needs attention** state (`erp_error` internally), rather than being silently lost. Restore `ERP_FAILURE_RATE=0` for normal demos.

## Status shown to the store

The UI does not expose raw implementation errors or enum names.

| Store label | Internal states |
| --- | --- |
| Pending Sync | `pending_sync` |
| With Regional Manager | `submitted`, `pending_regional` |
| With Quality Management | `pending_quality` |
| Credit Note Processing | `approved`, `credit_note_processing` |
| Completed | `completed` |
| Rejected | `rejected`, with the supplied reason |
| Needs attention — retrying | `sync_error`, `erp_error` |

The Service Worker polls the store's reports every 15 seconds. It updates locally-created reports and hydrates reports made in another session for the same store.

## Operations and troubleshooting

Sign in as Quinn Quality and open <http://localhost:8787/ops>. It lists:

- reports blocked by validation/sync errors;
- pending or failed ERP writes; and
- escalated approvals that remain unresolved.

Every Worker response includes `X-Correlation-Id`. State transitions are emitted as JSON logs with the report ID, correlation ID, actor, from-state, and to-state. Retry defaults live in [src/lib/observability.ts](src/lib/observability.ts).

If the local app does not start:

1. Ensure `.dev.vars` exists and contains a non-empty `JWT_SECRET`.
2. Re-run migrations and seeds.
3. Check `npm run typecheck`.
4. Use a fresh browser profile or clear this application's site data only if you intentionally want to remove offline reports held in IndexedDB.

## Deploy to Cloudflare

Deploy the whole application to **one Cloudflare Worker**. The Worker serves the
HTML/API and uploads `public/` as static assets, keeping authentication, Service
Worker, htmx, and `/api/*` requests on one origin. GitHub Pages is useful for the
source repository, but is not suitable for hosting this app separately.

1. Authenticate Wrangler: `npx wrangler login`.
2. Create production resources, using names unique to the Cloudflare account:

   ```bash
   npx wrangler d1 create damage-reporting-prod
   npx wrangler kv namespace create IDEMPOTENCY
   npx wrangler r2 bucket create damage-reporting-photos-prod
   npx wrangler queues create erp-write-queue-prod
   ```

3. Update `wrangler.toml` with the D1 `database_name`/`database_id`, KV namespace
   `id`, R2 `bucket_name`, and Queue name returned or chosen above. Durable Objects
   are declared in the same Worker configuration and are provisioned by deployment.
4. Set the production signing secret: `npx wrangler secret put JWT_SECRET`.
5. Apply the D1 schema and seed the demo users/products remotely:

   ```bash
   npx wrangler d1 migrations apply damage-reporting-prod --remote
   npx wrangler d1 execute damage-reporting-prod --remote --file=seed/seed.sql
   ```

6. Validate the bundle with `npx wrangler deploy --dry-run`, then deploy with
   `npm run deploy`. Wrangler prints the resulting `workers.dev` URL.

Do not deploy `.dev.vars`; it is local-only and ignored by Git.

## Intentional POC limits

This is not production authentication or ERP integration. It excludes real SSO, password management, rate limiting, multi-tenant isolation, public-holiday calendars, deputy/absence management, and a real ERP API. The hardcoded role claims and mock resources exist solely to demonstrate the workflow safely.
