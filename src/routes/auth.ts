import { issueSession } from "../auth";
import { ROLE } from "../domain/roles";
import { escape, html } from "../lib/http";
import { UsersRepository, type DbUser } from "../repositories/users";
import type { Env } from "../types";

export async function loginPage(env: Env) {
  const users = new UsersRepository(env.DB);
  const results = await users.listForLogin();
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Damage Reporting POC</title><link rel="stylesheet" href="/styles.css"><main class="login-shell"><section class="login-aside"><div class="brand"><span class="brand-mark">DR</span>Digital Damage Reporting</div><div><p class="eyebrow" style="color:#9fddff">Operational POC</p><h1>Make every damaged item visible.</h1><p>Capture a report anywhere, route it to the right approver, and keep the store informed from first photo to completed credit note.</p></div></section><section class="login-content"><div class="card login-card"><p class="eyebrow">Start a demo session</p><h2>Choose a role</h2><p class="muted">Authentication is deliberately simplified for this proof of concept.</p><form method="post" action="/api/login"><label>Seeded user <select name="username">${results.map(user => `<option value="${escape(user.id)}">${escape(user.name)} (${escape(user.role.replaceAll("_", " "))})</option>`).join("")}</select></label><button>Continue to workspace</button></form></div></section></main></html>`);
}

export async function login(request: Request, env: Env) {
  const jsonRequest = request.headers.get("content-type")?.includes("application/json");
  const username = jsonRequest ? (await request.json() as { username?: string }).username : String((await request.formData()).get("username") ?? "");
  if (!username) return Response.json({ error: "username is required" }, { status: 400 });

  const user = await new UsersRepository(env.DB).findById(username);
  if (!user) return Response.json({ error: "Unknown seeded user" }, { status: 401 });

  const token = await issueSession({ user_id: user.id, role: user.role, store_id: user.store_id }, env.JWT_SECRET);
  const headers = { "set-cookie": `damage_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` };
  const destination = user.role === ROLE.store ? "/app" : "/approvals";
  return jsonRequest ? Response.json({ token, user }, { headers }) : new Response(null, { status: 303, headers: { ...headers, location: destination } });
}
