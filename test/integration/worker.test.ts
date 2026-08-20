import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const schema = `
CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, store_id TEXT);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, sku TEXT NOT NULL, barcode TEXT, name TEXT NOT NULL, active INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, reporter_id TEXT NOT NULL, status TEXT NOT NULL, total_amount INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, validation_error_code TEXT, rejection_reason TEXT, escalated_at TEXT, escalation_target_role TEXT);
CREATE TABLE IF NOT EXISTS line_items (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL, reason_code TEXT NOT NULL, photo_id TEXT);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, line_item_id TEXT NOT NULL, r2_key TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_notes (id TEXT PRIMARY KEY, report_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, erp_document_id TEXT);
CREATE TABLE IF NOT EXISTS idempotency_keys (key TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL);
DELETE FROM credit_notes; DELETE FROM photos; DELETE FROM line_items; DELETE FROM reports; DELETE FROM idempotency_keys; DELETE FROM products; DELETE FROM users; DELETE FROM stores;
INSERT INTO stores VALUES ('store-zurich-01', 'Zurich Central', 'north');
INSERT INTO users VALUES ('user-store-zurich', 'Zoe Store', 'store', 'store-zurich-01'), ('user-regional-north', 'Rene Regional', 'regional_manager', 'store-zurich-01'), ('user-quality-hq', 'Quinn Quality', 'quality', NULL);
INSERT INTO products VALUES ('product-100', 'SKU-100', '7612345678908', 'Sparkling Water', 1);
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

  it("submits idempotently and routes a CHF 1,000 report through both approvals", async () => {
    const reportId = "report-lifecycle-1000";
    const payload = {
      id: reportId,
      storeId: "store-zurich-01",
      reporterId: "user-store-zurich",
      reportDate: "2026-08-20",
      totalAmountCents: 100_000,
      items: [{ id: "line-lifecycle-1000", productId: "product-100", quantity: 1, reasonCode: "damaged" }],
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

    const regionalCookie = await login("user-regional-north");
    const regional = await SELF.fetch(`https://example.com/api/reports/${reportId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: regionalCookie },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(regional.status).toBe(200);
    expect(((await regional.json()) as { status: string }).status).toBe("pending_quality");

    const qualityCookie = await login("user-quality-hq");
    const quality = await SELF.fetch(`https://example.com/api/reports/${reportId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: qualityCookie },
      body: JSON.stringify({ decision: "reject", reason: "Quality review rejected the claim" }),
    });
    expect(quality.status).toBe(200);
    expect(((await quality.json()) as { status: string }).status).toBe("rejected");
  });
});
