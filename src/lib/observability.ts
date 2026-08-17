export const RETRY_LIMITS = {
  reportSync: "Unlimited Background Sync retries while the device retains the report",
  photoUpload: "Unlimited independent retries while the device retains the photo",
  erpDefaultMaxRetries: 3
} as const;

export type TransitionLog = { reportId: string; correlationId: string; fromStatus: string; toStatus: string; actor: string; component: "worker" | "workflow" | "erp-queue"; reason?: string };
export const logTransition = (event: TransitionLog) => console.log(JSON.stringify({ event: "report_transition", timestamp: new Date().toISOString(), ...event }));
export const logError = (correlationId: string, component: string, errorCode: string, reportId?: string) => console.log(JSON.stringify({ event: "report_error", timestamp: new Date().toISOString(), correlationId, component, errorCode, reportId }));
