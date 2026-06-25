import { describe, it, expect } from "vitest";
import { parseClientIp, ipEquals, isIpAllowed } from "@/lib/ip-allowlist";
const H = (h: Record<string, string>) => new Headers(h);
describe("parseClientIp", () => {
  it("right-most hop, one proxy (ignores spoofed left)", () => { expect(parseClientIp(H({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), { trustedProxyCount: 1 })).toBe("9.9.9.9"); });
  it("single value", () => { expect(parseClientIp(H({ "x-forwarded-for": "9.9.9.9" }), { trustedProxyCount: 1 })).toBe("9.9.9.9"); });
  it("trustedProxyCount=2", () => { expect(parseClientIp(H({ "x-forwarded-for": "1.1.1.1, 8.8.8.8, 10.0.0.1" }), { trustedProxyCount: 2 })).toBe("8.8.8.8"); });
  it("platform header preferred", () => { expect(parseClientIp(H({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), { trustedProxyCount: 1, trustedHeader: "cf-connecting-ip" })).toBe("203.0.113.7"); });
  it("null when no header", () => { expect(parseClientIp(H({}), { trustedProxyCount: 1 })).toBeNull(); });
  it("null when fewer hops", () => { expect(parseClientIp(H({ "x-forwarded-for": "9.9.9.9" }), { trustedProxyCount: 2 })).toBeNull(); });
  it("IPv6 normalised", () => { expect(parseClientIp(H({ "x-forwarded-for": "[2001:DB8::1%eth0]" }), { trustedProxyCount: 1 })).toBe("2001:db8::1"); });
});
describe("ipEquals", () => {
  it("IPv4 exact", () => { expect(ipEquals("203.0.113.7","203.0.113.7")).toBe(true); expect(ipEquals("203.0.113.7","203.0.113.8")).toBe(false); });
  it("IPv6 forms", () => { expect(ipEquals("2001:0db8:0000:0000:0000:0000:0000:0001","2001:db8::1")).toBe(true); });
  it("IPv6 /64", () => { expect(ipEquals("2001:db8::abcd","2001:db8::1",{ipv6Prefix64:true})).toBe(true); expect(ipEquals("2001:db8:0:1::1","2001:db8::1",{ipv6Prefix64:true})).toBe(false); });
  it("null never matches", () => { expect(ipEquals(null,"1.2.3.4")).toBe(false); });
});
describe("isIpAllowed", () => {
  it("exact match true", () => { expect(isIpAllowed("203.0.113.7",["198.51.100.1","203.0.113.7"])).toBe(true); });
  it("null fail-closed", () => { expect(isIpAllowed(null,["203.0.113.7"])).toBe(false); });
  it("empty allowlist false", () => { expect(isIpAllowed("203.0.113.7",[])).toBe(false); });
});
