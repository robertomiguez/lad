import type { Claims } from "../auth";
import type { Submission } from "../domain/submission";

const allowedReasonCodes = new Set(["damaged", "incorrect_delivery", "expired"]);
const idPattern = /^[a-zA-Z0-9-]{8,80}$/;
const maxDescriptionLength = 500;

export type SubmissionValidationError =
  "invalid_quantity" | "invalid_reason_code" | "store_not_found" | "product_not_found" | "product_inactive";

export type SubmissionCatalog = {
  storeExists(id: string): Promise<unknown>;
  findProductState(id: string): Promise<{ active: number } | null>;
};

export const isJsonSubmissionRequest = (request: Request) =>
  request.headers.get("content-type")?.includes("application/json") ?? false;

export async function parseSubmission(request: Request): Promise<Submission | null> {
  if (isJsonSubmissionRequest(request)) {
    const input = (await request.json()) as Partial<Submission>;
    return Array.isArray(input.items) ? (input as Submission) : null;
  }

  const form = await request.formData();
  const productIds = form.getAll("product_id").map(String);
  const quantities = form.getAll("quantity").map(String);
  const reasons = form.getAll("reason_code").map(String);
  const descriptions = form.getAll("description").map(String);
  const lineIds = form.getAll("line_item_id").map(String);
  return {
    id: String(form.get("report_id") ?? ""),
    storeId: String(form.get("store_id") ?? ""),
    reporterId: String(form.get("reporter_id") ?? ""),
    totalAmountCents: Math.round(Number(form.get("total_amount")) * 100),
    items: productIds.map((productId, index) => ({
      id: lineIds[index],
      productId,
      quantity: Number(quantities[index]),
      reasonCode: reasons[index],
      description: (descriptions[index] ?? "").trim(),
    })),
  };
}

export function hasValidSubmissionShape(submission: Submission, claims: Claims, idempotencyKey: string | null) {
  return (
    idPattern.test(submission.id) &&
    (!idempotencyKey || idempotencyKey === submission.id) &&
    submission.storeId === claims.store_id &&
    submission.reporterId === claims.user_id &&
    Number.isInteger(submission.totalAmountCents) &&
    submission.totalAmountCents >= 0 &&
    submission.items.length >= 1 &&
    submission.items.every(
      (item) =>
        idPattern.test(item.id) &&
        Boolean(item.productId) &&
        Boolean(item.reasonCode) &&
        Number.isInteger(item.quantity) &&
        item.quantity >= 1 &&
        typeof item.description === "string" &&
        item.description.length <= maxDescriptionLength &&
        (item.photoId === undefined || idPattern.test(item.photoId)),
    )
  );
}

export async function validateSubmissionCatalog(
  catalog: SubmissionCatalog,
  submission: Submission,
): Promise<SubmissionValidationError | null> {
  if (submission.items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) return "invalid_quantity";
  if (submission.items.some((item) => !allowedReasonCodes.has(item.reasonCode))) return "invalid_reason_code";
  if (!(await catalog.storeExists(submission.storeId))) return "store_not_found";

  for (const item of submission.items) {
    const product = await catalog.findProductState(item.productId);
    if (!product) return "product_not_found";
    if (product.active !== 1) return "product_inactive";
  }
  return null;
}
