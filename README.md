# Digital Damage Reporting POC

A runnable Cloudflare Workers proof of concept for offline damage reports, approval routing, escalation, and an asynchronous credit-note write. Store users can capture a report with supporting photos while offline; the Worker values it from a server-owned catalogue, routes it through the appropriate approval stages, and writes a simulated credit note asynchronously.

It is deliberately a POC: seeded users replace real SSO, D1 replaces the ERP, and a Durable Object replaces BPMN. The four behaviours to demonstrate are offline-first capture, idempotent sync, approval escalation, and understandable recoverable status.

## What is included

| Concern              | POC implementation                                                      |
| -------------------- | ----------------------------------------------------------------------- |
| Store capture        | Browser form, IndexedDB and a Service Worker outbox                     |
| API and UI           | Cloudflare Worker, HTML-first pages, htmx approval actions              |
| Approval             | One Durable Object state machine per report                             |
| Escalation           | Durable Object alarm                                                    |
| Mock ERP             | D1 reports, SKU value resolver and credit notes                         |
| Duplicate prevention | Client UUID, KV, D1 idempotency table and unique credit note constraint |
| Photos               | Optional R2 upload independent from report sync                         |
| ERP write            | Retryable Cloudflare Queue consumer                                     |

## Application routes

| Route                  | Audience                   | Purpose                                                             |
| ---------------------- | -------------------------- | ------------------------------------------------------------------- |
| `/login`               | Everyone                   | Start a seeded POC session.                                         |
| `/app`                 | Store users                | Create, save, submit, and track damage reports.                     |
| `/reports/:reportId`   | Store users                | View a report's submitted evidence and approval timeline.           |
| `/approvals`           | Regional and Quality users | Review the approval worklist.                                       |
| `/approvals/:reportId` | Regional and Quality users | Review submitted evidence before approving or rejecting.            |
| `/ops`                 | Quality users              | Investigate validation errors, ERP failures, and overdue approvals. |
| `/hello` and `/health` | Everyone                   | Health check returning a correlation ID.                            |

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

| Command                                        | Purpose                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                                  | Start the local Worker.                                                      |
| `npm run db:migrate:local`                     | Apply D1 migrations locally.                                                 |
| `npm run db:migrate:remote`                    | Apply D1 migrations remotely before a Worker deployment.                     |
| `npm run db:seed:local`                        | Add the demo stores, users and products.                                     |
| `npm run db:seed:remote`                       | Add or refresh the remote demo users and products.                           |
| `npm run db:simulate:deactivate-product:local` | Temporarily deactivate a local seed product for the offline-validation demo. |
| `npm run db:simulate:reactivate-product:local` | Restore the local seed product after the demo.                               |
| `npm run typecheck`                            | Type-check the Worker.                                                       |
| `npm test`                                     | Run the unit suite and Worker integration tests.                             |
| `npm run lint`                                 | Lint Worker TypeScript under `src/`.                                         |
| `npm run format:check`                         | Verify Prettier formatting across the repository.                            |
| `npm run format`                               | Apply Prettier formatting across the repository.                             |
| `npm run types`                                | Regenerate Cloudflare binding types after Wrangler changes.                  |
| `npm run types:check`                          | Verify generated Cloudflare binding types are current.                       |
| `npm run logs:tail`                            | Tail structured Worker logs as JSON in a second terminal.                    |
| `npm run deploy:check`                         | Bundle and validate the deploy configuration without deploying.              |
| `npm run deploy`                               | Migrate remote D1, then deploy the Worker.                                   |

## Sign in and use the app

`/login` presents three seeded users. There are no passwords in this POC.

| User          | Role             | Use it for                                              |
| ------------- | ---------------- | ------------------------------------------------------- |
| Zoe Store     | Store user       | Create reports and view their business status.          |
| Rene Regional | Regional manager | Approve or reject Zurich reports at the regional stage. |
| Quinn Quality | Quality          | Approve/reject high-value reports and view `/ops`.      |

After choosing Zoe Store, `/app` opens the capture form.

1. The editor starts disabled. Select **New report**, or choose **Continue editing** on a saved draft, to unlock it.
2. To pause work, select **Save draft** at any point. Incomplete fields and optional photos remain only on the device; drafts do not sync or enter approval. The editor returns to its disabled state.
3. To submit a report, add one or more complete line items. Each needs a product, quantity, and reason, plus optional additional details for approvers. A photo is optional. The system records the report timestamp automatically.
4. Select **Submit report**. The same local draft UUID is promoted to **Pending Sync**, and the editor returns to its disabled state. The Worker calculates the total; the browser never supplies one.

