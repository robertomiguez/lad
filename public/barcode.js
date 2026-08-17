export const normalizeSku = value => String(value ?? "").trim().replaceAll(/\s+/g, "").toUpperCase();

export const skuMatches = (knownSku, scannedValue) => {
  const known = normalizeSku(knownSku);
  return Boolean(known) && known === normalizeSku(scannedValue);
};
