import type { Claims } from "../auth";
import { storeStatusLabel } from "../domain/reports";
import { escape, html } from "../lib/http";
import type { Product } from "../repositories/catalog";
import type { StoreReport } from "../repositories/reports";
import type { StoreWorkspaceUser } from "../repositories/users";
import { pageDocument, pageHeaderView, topBarView } from "./layout";

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
  return pageDocument({
    title: "New damage report",
    scripts: [{ src: "/app.js", module: true }],
    body: `${topBarView({ session: "Store workspace ·", emphasis: user?.store_name ?? claims.store_id ?? "", backHref: "/" })}<main class="page">${pageHeaderView({ eyebrow: "New claim", title: "Report damaged goods", lede: "Save an editable draft on this device, then submit it safely when it is complete." })}<div class="capture-grid"><section class="card form-card"><form id="report-form"><input type="hidden" name="report_id" id="report-id"><input type="hidden" name="store_id" value="${escape(claims.store_id ?? "")}"><input type="hidden" name="reporter_id" value="${escape(claims.user_id)}"><div class="form-grid"><label>Date <input name="report_date" type="date" required></label><label>Total amount (CHF) <input name="total_amount" type="number" min="0" step="0.01" required></label></div><div id="form-errors" class="error" aria-live="polite"></div><h2>Damaged items</h2><div id="line-items">${item}</div><template id="line-item-template">${item}</template><div class="form-actions"><button type="button" id="add-line-item" class="button-secondary">Add another item</button><button type="button" id="save-draft" class="button-secondary">Save draft</button><button type="submit">Submit report</button></div><div id="form-feedback" class="form-feedback" aria-live="polite"></div><p class="form-note">${escape(user?.name ?? claims.user_id)} · optional photos remain local until you submit.</p></form><div id="form-result" aria-live="polite"></div></section><section class="card reports-card"><p class="eyebrow">Live status</p><h2>My reports</h2><div id="my-reports"></div></section></div></main>`,
  });
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
