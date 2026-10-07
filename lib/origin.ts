/**
 * This site's address — for links in emails and for every redirect: APP_URL, not the
 * request's own address. A caller could forge that to have a sign-in link point at their
 * server, and behind Railway's proxy it is the server's inside address (localhost:8080),
 * which once sent a signed-in admin there. The request's only when APP_URL is a local
 * address and the request is not (a deployment set up from a copy of .env.local).
 *
 * On its own, without imports, so the proxy can use it too.
 */
const LOCAL = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;

export function appOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  const origin = new URL(request.url).origin;
  return configured && !(LOCAL.test(configured) && !LOCAL.test(origin)) ? configured : origin;
}
