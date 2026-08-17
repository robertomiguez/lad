/** The first smoke-test route for `wrangler dev`. */
export const hello = () => Response.json({ ok: true, service: "digital-damage-reporting" });
