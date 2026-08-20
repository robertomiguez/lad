import type { Claims } from "../auth";
import { storeStatusLabel } from "../domain/reports";
import { escape, html } from "../lib/http";
import type { Product } from "../repositories/catalog";
import type { StoreReport } from "../repositories/reports";
import type { StoreWorkspaceUser } from "../repositories/users";

const productOptions = (products: Product[]) =>
  products
    .map(
      (product) =>
        `<option value="${escape(product.id)}" data-sku="${escape(product.sku)}" data-barcode="${escape(product.barcode ?? "")}">${escape(product.sku)} — ${escape(product.name)}</option>`,
    )
    .join("");

export const lineItemView = (products: Product[]) => html(lineItemMarkup(productOptions(products)));

export const storeAppView = (claims: Claims, user: StoreWorkspaceUser | null, products: Product[]) => {
  const item = lineItemMarkup(productOptions(products));
  return html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New damage report</title><link rel="stylesheet" href="/styles.css"><script type="module" src="/app.js"></script><header class="topbar"><span class="brand"><span class="brand-mark">DR</span>Damage Reporting</span><span class="session">Store workspace · <strong>${escape(user?.store_name ?? claims.store_id ?? "")}</strong></span><a class="button back-button" href="/">Back</a></header><main class="page"><div class="page-header"><div><p class="eyebrow">New claim</p><h1>Report damaged goods</h1><p class="lede">Saved to this device first, then synchronized safely when a connection is available.</p></div></div><div class="capture-grid"><section class="card form-card"><form id="report-form"><input type="hidden" name="report_id" id="report-id"><input type="hidden" name="store_id" value="${escape(claims.store_id ?? "")}"><input type="hidden" name="reporter_id" value="${escape(claims.user_id)}"><div class="form-grid"><label>Date <input name="report_date" type="date" required></label><label>Total amount (CHF) <input name="total_amount" type="number" min="0" step="0.01" required></label></div><div id="form-errors" class="error" aria-live="polite"></div><h2>Damaged items</h2><div id="line-items">${item}</div><template id="line-item-template">${item}</template><div class="form-actions"><button type="button" id="add-line-item" class="button-secondary">Add another item</button><button type="submit">Save report</button></div><div id="form-feedback" class="form-feedback" aria-live="polite"></div><p class="form-note">${escape(user?.name ?? claims.user_id)} · optional photos upload independently.</p></form><div id="form-result" aria-live="polite"></div></section><section class="card reports-card"><p class="eyebrow">Live status</p><h2>My reports</h2><div id="my-reports"></div></section></div></main></html>`,
  );
};

export const myReportsView = (reports: StoreReport[]) =>
  html(
    reports.length
      ? reports
          .map(
            (report) =>
              `<article class="report"><strong>${escape(report.id)}</strong> · ${escape(storeStatusLabel(report.status))} · CHF ${(report.total_amount / 100).toFixed(2)}<br><small>${escape(report.created_at)}</small></article>`,
          )
          .join("")
      : '<p class="empty-state">No reports submitted yet.</p>',
  );

const lineItemMarkup = (options: string) =>
  `<fieldset class="line-item"><input type="hidden" name="line_item_id" data-line-id><label>Barcode / SKU <input name="barcode" data-barcode-input type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Scan or type SKU"><span class="barcode-result" data-barcode-result aria-live="polite"></span></label><label>Product <select name="product_id" required><option value="">Choose product</option>${options}</select></label><label>Quantity <input name="quantity" type="number" min="1" step="1" required></label><label>Reason <select name="reason_code" required><option value="">Choose reason</option><option value="damaged">Damaged</option><option value="incorrect_delivery">Incorrect delivery</option><option value="expired">Expired</option></select></label><label>Photo <input name="photo" type="file" accept="image/*"></label><button type="button" class="remove-line">Remove</button><button type="button" class="barcode-camera-button" data-camera-scan aria-label="Scan barcode with camera">Scan</button><div class="barcode-scanner" data-barcode-scanner hidden><video data-barcode-video muted playsinline></video><p>Point the camera at the product barcode.</p><button type="button" class="button-secondary" data-close-camera>Cancel scan</button></div></fieldset>`;
