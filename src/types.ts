export interface Env {
  DB: D1Database;
  IDEMPOTENCY: KVNamespace;
  PHOTOS: R2Bucket;
  ERP_WRITE_QUEUE: Queue;
  REPORT_DO: DurableObjectNamespace;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  AUTO_APPROVE_BELOW_REGIONAL?: string;
  ESCALATION_DEMO_DELAY_SECONDS?: string;
  ERP_SIMULATED_DELAY_MS?: string;
  ERP_FAILURE_RATE?: string;
  ERP_MAX_RETRIES?: string;
}

export type Submission = {
  id: string;
  storeId: string;
  reporterId: string;
  reportDate: string;
  totalAmountCents: number;
  items: {
    id: string;
    productId: string;
    quantity: number;
    reasonCode: string;
    photoId?: string;
  }[];
};
