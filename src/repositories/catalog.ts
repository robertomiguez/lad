import type { PricedProduct } from "../lib/submission-input";

export type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit_price_cents: number;
  currency: string;
  tax_rate_bps: number;
};

export class CatalogRepository {
  constructor(private readonly db: D1Database) {}

  async listActiveProducts() {
    return (
      await this.db
        .prepare(
          "SELECT id, sku, barcode, name, unit_price_cents, currency, tax_rate_bps FROM products WHERE active = 1 ORDER BY sku",
        )
        .all<Product>()
    ).results;
  }

  async findProductsForPricing(ids: string[]) {
    if (!ids.length) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const result = await this.db
      .prepare(
        `SELECT id, sku, name, active, unit_price_cents AS unitPriceCents, currency, tax_rate_bps AS taxRateBps FROM products WHERE id IN (${placeholders})`,
      )
      .bind(...ids)
      .all<PricedProduct>();
    return result.results;
  }

  storeExists(id: string) {
    return this.db.prepare("SELECT id FROM stores WHERE id = ?").bind(id).first();
  }
}
