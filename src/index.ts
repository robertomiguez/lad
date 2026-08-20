import { claimsFrom, requireRole, unauthorized } from "./auth";
import { ROLE } from "./domain/roles";
import { ReportWorkflow } from "./durable-objects/report-workflow";
import { withCorrelation } from "./lib/http";
import { logError } from "./lib/observability";
import { login, loginPage } from "./routes/auth";
import { approvalsFragment, approvalsPage, decideReport } from "./routes/approvals";
import { hello } from "./routes/hello";
import { opsFragment, opsPage } from "./routes/ops";
import { appPage, lineItemRow, myReports, productsResponse, reportStatuses } from "./routes/store";
import { createReport, uploadPhoto } from "./services/report-submission";
import { processErpWriteQueue } from "./services/erp-write";
import type { Env } from "./types";

async function routeRequest(request: Request, env: Env, correlationId: string): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && (pathname === "/hello" || pathname === "/health")) return hello();
  if (request.method === "GET" && (pathname === "/" || pathname === "/login")) return loginPage(env);
  if (request.method === "POST" && pathname === "/api/login") return login(request, env);

  const claims = await claimsFrom(request, env);
  if (!claims) return unauthorized();

  if (request.method === "GET" && pathname === "/app") return appPage(env, claims);
  if (request.method === "GET" && pathname === "/approvals") return approvalsPage(claims);
  if (request.method === "GET" && pathname === "/ops") return opsPage(claims);
  if (request.method === "GET" && pathname === "/fragments/line-item" && requireRole(claims, [ROLE.store])) return lineItemRow(env);
  if (request.method === "GET" && pathname === "/api/products" && requireRole(claims, [ROLE.store])) return productsResponse(env);
  if (request.method === "GET" && pathname === "/api/reports" && requireRole(claims, [ROLE.store])) return myReports(env, claims);
  if (request.method === "GET" && pathname === "/api/reports/statuses") return reportStatuses(env, claims);
  if (request.method === "GET" && pathname === "/fragments/approvals") return approvalsFragment(env, claims);
  if (request.method === "GET" && pathname === "/fragments/ops") return opsFragment(env, claims);
  if (request.method === "POST" && pathname === "/api/reports") return createReport(request, env, claims, correlationId);

  const photoRoute = pathname.match(/^\/api\/reports\/([^/]+)\/line-items\/([^/]+)\/photo$/);
  if (request.method === "PUT" && photoRoute) return uploadPhoto(request, env, claims, photoRoute[1], photoRoute[2], correlationId);

  const decisionRoute = pathname.match(/^\/api\/reports\/([^/]+)\/decision$/);
  if (request.method === "POST" && decisionRoute) return decideReport(request, env, claims, decisionRoute[1], correlationId);

  return Response.json({ error: "Not found" }, { status: 404 });
}

export default {
  async fetch(request, env): Promise<Response> {
    const correlationId = request.headers.get("X-Correlation-Id") ?? crypto.randomUUID();
    try {
      return withCorrelation(await routeRequest(request, env, correlationId), correlationId);
    } catch {
      logError(correlationId, "worker", "unhandled_request_error");
      return withCorrelation(Response.json({ errorCode: "technical_error" }, { status: 500 }), correlationId);
    }
  },
  queue(batch, env): Promise<void> {
    return processErpWriteQueue(batch, env);
  }
} satisfies ExportedHandler<Env>;

export { ReportWorkflow };
