import { escape, html } from "../lib/http";
import type { DbUser } from "../repositories/users";

export const loginView = (users: Pick<DbUser, "id" | "name" | "role">[]) =>
  html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Damage Reporting POC</title><link rel="stylesheet" href="/styles.css"><main class="login-shell"><section class="login-aside"><div class="brand"><span class="brand-mark">DR</span>Digital Damage Reporting</div><div><p class="eyebrow" style="color:#9fddff">Operational POC</p><h1>Make every damaged item visible.</h1><p>Capture a report anywhere, route it to the right approver, and keep the store informed from first photo to completed credit note.</p></div></section><section class="login-content"><div class="card login-card"><p class="eyebrow">Start a demo session</p><h2>Choose a role</h2><p class="muted">Authentication is deliberately simplified for this proof of concept.</p><form method="post" action="/api/login"><label>Seeded user <select name="username">${users.map((user) => `<option value="${escape(user.id)}">${escape(user.name)} (${escape(user.role.replaceAll("_", " "))})</option>`).join("")}</select></label><button>Continue to workspace</button></form></div></section></main></html>`,
  );