**Cancel editing** abandons the current unsaved insert or changes to an open draft and returns the editor to its disabled state. A previously saved draft remains available in **My reports**.

The browser creates the report UUID before sending anything and saves every draft to IndexedDB first. Drafts can be continued or discarded from **My reports**. The report list is therefore the source of immediate feedback, whether online or offline.

### Barcode and SKU capture

Each damage-item row supports three equivalent ways to select a product:

1. Scan a physical barcode with a keyboard-wedge handheld scanner. The scanner enters the EAN/UPC and sends Enter; the mapped product is selected automatically.
2. Select **Scan** to use the device camera, grant permission, then point it at the barcode. The POC requests the rear camera and supports common retail formats (EAN, UPC, Code 128, and Code 39).
3. Type the SKU manually or use the **Product** picker.

The product catalogue stores both the internal SKU and an optional physical barcode. It is cached in IndexedDB after an online visit, so hardware or camera scans can still resolve products after a page reload while offline. The browser's native camera barcode API is experimental and not available in every browser; when it is unavailable or camera permission is denied, the report remains fully usable with a handheld scanner, typed SKU, or product picker.

### Authoritative POC pricing

The store never enters a total. At synchronisation, the Worker looks up the selected SKUs in its server-owned POC catalogue, calculates the gross CHF total from quantity × unit value, and snapshots the SKU, product name, unit price, tax rate, currency, line total, tax amount, and report total. Approval routing reads that immutable snapshot, so a later catalogue-price change cannot change an in-flight claim.

The remote POC catalogue contains the following simulated, gross retail-like values. All prices include 2.6% VAT and are stored in CHF cents.

| SKU        | Product                          | Barcode         | Unit price | Availability |
| ---------- | -------------------------------- | --------------- | ---------- | ------------ |
| `10111205` | Raspberry Teddy Eddie            | `7612345678908` | CHF 19.90  | Active       |
| `10110895` | Dark Teddy Eddie                 | `7612345678917` | CHF 19.90  | Active       |
| `10109660` | Milk Tablet 36%                  | `7612345678926` | CHF 7.50   | Active       |
| `10109667` | Single Origin Brazil Tablet 70 % | `7612345678898` | CHF 7.50   | Active       |

The values provide plausible demonstration thresholds, not a claim about the products' real prices.

In production, the same resolver interface derives and snapshots value, currency, tax, source order/delivery, and product data from Comarch. The POC has no Comarch access, so it intentionally uses the catalogue instead of asserting a source-document lookup.

### Quick barcode test

In the deployed POC, sign in as **Zoe Store**, open `/app`, and either use **Scan** or type one of the active remote-catalogue barcodes:

| Barcode         | Expected result                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `7612345678908` | Green **Selected 10111205 — Raspberry Teddy Eddie · CHF 19.90 incl. VAT** message and automatic product selection.           |
| `7612345678917` | Green **Selected 10110895 — Dark Teddy Eddie · CHF 19.90 incl. VAT** message and automatic product selection.                |
| `7612345678926` | Green **Selected 10109660 — Milk Tablet 36% · CHF 7.50 incl. VAT** message and automatic product selection.                  |
| `7612345678898` | Green **Selected 10109667 — Single Origin Brazil Tablet 70 % · CHF 7.50 incl. VAT** message and automatic product selection. |

Scanning an unknown code produces a clear inline message and does not block manual selection. The barcodes are POC data; replace `products.barcode` with actual product barcodes for a real integration.

## Demonstration flows

### 1. Offline capture and automatic sync

1. Visit `/app` once while online so the browser can install the Service Worker and cache the app shell.
2. In browser developer tools, select **Offline** (or disconnect the network).
3. Create a complete report with an active product such as `10111205`, then select **Submit report**.
4. It appears immediately as **Pending Sync**. Reloading the page does not remove it. A saved **Draft** remains local after connectivity returns until the store submits it.
5. Restore connectivity. Background Sync or the browser `online` event posts the existing UUID automatically; the status updates without pressing submit again.

The capture form is present in the cached document, so a fresh offline reload does not depend on an htmx request or external CDN asset.

### 2. Approval routing

Create reports with these quantities using the simulated catalogue values:

| Items            | Calculated total | Expected path                                                                   |
| ---------------- | ---------------- | ------------------------------------------------------------------------------- |
| 10 × `10111205`  | CHF 199.00       | Auto-approved, then **Credit Note Processing** and **Completed**.               |
| 11 × `10110895`  | CHF 218.90       | **With Regional Manager**; Rene can approve or reject it.                       |
| 134 × `10109660` | CHF 1,005.00     | Rene must approve first, then it becomes **With Quality Management** for Quinn. |

