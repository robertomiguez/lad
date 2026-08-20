export const ROLE = {
  store: "store",
  regionalManager: "regional_manager",
  quality: "quality",
} as const;

export const ROLES = [ROLE.store, ROLE.regionalManager, ROLE.quality] as const;

export type Role = (typeof ROLES)[number];
export type ApprovalRole = typeof ROLE.regionalManager | typeof ROLE.quality;

export const APPROVAL_ROLES = [ROLE.regionalManager, ROLE.quality] as const satisfies readonly ApprovalRole[];

export const isRole = (value: unknown): value is Role =>
  typeof value === "string" && (ROLES as readonly string[]).includes(value);

export const roleLabel = (role: Role) =>
  ({
    [ROLE.store]: "Store",
    [ROLE.regionalManager]: "Regional Manager",
    [ROLE.quality]: "Quality Management",
  })[role];

/** Regional approvers are limited to their store; quality is cross-store. */
export const canAccessStore = (role: Role, actorStoreId: string | null, reportStoreId: string) =>
  role === ROLE.quality || actorStoreId === reportStoreId;
