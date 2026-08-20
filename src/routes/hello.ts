import { jsonResponse } from "../lib/http";

/** The first smoke-test route for `wrangler dev`. */
export const hello = () => jsonResponse({ ok: true, service: "digital-damage-reporting" });
