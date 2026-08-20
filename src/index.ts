import { ReportWorkflow } from "./durable-objects/report-workflow";
import { withCorrelation } from "./lib/http";
import { logError } from "./lib/observability";
import { dispatchRequest } from "./routes/registry";
import { processErpWriteQueue } from "./services/erp-write";
import type { Env } from "./types";

export default {
  async fetch(request, env): Promise<Response> {
    const correlationId = request.headers.get("X-Correlation-Id") ?? crypto.randomUUID();
    try {
      return withCorrelation(await dispatchRequest(request, env, correlationId), correlationId);
    } catch {
      logError(correlationId, "worker", "unhandled_request_error");
      return withCorrelation(Response.json({ errorCode: "technical_error" }, { status: 500 }), correlationId);
    }
  },
  queue(batch, env): Promise<void> {
    return processErpWriteQueue(batch, env);
  },
} satisfies ExportedHandler<Env>;

export { ReportWorkflow };
