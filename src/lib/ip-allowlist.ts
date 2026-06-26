export interface ParseClientIpOptions { trustedProxyCount?: number; trustedHeader?: string | null; }
export interface IpMatchOptions { ipv6Prefix64?: boolean; }

/** Parsed IP: numeric version + raw bytes (4 or 16) + canonical string form. */
interface ParsedIp { version: 4 | 6; bytes: number[]; canonical: string; }

/** Rich result for the check-in gate (also drives debug logging). */
export interface IpMatchResult {
  allowed: boolean;
  /** Canonical client IP (IPv4-mapped collapsed to IPv4), or null if unparseable. */
  normalized: string | null;
  version: 4 | 6 | null;
  /** The matched allowlist range as `<network>/<prefix>`, or null. */
  matchedRange: string | null;
}

/** Strip brackets / zone-id / whitespace and lowercase. NOT a validity check. */
function normaliseIp(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  if (s.startsWith("[")) s = s.slice(1);
  if (s.endsWith("]")) s = s.slice(0, -1);
  const pct = s.indexOf("%"); if (pct >= 0) s = s.slice(0, pct);
  return s.toLowerCase();
}

function parseIpv4Bytes(s: string): number[] | null {
  const octets = s.split(".");
  if (octets.length !== 4) return null;
  const bytes: number[] = [];
  for (const o of octets) {
    if (!/^\d{1,3}$/.test(o)) return null;
    const n = Number(o);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

/** Parse an IPv6 literal (incl. embedded dotted-quad, e.g. ::ffff:1.2.3.4) → 16 bytes. */
function parseIpv6Bytes(input: string): number[] | null {
  let s = input;
  // Embedded IPv4 in the trailing 32 bits (::ffff:1.2.3.4, 64:ff9b::1.2.3.4, …)
  const m = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) {
    const v4 = parseIpv4Bytes(m[2]);
    if (!v4) return null;
    const h1 = ((v4[0] << 8) | v4[1]).toString(16);
    const h2 = ((v4[2] << 8) | v4[3]).toString(16);
    s = m[1] + h1 + ":" + h2;
  }
  if (s.includes(".")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...(halves.length === 2 ? (Array(missing).fill("0") as string[]) : []), ...tail];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

function canonicalBytes(bytes: number[], version: 4 | 6): string {
  if (version === 4) return bytes.join(".");
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
  // RFC 5952-ish: compress the longest run of >=2 zero groups.
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else { curStart = -1; curLen = 0; }
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLen >= 2) {
    return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLen).join(":")}`;
  }
  return hex.join(":");
}

/** Parse any IPv4/IPv6 literal to {version, bytes, canonical}. IPv4-mapped IPv6
 *  (::ffff:a.b.c.d) collapses to IPv4 so it matches an IPv4 allowlist. */
function parseIp(raw: string | null | undefined): ParsedIp | null {
  const s = normaliseIp(raw);
  if (!s) return null;
  if (!s.includes(":")) {
    const b = parseIpv4Bytes(s);
    return b ? { version: 4, bytes: b, canonical: canonicalBytes(b, 4) } : null;
  }
  const b = parseIpv6Bytes(s);
  if (!b) return null;
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;
  if (mapped) {
    const v4 = b.slice(12);
    return { version: 4, bytes: v4, canonical: canonicalBytes(v4, 4) };
  }
  return { version: 6, bytes: b, canonical: canonicalBytes(b, 6) };
}

function maskBytes(bytes: number[], prefix: number): number[] {
  return bytes.map((b, i) => {
    const start = i * 8;
    if (start + 8 <= prefix) return b;
    if (start >= prefix) return 0;
    const keep = prefix - start; // 1..7
    return b & ((0xff << (8 - keep)) & 0xff);
  });
}

function bytesInPrefix(a: number[], b: number[], prefix: number): boolean {
  let bits = prefix;
  for (let i = 0; i < a.length && bits > 0; i++) {
    if (bits >= 8) {
      if (a[i] !== b[i]) return false;
      bits -= 8;
    } else {
      const mask = (0xff << (8 - bits)) & 0xff;
      if ((a[i] & mask) !== (b[i] & mask)) return false;
      bits = 0;
    }
  }
  return true;
}

/** Parse an allowlist entry — a CIDR (`1.2.3.0/24`, `2402::/64`) or a bare IP.
 *  A bare IP gets the version default: IPv4 → /32, IPv6 → /64 (or /128 when
 *  ipv6Prefix64 is off). Keeps existing single-IP allowlist data working. */
function parseCidr(entry: string, opts: IpMatchOptions): { ip: ParsedIp; prefix: number } | null {
  const slash = entry.indexOf("/");
  const ip = parseIp(slash >= 0 ? entry.slice(0, slash) : entry);
  if (!ip) return null;
  const maxBits = ip.version === 4 ? 32 : 128;
  let prefix: number;
  if (slash >= 0) {
    const p = Number(entry.slice(slash + 1));
    if (!Number.isInteger(p) || p < 0 || p > maxBits) return null;
    prefix = p;
  } else {
    prefix = ip.version === 4 ? 32 : (opts.ipv6Prefix64 ? 64 : 128);
  }
  return { ip, prefix };
}

/** Match a client IP against a CIDR/IP allowlist. Same-version only; never
 *  compares by raw string; returns the matched range + canonical/version for logs. */
export function matchClientIp(
  rawIp: string | null | undefined,
  allowlist: string[],
  opts: IpMatchOptions = {}
): IpMatchResult {
  const ip = parseIp(rawIp);
  if (!ip) return { allowed: false, normalized: null, version: null, matchedRange: null };
  for (const entry of allowlist) {
    const cidr = parseCidr(entry, opts);
    if (!cidr || cidr.ip.version !== ip.version) continue;
    if (bytesInPrefix(ip.bytes, cidr.ip.bytes, cidr.prefix)) {
      const network = canonicalBytes(maskBytes(cidr.ip.bytes, cidr.prefix), cidr.ip.version);
      return { allowed: true, normalized: ip.canonical, version: ip.version, matchedRange: `${network}/${cidr.prefix}` };
    }
  }
  return { allowed: false, normalized: ip.canonical, version: ip.version, matchedRange: null };
}

/** True only for a syntactically valid IPv4/IPv6 literal (incl. IPv4-mapped). */
export function isValidIp(ip: string | null | undefined): boolean {
  return parseIp(ip) !== null;
}

export function parseClientIp(headers: Headers, opts: ParseClientIpOptions = {}): string | null {
  const trustedProxyCount = Math.max(1, opts.trustedProxyCount ?? 1);
  // A configured platform real-IP header (e.g. cf-connecting-ip behind Cloudflare)
  // is the ONLY trusted source. A request without a VALID value there did NOT come
  // through the expected edge → FAIL CLOSED (null). Never fall back to the spoofable
  // x-forwarded-for chain in that mode, and never trust a non-IP value.
  if (opts.trustedHeader) {
    const n = normaliseIp(headers.get(opts.trustedHeader));
    return isValidIp(n) ? n : null;
  }
  const xff = headers.get("x-forwarded-for"); if (!xff) return null;
  const parts = xff.split(",").map((p) => normaliseIp(p)).filter(Boolean);
  if (parts.length < trustedProxyCount) return null;
  const ip = parts[parts.length - trustedProxyCount];
  return ip && isValidIp(ip) ? ip : null;
}

/** Pairwise equality (exact, or /64 for IPv6 when ipv6Prefix64). Byte-based, not string. */
export function ipEquals(a: string | null | undefined, b: string | null | undefined, opts: IpMatchOptions = {}): boolean {
  const pa = parseIp(a), pb = parseIp(b);
  if (!pa || !pb || pa.version !== pb.version) return false;
  const prefix = pa.version === 6 ? (opts.ipv6Prefix64 ? 64 : 128) : 32;
  return bytesInPrefix(pa.bytes, pb.bytes, prefix);
}

export function isIpAllowed(ip: string | null | undefined, allowlist: string[], opts: IpMatchOptions = {}): boolean {
  return matchClientIp(ip, allowlist, opts).allowed;
}
