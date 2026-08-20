import { claimsFrom, forbidden, requireRole, unauthorized, type Claims } from "../auth";
import type { Role } from "../domain/roles";
import { login, loginPage } from "./auth";
import { approvalsFragment, approvalsPage, decideReport } from "./approvals";
import { hello } from "./hello";
import { opsFragment, opsPage, retryErpWrite } from "./ops";
import { appPage, lineItemRow, myReports, productsResponse, reportStatuses } from "./store";
import { createReport, uploadPhoto } from "../services/report-submission";
import type { Env } from "../types";

type RouteContext = {
  request: Request;
  env: Env;
  correlationId: string;
  params: string[];
};

type AuthenticatedRouteContext = RouteContext & { claims: Claims };

type PublicRoute = {
  method: string;
  path: string | RegExp;
  handle: (context: RouteContext) => Response | Promise<Response>;
};

type ProtectedRoute = {
  method: string;
  path: string | RegExp;
  roles?: readonly Role[];
  handle: (context: AuthenticatedRouteContext) => Response | Promise<Response>;
};

type MatchedRoute<T> = { route: T; params: string[] };

const publicRoutes: PublicRoute[] = [
  { method: "GET", path: "/hello", handle: () => hello() },
  { method: "GET", path: "/health", handle: () => hello() },
  { method: "GET", path: "/", handle: ({ env }) => loginPage(env) },
  { method: "GET", path: "/login", handle: ({ env }) => loginPage(env) },
  { method: "POST", path: "/api/login", handle: ({ request, env }) => login(request, env) },
];

const protectedRoutes: ProtectedRoute[] = [
  { method: "GET", path: "/app", handle: ({ env, claims }) => appPage(env, claims) },
  { method: "GET", path: "/approvals", handle: ({ claims }) => approvalsPage(claims) },
  { method: "GET", path: "/ops", handle: ({ claims }) => opsPage(claims) },
  {
    method: "GET",
    path: "/fragments/line-item",
    roles: ["store"],
    handle: ({ env }) => lineItemRow(env),
  },
  { method: "GET", path: "/api/products", roles: ["store"], handle: ({ env }) => productsResponse(env) },
  { method: "GET", path: "/api/reports", roles: ["store"], handle: ({ env, claims }) => myReports(env, claims) },
  { method: "GET", path: "/api/reports/statuses", handle: ({ env, claims }) => reportStatuses(env, claims) },
  { method: "GET", path: "/fragments/approvals", handle: ({ env, claims }) => approvalsFragment(env, claims) },
  { method: "GET", path: "/fragments/ops", handle: ({ env, claims }) => opsFragment(env, claims) },
  {
    method: "POST",
    path: "/api/reports",
    handle: ({ request, env, claims, correlationId }) => createReport(request, env, claims, correlationId),
  },
  {
    method: "PUT",
    path: /^\/api\/reports\/([^/]+)\/line-items\/([^/]+)\/photo$/,
    handle: ({ request, env, claims, correlationId, params: [reportId, lineItemId] }) =>
      uploadPhoto(request, env, claims, reportId, lineItemId, correlationId),
  },
  {
    method: "POST",
    path: /^\/api\/reports\/([^/]+)\/decision$/,
    handle: ({ request, env, claims, correlationId, params: [reportId] }) =>
      decideReport(request, env, claims, reportId, correlationId),
  },
  {
    method: "POST",
    path: /^\/api\/reports\/([^/]+)\/retry-erp$/,
    handle: ({ env, claims, correlationId, params: [reportId] }) => retryErpWrite(env, claims, reportId, correlationId),
  },
];

function matchRoute<T extends PublicRoute | ProtectedRoute>(
  routes: readonly T[],
  method: string,
  pathname: string,
): MatchedRoute<T> | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === "string") {
      if (route.path === pathname) return { route, params: [] };
      continue;
    }
    const match = pathname.match(route.path);
    if (match) return { route, params: match.slice(1) };
  }
  return null;
}

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export async function dispatchRequest(request: Request, env: Env, correlationId: string): Promise<Response> {
  const { method } = request;
  const { pathname } = new URL(request.url);
  const publicRoute = matchRoute(publicRoutes, method, pathname);
  if (publicRoute) return publicRoute.route.handle({ request, env, correlationId, params: publicRoute.params });

  const claims = await claimsFrom(request, env);
  if (!claims) return unauthorized();

  const protectedRoute = matchRoute(protectedRoutes, method, pathname);
  if (!protectedRoute) return notFound();
  if (protectedRoute.route.roles && !requireRole(claims, protectedRoute.route.roles)) return forbidden();
  return protectedRoute.route.handle({ request, env, claims, correlationId, params: protectedRoute.params });
}
