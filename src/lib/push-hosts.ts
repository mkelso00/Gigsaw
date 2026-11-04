// Phones give us an address to send their notifications to. Only the browsers' own push
// services are allowed, so a made-up address can't get the server to call anything else
// (for example a service on our private network).

const HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const SUFFIXES = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

/** True for an https address on a known push service, with no user name, password or port. */
export function isPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  // The address must be written exactly as the parser reads it, so the push library can't
  // read a different host from it.
  if (url.href !== endpoint) return false;
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname;
  return HOSTS.includes(host) || SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}
