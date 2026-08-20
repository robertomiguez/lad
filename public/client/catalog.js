const sortProducts = (products) => [...products].sort((left, right) => left.sku.localeCompare(right.sku));

const populateProductSelect = (select, products) => {
  const selected = select.value;
  select.replaceChildren(new Option("Choose product", ""));
  for (const product of products) {
    const option = new Option(`${product.sku} — ${product.name}`, product.id);
    option.dataset.sku = product.sku;
    option.dataset.barcode = product.barcode || "";
    select.add(option);
  }
  select.value = products.some((product) => product.id === selected) ? selected : "";
};

export function createProductCatalog({ allProducts, clearProducts, saveProduct }) {
  let products = [];

  const apply = (root) => {
    root.querySelectorAll("[name=product_id]").forEach((select) => {
      if (select instanceof HTMLSelectElement && products.length) {
        populateProductSelect(select, products);
      }
    });
  };

  const refresh = async () => {
    const cached = await allProducts();
    if (cached.length) {
      products = sortProducts(cached);
      apply(document);
    }
    try {
      const response = await fetch("/api/products", { credentials: "same-origin" });
      const remoteProducts = await response.json();
      if (
        !response.ok ||
        !Array.isArray(remoteProducts) ||
        remoteProducts.some((product) => !product?.id || !product?.sku || !product?.name)
      ) {
        return;
      }
      products = sortProducts(remoteProducts);
      await clearProducts();
      await Promise.all(products.map(saveProduct));
      apply(document);
    } catch {}
  };

  return { apply, refresh };
}
