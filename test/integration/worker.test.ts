import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { reportWorkflow } from "../../src/lib/workflow-client";

const schema = `
CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, store_id TEXT);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, sku TEXT NOT NULL, barcode TEXT, name TEXT NOT NULL, active INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'CHF', tax_rate_bps INTEGER NOT NULL DEFAULT 260);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, reporter_id TEXT NOT NULL, status TEXT NOT NULL, total_amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'CHF', tax_amount INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, validation_error_code TEXT, rejection_reason TEXT, escalated_at TEXT, escalation_target_role TEXT);
CREATE TABLE IF NOT EXISTS line_items (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, product_id TEXT NOT NULL, sku_snapshot TEXT NOT NULL DEFAULT '', product_name_snapshot TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL DEFAULT 0, tax_rate_bps INTEGER NOT NULL DEFAULT 0, line_total_amount INTEGER NOT NULL DEFAULT 0, reason_code TEXT NOT NULL, description TEXT, photo_id TEXT);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, line_item_id TEXT NOT NULL, r2_key TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_notes (id TEXT PRIMARY KEY, report_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, erp_document_id TEXT);
CREATE TABLE IF NOT EXISTS approval_events (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, actor_id TEXT NOT NULL, role TEXT NOT NULL, decision TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency_keys (key TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL);
DELETE FROM approval_events; DELETE FROM credit_notes; DELETE FROM photos; DELETE FROM line_items; DELETE FROM reports; DELETE FROM idempotency_keys; DELETE FROM products; DELETE FROM users; DELETE FROM stores;
INSERT INTO stores VALUES ('store-zurich-01', 'Zurich Central', 'north');
INSERT INTO users VALUES ('user-store-zurich', 'Zoe Store', 'store', 'store-zurich-01'), ('user-regional-north', 'Rene Regional', 'regional_manager', 'store-zurich-01'), ('user-quality-hq', 'Quinn Quality', 'quality', NULL);
INSERT INTO products (id, sku, barcode, name, active, unit_price_cents, currency, tax_rate_bps) VALUES ('product-100', 'SKU-100', '7612345678908', 'Sparkling Water', 1, 115, 'CHF', 260), ('product-200', 'SKU-200', '7612345678917', 'Coffee Beans 1kg', 1, 950, 'CHF', 260);
`;

beforeEach(async () => env.DB.exec(schema));

