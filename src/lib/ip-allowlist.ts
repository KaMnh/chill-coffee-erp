export interface ParseClientIpOptions { trustedProxyCount?: number; trustedHeader?: string | null; }
export interface IpMatchOptions { ipv6Prefix64?: boolean; }
function normaliseIp(raw: string | null | undefined): string {
  if (!raw) return ""; let s = raw.trim();
  if (s.startsWith("[")) s = s.slice(1); if (s.endsWith("]")) s = s.slice(0, -1);
  const pct = s.indexOf("%"); if (pct >= 0) s = s.slice(0, pct);
  return s.toLowerCase();
}
function isIpv6(ip: string): boolean { return ip.includes(":"); }
function expandIpv6(ip: string): string[] | null {
  if (ip.includes(".")) return null;
  const halves = ip.split("::"); if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 && missing < 1) return null;
  const middle = halves.length === 2 ? Array(missing).fill("0") : [];
  const parts = [...head, ...middle, ...tail]; if (parts.length !== 8) return null;
  return parts.map((p) => { const n = parseInt(p || "0", 16); return Number.isNaN(n) || n < 0 || n > 0xffff ? "INVALID" : n.toString(16); });
}
export function parseClientIp(headers: Headers, opts: ParseClientIpOptions = {}): string | null {
  const trustedProxyCount = Math.max(1, opts.trustedProxyCount ?? 1);
  if (opts.trustedHeader) { const n = normaliseIp(headers.get(opts.trustedHeader)); if (n) return n; }
  const xff = headers.get("x-forwarded-for"); if (!xff) return null;
  const parts = xff.split(",").map((p) => normaliseIp(p)).filter(Boolean);
  if (parts.length < trustedProxyCount) return null;
  return parts[parts.length - trustedProxyCount] ?? null;
}
export function ipEquals(a: string | null | undefined, b: string | null | undefined, opts: IpMatchOptions = {}): boolean {
  const na = normaliseIp(a), nb = normaliseIp(b); if (!na || !nb) return false;
  if (isIpv6(na) && isIpv6(nb)) {
    const ea = expandIpv6(na), eb = expandIpv6(nb);
    if (!ea || !eb || ea.includes("INVALID") || eb.includes("INVALID")) return na === nb;
    const len = opts.ipv6Prefix64 ? 4 : 8;
    for (let i = 0; i < len; i++) if (ea[i] !== eb[i]) return false;
    return true;
  }
  return na === nb;
}
export function isIpAllowed(ip: string | null | undefined, allowlist: string[], opts: IpMatchOptions = {}): boolean {
  const n = normaliseIp(ip); if (!n) return false;
  return allowlist.some((entry) => ipEquals(n, entry, opts));
}
