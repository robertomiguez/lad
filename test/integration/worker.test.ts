import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
});
