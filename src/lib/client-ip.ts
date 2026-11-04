/**
 * The visitor's IP address, as seen by the host's proxy. Railway's proxy adds the address it was
 * reached from to the end of x-forwarded-for, after anything the visitor sent themselves, so the
 * last entry is the one to trust (the first can be made up).
 */
export function clientIp(h: { get(name: string): string | null }): string {
  const last = h.get("x-forwarded-for")?.split(",").pop()?.trim();
  return (last || h.get("x-real-ip")?.trim() || "unknown").slice(0, 100);
}