Sign in as the appropriate approver and open `/approvals`. Select a report reference to inspect its line items, descriptions, and photos before deciding. Each available report has **Approve** and **Reject** controls. Rejection requires a reason, which appears in the store view.

Report details include an approval timeline. It records the submitted time and every Regional or Quality approval/rejection with its date and time.

The CHF 200 auto-approval assumption is configurable. Set this in `.dev.vars`, then restart `npm run dev`:

```dotenv
AUTO_APPROVE_BELOW_REGIONAL=false
```

### 3. Escalation

For a quick demo, the checked-in configuration escalates an unanswered stage after 120 seconds. Create a Regional or Quality threshold report from the table above and leave the current approval step untouched. The store and approval lists show that it is escalated to the fallback **Quality Management** role.

Change the local demo delay before starting Wrangler if needed:

```dotenv
ESCALATION_DEMO_DELAY_SECONDS=10
```

An approval or rejection before the alarm fires cancels the escalation. The documented business policy is three working days; holiday/deputy logic is intentionally outside this POC.

### 4. Server-side validation after offline capture

This proves that browser validation is not authoritative.

This local-only simulation uses the POC seed catalogue; it does not alter or describe the remote product catalogue above.

1. Start a report using an active product in the local POC while offline, but do not reconnect it yet.
2. In another terminal run `npm run db:simulate:deactivate-product:local`.
3. Reconnect the browser.
4. The server stores a visible, retryable `sync_error` with `product_inactive`; it does not start approval.
5. Run `npm run db:simulate:reactivate-product:local`, then choose **Retry now** in the store view.

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

`credit_note_pending` means that the credit note has been approved for creation and is waiting for, or being handled by, the ERP-write process.

| Store label                | Internal states                      |
| -------------------------- | ------------------------------------ |
| Pending Sync               | `pending_sync`                       |
| With Regional Manager      | `submitted`, `pending_regional`      |
| With Quality Management    | `pending_quality`                    |
| Credit Note Processing     | `approved`, `credit_note_pending`    |
| Completed                  | `completed`                          |
| Rejected                   | `rejected`, with the supplied reason |
| Needs attention — retrying | `sync_error`, `erp_error`            |

The Service Worker polls the store's reports every 15 seconds. It updates locally-created reports and hydrates reports made in another session for the same store.

## Operations and troubleshooting

Sign in as Quinn Quality and open <http://localhost:8787/ops>. It lists:

- reports blocked by validation/sync errors;
- pending or failed ERP writes; and
- escalated approvals that remain unresolved.

Every Worker response includes `X-Correlation-Id`. State transitions are emitted as JSON logs with the report ID, correlation ID, actor, from-state, and to-state. Wrangler enables full observability sampling for this POC, so use `npm run logs:tail` during a customer demo to follow the same correlation ID through the Worker, Durable Object, and Queue consumer. Retry defaults are defined in [src/lib/observability.ts](src/lib/observability.ts).

If the local app does not start:

1. Ensure `.dev.vars` exists and contains a non-empty `JWT_SECRET`.
2. Re-run migrations and seeds.
3. Check `npm run typecheck`.
4. Use a fresh browser profile or clear this application's site data only if you intentionally want to remove offline reports held in IndexedDB.

## Deploy to Cloudflare

Deploy the whole application to **one Cloudflare Worker**. The Worker serves the HTML/API and uploads `public/` as static assets, keeping authentication, the Service Worker, htmx, and `/api/*` requests on one origin.

The checked-in `wrangler.toml` targets the configured POC resources. To deploy it, authenticate to the owning Cloudflare account and set its signing secret:

```bash
npx wrangler login
npx wrangler secret put JWT_SECRET
```

For a separate account or environment, create a D1 database, KV namespace, R2 bucket, and Queue; replace the corresponding IDs and names in `wrangler.toml`; then set `JWT_SECRET` for that Worker. Durable Objects are declared in the Worker configuration and are provisioned on deployment.

Initialize a fresh remote database, validate the bundle, then deploy:

```bash
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy:check
npm run deploy
```

On later deployments, `npm run deploy` applies pending D1 migrations before uploading the Worker. Wrangler prints the resulting `workers.dev` URL.

Do not deploy `.dev.vars`; it is local-only and ignored by Git.

## Intentional POC limits

This is not production authentication or ERP integration. It excludes real SSO, password management, rate limiting, multi-tenant isolation, public-holiday calendars, deputy/absence management, and a real ERP API. The seeded accounts and mock resources exist solely to demonstrate the workflow safely. The POC SKU price is a controlled stand-in for Comarch order/delivery-line valuation; it is not a production pricing model.
