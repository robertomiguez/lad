export type Role = "store" | "regional_manager" | "quality";
export type Claims = { user_id: string; role: Role; store_id: string | null; exp: number };
export type AuthEnv = { JWT_SECRET: string };

const encoder = new TextEncoder();
const decode = new TextDecoder();
const base64url = (value: string | Uint8Array) => btoa(typeof value === "string" ? value : String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const fromBase64url = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)), c => c.charCodeAt(0));
const signingKey = (secret: string) => crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function issueSession(user: Omit<Claims, "exp">, secret: string) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 }));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

export async function claimsFrom(request: Request, env: AuthEnv): Promise<Claims | null> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)damage_session=([^;]+)/)?.[1];
  const token = bearer ?? (cookie ? decodeURIComponent(cookie) : undefined);
  if (!token) return null;
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(env.JWT_SECRET), fromBase64url(signature), encoder.encode(`${header}.${payload}`));
    if (!valid) return null;
    const claims = JSON.parse(decode.decode(fromBase64url(payload))) as Claims;
    return claims.exp > Date.now() / 1000 && ["store", "regional_manager", "quality"].includes(claims.role) ? claims : null;
  } catch { return null; }
}

export const unauthorized = () => Response.json({ error: "Authentication required" }, { status: 401 });
export const forbidden = () => Response.json({ error: "You do not have permission for this action" }, { status: 403 });
export const requireRole = (claims: Claims, roles: Role[]) => roles.includes(claims.role);

/** Regional approvers can only access their own store; quality is cross-store. */
export const canAccessStore = (claims: Claims, storeId: string) => claims.role === "quality" || claims.store_id === storeId;
