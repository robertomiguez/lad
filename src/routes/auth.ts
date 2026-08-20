import { issueSession } from "../auth";
import { ROLE } from "../domain/roles";
import { UsersRepository } from "../repositories/users";
import type { Env } from "../types";
import { loginView } from "../views/auth";

export async function loginPage(env: Env) {
  const users = new UsersRepository(env.DB);
  const results = await users.listForLogin();
  return loginView(results);
}

export async function login(request: Request, env: Env) {
  const jsonRequest = request.headers.get("content-type")?.includes("application/json");
  const username = jsonRequest
    ? ((await request.json()) as { username?: string }).username
    : String((await request.formData()).get("username") ?? "");
  if (!username) return Response.json({ error: "username is required" }, { status: 400 });

  const user = await new UsersRepository(env.DB).findById(username);
  if (!user) return Response.json({ error: "Unknown seeded user" }, { status: 401 });

  const token = await issueSession({ user_id: user.id, role: user.role, store_id: user.store_id }, env.JWT_SECRET);
  const headers = {
    "set-cookie": `damage_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
  };
  const destination = user.role === ROLE.store ? "/app" : "/approvals";
  return jsonRequest
    ? Response.json({ token, user }, { headers })
    : new Response(null, { status: 303, headers: { ...headers, location: destination } });
}
