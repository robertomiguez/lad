export const normalizeSku = value => String(value ?? "").trim().replaceAll(/\s+/g, "").toUpperCase();

export const productCodeMatches = (knownCode, scannedValue) => {
  const known = normalizeSku(knownCode);
  return Boolean(known) && known === normalizeSku(scannedValue);
};

export const skuMatches = productCodeMatches;
