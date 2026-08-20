export type Product = { id: string; sku: string; barcode: string | null; name: string };
type ProductState = { active: number };

export class CatalogRepository {
  constructor(private readonly db: D1Database) {}

  async listActiveProducts() {
    return (await this.db.prepare("SELECT id, sku, barcode, name FROM products WHERE active = 1 ORDER BY sku").all<Product>()).results;
  }

  findProductState(id: string) {
    return this.db.prepare("SELECT active FROM products WHERE id = ?").bind(id).first<ProductState>();
  }

  storeExists(id: string) {
    return this.db.prepare("SELECT id FROM stores WHERE id = ?").bind(id).first();
  }
}