const login = async (username: string) => {
  const response = await SELF.fetch("https://example.com/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return response.headers.get("set-cookie")!;
};

describe("Worker integration", () => {
  it("serves the health route with a correlation ID", async () => {
    const response = await SELF.fetch("https://example.com/hello");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "digital-damage-reporting" });
    expect(response.headers.get("X-Correlation-Id")).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("protects application routes before reaching D1", async () => {
    const response = await SELF.fetch("https://example.com/app");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("uses the route registry to distinguish unknown and role-protected routes", async () => {
    const unauthenticated = await SELF.fetch("https://example.com/unknown-route");
    expect(unauthenticated.status).toBe(401);

    const regionalCookie = await login("user-regional-north");
    const catalog = await SELF.fetch("https://example.com/api/products", {
      headers: { cookie: regionalCookie },
    });
    expect(catalog.status).toBe(403);

    const unknown = await SELF.fetch("https://example.com/unknown-route", {
      headers: { cookie: regionalCookie },
    });
    expect(unknown.status).toBe(404);
  });

  it("renders store, approval, and operations pages through the shared layout", async () => {
    const storeCookie = await login("user-store-zurich");
    const storePage = await SELF.fetch("https://example.com/app", { headers: { cookie: storeCookie } });
    const storeMarkup = await storePage.text();
    expect(storeMarkup).toContain('script type="module" src="/app.js"');
    expect(storeMarkup).toContain('rel="icon" href="/favicon.svg"');
    expect(storeMarkup).toContain('id="new-report"');
    expect(storeMarkup).toContain('id="report-editor" class="report-editor" hidden disabled');
    expect(storeMarkup).toContain("New record");
    expect(storeMarkup).toContain('id="save-draft"');
    expect(storeMarkup).toContain('id="cancel-edit"');
    expect(storeMarkup).toContain('id="confirmation-dialog"');
    expect(storeMarkup).toContain('id="confirmation-confirm"');
    expect(storeMarkup).toContain("data-add-line-item");
    expect(storeMarkup).toContain('aria-label="Remove item"');
    expect(storeMarkup).toContain("data-photo-preview");
    expect(storeMarkup).toContain("Submit report");

    const regionalCookie = await login("user-regional-north");
    const approvalsPage = await SELF.fetch("https://example.com/approvals", { headers: { cookie: regionalCookie } });
    await expect(approvalsPage.text()).resolves.toContain('hx-get="/fragments/approvals"');

    const qualityCookie = await login("user-quality-hq");
    const opsPage = await SELF.fetch("https://example.com/ops", { headers: { cookie: qualityCookie } });
    await expect(opsPage.text()).resolves.toContain('hx-get="/fragments/ops"');
  });

  it("requires a multiline reason only when rejecting an approval", async () => {
    await env.DB.prepare(
      "INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        "report-approval-100",
        "store-zurich-01",
        "user-store-zurich",
        "pending_regional",
        12_500,
        "2026-08-23T10:00:00.000Z",
        "2026-08-23T10:00:00.000Z",
      )
      .run();

    const regionalCookie = await login("user-regional-north");
    const response = await SELF.fetch("https://example.com/fragments/approvals", {
      headers: { cookie: regionalCookie },
    });
    const markup = await response.text();

    expect(markup).toContain('class="approval-form"');
    expect(markup).toContain('class="rejection-form"');
    expect(markup).toContain(
      '<textarea name="reason" rows="3" placeholder="Explain why this report is rejected" required>',
    );
  });

  it("shows escalated Regional reports to Quality for supervision without assigning the decision", async () => {
    await env.DB.prepare(
      "INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at, escalated_at, escalation_target_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        "report-overdue-regional",
        "store-zurich-01",
        "user-store-zurich",
        "pending_regional",
        25_000,
        "2026-08-20T10:00:00.000Z",
        "2026-08-23T10:00:00.000Z",
        "2026-08-23T10:00:00.000Z",
        "quality",
      )
      .run();

    const qualityCookie = await login("user-quality-hq");
    const qualityWorklist = await SELF.fetch("https://example.com/fragments/approvals", {
      headers: { cookie: qualityCookie },
    });
    const qualityMarkup = await qualityWorklist.text();

    expect(qualityMarkup).toContain("Escalations requiring Regional approval");
    expect(qualityMarkup).toContain("report-overdue-regional");
    expect(qualityMarkup).toContain("Awaiting Regional approval — overdue 3 working days.");
    expect(qualityMarkup).toContain("Regional retains ownership of this decision.");
    expect(qualityMarkup).not.toContain("/api/reports/report-overdue-regional/decision");

    const regionalCookie = await login("user-regional-north");
    const regionalWorklist = await SELF.fetch("https://example.com/fragments/approvals", {
      headers: { cookie: regionalCookie },
    });
    await expect(regionalWorklist.text()).resolves.toContain("/api/reports/report-overdue-regional/decision");
  });

  it("links Operations report IDs to the read-only approval detail", async () => {
    const reportId = "report-ops-evidence";
    await env.DB.prepare(
      "INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at, validation_error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        reportId,
        "store-zurich-01",
        "user-store-zurich",
        "sync_error",
        12_500,
        "2026-08-23T10:00:00.000Z",
        "2026-08-23T10:00:00.000Z",
        "product_inactive",
      )
      .run();

    const qualityCookie = await login("user-quality-hq");
    const worklist = await SELF.fetch("https://example.com/fragments/ops", {
      headers: { cookie: qualityCookie },
    });
    await expect(worklist.text()).resolves.toContain(`href="/approvals/${reportId}"`);

    const details = await SELF.fetch(`https://example.com/approvals/${reportId}`, {
      headers: { cookie: qualityCookie },
    });
    expect(details.status).toBe(200);
    await expect(details.text()).resolves.toContain(
      "This report is not currently assigned to your role for a decision.",
    );
  });

  it("shows a helpful message when an htmx approval action is no longer assigned to the approver", async () => {
    await env.DB.prepare(
      "INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        "report-moved-to-quality",
        "store-zurich-01",
        "user-store-zurich",
        "pending_quality",
        12_500,
        "2026-08-23T10:00:00.000Z",
        "2026-08-23T10:00:00.000Z",
      )
      .run();

    const regionalCookie = await login("user-regional-north");
    const response = await SELF.fetch("https://example.com/api/reports/report-moved-to-quality/decision", {
      method: "POST",
      headers: { "HX-Request": "true", cookie: regionalCookie },
      body: new URLSearchParams({ decision: "reject", reason: "No longer relevant" }),
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(
      "This report has moved to Quality review and is no longer assigned to you.",
    );
  });

  it("shows an uploaded item photo on the authenticated report details page", async () => {
    const reportId = "20acd40c-b827-44b6-9755-56a2520dd7f4";
    const lineItemId = "line-photo-100";
    const photoId = "photo-100";
    const photoKey = `reports/${reportId}/${photoId}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        reportId,
        "store-zurich-01",
        "user-store-zurich",
        "submitted",
        12_500,
        "2026-08-23T10:00:00.000Z",
        "2026-08-23T10:00:00.000Z",
      ),
      env.DB.prepare(
        "INSERT INTO line_items (id, report_id, product_id, quantity, reason_code, photo_id) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(lineItemId, reportId, "product-100", 1, "damaged", photoId),
      env.DB.prepare("INSERT INTO photos (id, line_item_id, r2_key, status) VALUES (?, ?, ?, ?)").bind(
        photoId,
        lineItemId,
        photoKey,
        "uploaded",
      ),
    ]);
    await env.PHOTOS.put(photoKey, "photo bytes", { httpMetadata: { contentType: "image/jpeg" } });

    const storeCookie = await login("user-store-zurich");
    const details = await SELF.fetch(`https://example.com/reports/${reportId}`, { headers: { cookie: storeCookie } });
    const detailsMarkup = await details.text();
    expect(detailsMarkup).toContain(reportId);
    expect(detailsMarkup).toContain("CHF 125.00");
    expect(detailsMarkup).toContain(`src="/api/reports/${reportId}/line-items/${lineItemId}/photo"`);

    const photo = await SELF.fetch(`https://example.com/api/reports/${reportId}/line-items/${lineItemId}/photo`, {
      headers: { cookie: storeCookie },
    });
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(new TextDecoder().decode(await photo.arrayBuffer())).toBe("photo bytes");
  });

  it("links approvals to a decision-ready evidence view", async () => {
    const reportId = "report-approval-evidence";
    const lineItemId = "line-approval-evidence";
    const photoId = "photo-approval-evidence";
    const photoKey = `reports/${reportId}/${photoId}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO reports (id, store_id, reporter_id, status, total_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        reportId,
        "store-zurich-01",
        "user-store-zurich",
        "pending_regional",
        12_500,
        "2026-08-23T10:00:00.000Z",
        "2026-08-23T10:00:00.000Z",
      ),
      env.DB.prepare(
        "INSERT INTO line_items (id, report_id, product_id, quantity, reason_code, description, photo_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(lineItemId, reportId, "product-100", 2, "damaged", "Carton was crushed during unloading.", photoId),
      env.DB.prepare("INSERT INTO photos (id, line_item_id, r2_key, status) VALUES (?, ?, ?, ?)").bind(
        photoId,
        lineItemId,
        photoKey,
        "uploaded",
      ),
    ]);
    await env.PHOTOS.put(photoKey, "approval photo", { httpMetadata: { contentType: "image/jpeg" } });

    const regionalCookie = await login("user-regional-north");
    const worklist = await SELF.fetch("https://example.com/fragments/approvals", {
      headers: { cookie: regionalCookie },
    });
    await expect(worklist.text()).resolves.toContain(`href="/approvals/${reportId}"`);

    const details = await SELF.fetch(`https://example.com/approvals/${reportId}`, {
      headers: { cookie: regionalCookie },
    });
    expect(details.status).toBe(200);
    const markup = await details.text();
    expect(markup).toContain("Submitted evidence");
    expect(markup).toContain("SKU-100 — Sparkling Water");
    expect(markup).toContain("Damaged");
    expect(markup).toContain("Carton was crushed during unloading.");
    expect(markup).toContain("Photo available");
    expect(markup).toContain(`src="/api/reports/${reportId}/line-items/${lineItemId}/photo"`);
    expect(markup).toContain('id="approval-decision"');
    expect(markup).toContain('hx-target="#approval-decision"');

    const photo = await SELF.fetch(`https://example.com/api/reports/${reportId}/line-items/${lineItemId}/photo`, {
      headers: { cookie: regionalCookie },
    });
    expect(photo.status).toBe(200);
    expect(new TextDecoder().decode(await photo.arrayBuffer())).toBe("approval photo");
  });

  it("submits idempotently and routes a CHF 1,000 report through both approvals", async () => {
    const reportId = "report-lifecycle-1000";
    const payload = {
      id: reportId,
      storeId: "store-zurich-01",
      reporterId: "user-store-zurich",
      totalAmountCents: 1,
      items: [
        {
          id: "line-lifecycle-1000",
          productId: "product-200",
          quantity: 106,
          reasonCode: "damaged",
          description: "Outer packaging was wet after unloading.",
        },
      ],
    };
    const storeCookie = await login("user-store-zurich");
    const submit = () =>
      SELF.fetch("https://example.com/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: storeCookie, "Idempotency-Key": reportId },
        body: JSON.stringify(payload),
      });

    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM reports").first<{ count: number }>())?.count).toBe(1);
    await expect(
      env.DB.prepare("SELECT total_amount, tax_amount FROM reports WHERE id = ?").bind(reportId).first(),
    ).resolves.toEqual({ total_amount: 100_700, tax_amount: 2_552 });

    const detail = await SELF.fetch(`https://example.com/reports/${reportId}`, {
      headers: { cookie: storeCookie },
    });
    expect(detail.status).toBe(200);
    const detailMarkup = await detail.text();
    expect(detailMarkup).toContain("A read-only record of this submitted damage report.");
    expect(detailMarkup).toContain("Approval timeline");
    expect(detailMarkup).toContain("Outer packaging was wet after unloading.");
    expect(detailMarkup).toContain("SKU-200 — Coffee Beans 1kg");
    expect(detailMarkup).toContain("Quantity");
    expect(detailMarkup).not.toContain("<button");

    const regionalCookie = await login("user-regional-north");
    const regional = await SELF.fetch(`https://example.com/api/reports/${reportId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: regionalCookie },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(regional.status).toBe(200);
    expect(((await regional.json()) as { status: string }).status).toBe("pending_quality");

    const awaitingQualityDetails = await SELF.fetch(`https://example.com/reports/${reportId}`, {
      headers: { cookie: storeCookie },
    });
    const awaitingQualityMarkup = await awaitingQualityDetails.text();
    expect(awaitingQualityMarkup).toContain("Quality approval");
    expect(awaitingQualityMarkup).toContain("Awaiting decision");
    expect(awaitingQualityMarkup).toContain("Decision pending");
    expect(awaitingQualityMarkup).not.toContain("Final decision</strong><span>Approved");

    await reportWorkflow(env, reportId).reconcilePendingStatus("pending_regional");

    const qualityCookie = await login("user-quality-hq");
    const quality = await SELF.fetch(`https://example.com/api/reports/${reportId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: qualityCookie },
      body: JSON.stringify({ decision: "reject", reason: "Quality review rejected the claim" }),
    });
    expect(quality.status).toBe(200);
    expect(((await quality.json()) as { status: string }).status).toBe("rejected");

    const finalDetail = await SELF.fetch(`https://example.com/reports/${reportId}`, {
      headers: { cookie: storeCookie },
    });
    const finalMarkup = await finalDetail.text();
    expect(finalMarkup).toContain("Regional approval");
    expect(finalMarkup).toContain("Quality approval");
    expect(finalMarkup).toContain("Final decision");
    expect(finalMarkup).toContain("Rejected");
    expect(finalMarkup).toContain('class="timeline-rejected"');
  });
});
