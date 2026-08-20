export const html = (body: string, status = 200, headers: HeadersInit = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

export const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers });

export const jsonError = (error: string, status: number) => jsonResponse({ error }, status);

export const jsonErrorCode = (errorCode: string, status: number) => jsonResponse({ errorCode }, status);

export const withCorrelation = (response: Response, correlationId: string) => {
  const headers = new Headers(response.headers);
  headers.set("X-Correlation-Id", correlationId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
