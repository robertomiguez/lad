import { forbidden, requireRole, type Claims } from "../auth";
import { ROLE } from "../domain/roles";
import { jsonResponse } from "../lib/http";
import { CatalogRepository } from "../repositories/catalog";
import { ReportsRepository } from "../repositories/reports";
import { UsersRepository } from "../repositories/users";
import type { Env } from "../types";
import { lineItemView, myReportsView, storeAppView } from "../views/store";

async function products(env: Env) {
  return new CatalogRepository(env.DB).listActiveProducts();
}

export async function lineItemRow(env: Env) {
  return lineItemView(await products(env));
}

export async function productsResponse(env: Env) {
  return jsonResponse(await products(env), 200, { "cache-control": "no-store" });
}

export async function appPage(env: Env, claims: Claims) {
  if (claims.role !== ROLE.store) return new Response(null, { status: 303, headers: { location: "/approvals" } });
  const user = await new UsersRepository(env.DB).findStoreWorkspace(claims.user_id);
  return storeAppView(claims, user, await products(env));
}

export async function myReports(env: Env, claims: Claims) {
  const results = await new ReportsRepository(env.DB).listForStore(claims.store_id);
  return myReportsView(results);
}

export async function reportStatuses(env: Env, claims: Claims) {
  if (!requireRole(claims, [ROLE.store])) return forbidden();
  const results = await new ReportsRepository(env.DB).listStatusesForStore(claims.store_id);
  return jsonResponse(
    results.map((report) => ({
      id: report.id,
      status: report.status,
      totalAmountCents: report.total_amount,
      createdAt: report.created_at,
      escalatedAt: report.escalated_at,
      escalationTargetRole: report.escalation_target_role,
      rejectionReason: report.rejection_reason,
    })),
  );
}
