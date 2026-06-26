import { describe, it, expect } from "vitest";
import { parseClientIp, ipEquals, isIpAllowed, matchClientIp, isValidIp } from "@/lib/ip-allowlist";
const H = (h: Record<string, string>) => new Headers(h);
describe("parseClientIp", () => {
  it("right-most hop, one proxy (ignores spoofed left)", () => { expect(parseClientIp(H({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), { trustedProxyCount: 1 })).toBe("9.9.9.9"); });
  it("single value", () => { expect(parseClientIp(H({ "x-forwarded-for": "9.9.9.9" }), { trustedProxyCount: 1 })).toBe("9.9.9.9"); });
  it("trustedProxyCount=2", () => { expect(parseClientIp(H({ "x-forwarded-for": "1.1.1.1, 8.8.8.8, 10.0.0.1" }), { trustedProxyCount: 2 })).toBe("8.8.8.8"); });
  it("platform header preferred", () => { expect(parseClientIp(H({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), { trustedProxyCount: 1, trustedHeader: "cf-connecting-ip" })).toBe("203.0.113.7"); });
  it("null when no header", () => { expect(parseClientIp(H({}), { trustedProxyCount: 1 })).toBeNull(); });
  it("null when fewer hops", () => { expect(parseClientIp(H({ "x-forwarded-for": "9.9.9.9" }), { trustedProxyCount: 2 })).toBeNull(); });
  it("IPv6 normalised", () => { expect(parseClientIp(H({ "x-forwarded-for": "[2001:DB8::1%eth0]" }), { trustedProxyCount: 1 })).toBe("2001:db8::1"); });

  // Anti-spoof: khi đã khai báo trusted real-IP header (vd cf-connecting-ip sau
  // Cloudflare), đó là NGUỒN DUY NHẤT. Thiếu/không hợp lệ → FAIL CLOSED (null),
  // KHÔNG fallback về x-forwarded-for (kẻ tấn công bypass edge có thể giả mạo XFF).
  it("trustedHeader đã set nhưng VẮNG → null (không fallback XFF spoofable)", () => {
    expect(parseClientIp(H({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), { trustedHeader: "cf-connecting-ip" })).toBeNull();
  });
  it("trustedHeader có mặt nhưng không phải IP → null (không fallback)", () => {
    expect(parseClientIp(H({ "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "9.9.9.9" }), { trustedHeader: "cf-connecting-ip" })).toBeNull();
  });
  it("trustedHeader có IP hợp lệ → trả IP thật của client", () => {
    expect(parseClientIp(H({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), { trustedHeader: "cf-connecting-ip" })).toBe("203.0.113.7");
  });

  // Chỉ trả IP hợp lệ — header rác không được nhận làm IP client.
  it("XFF rác → null", () => { expect(parseClientIp(H({ "x-forwarded-for": "garbage" }), { trustedProxyCount: 1 })).toBeNull(); });
  it("XFF hop đúng vị trí nhưng rác → null", () => { expect(parseClientIp(H({ "x-forwarded-for": "203.0.113.7, junk" }), { trustedProxyCount: 1 })).toBeNull(); });
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

  // Cloudflare cf-connecting-ip thường là IPv6; host trong /64 XOAY theo thiết bị /
  // SLAAC privacy. Exact-match rớt; /64 (cùng mạng quán) là granularity đúng.
  it("IPv6 cùng /64 khác host: exact KHÔNG khớp (bug), /64 khớp (fix)", () => {
    const anchor = ["2401:e180:8a01:abcd::1"];
    const userOtherHost = "2401:e180:8a01:abcd:9:8:7:6";
    expect(isIpAllowed(userOtherHost, anchor)).toBe(false);
    expect(isIpAllowed(userOtherHost, anchor, { ipv6Prefix64: true })).toBe(true);
  });
  it("IPv6 khác /64 → /64 vẫn KHÔNG khớp (mạng khác)", () => {
    expect(isIpAllowed("2401:e180:8a01:ffff::1", ["2401:e180:8a01:abcd::1"], { ipv6Prefix64: true })).toBe(false);
  });
  it("IPv4 KHÔNG bị /64 ảnh hưởng (vẫn exact)", () => {
    expect(isIpAllowed("203.0.113.7", ["203.0.113.7"], { ipv6Prefix64: true })).toBe(true);
    expect(isIpAllowed("203.0.113.8", ["203.0.113.7"], { ipv6Prefix64: true })).toBe(false);
  });
});

describe("matchClientIp — CIDR/IPv4/IPv6/IPv4-mapped (yêu cầu Cloudflare)", () => {
  it("IPv4 match /32 (whitelist IP đơn lẻ vẫn chạy)", () => {
    const r = matchClientIp("113.161.5.10", ["113.161.5.10"]);
    expect(r).toMatchObject({ allowed: true, version: 4, normalized: "113.161.5.10", matchedRange: "113.161.5.10/32" });
  });
  it("IPv4 match theo CIDR /24", () => {
    expect(matchClientIp("113.161.5.200", ["113.161.5.0/24"])).toMatchObject({ allowed: true, matchedRange: "113.161.5.0/24" });
    expect(matchClientIp("113.161.6.1", ["113.161.5.0/24"]).allowed).toBe(false);
  });
  it("IPv6 match /64 (host trong /64 xoay vẫn khớp); matchedRange = network", () => {
    const r = matchClientIp("2402:800:abcd:1:aaaa:bbbb:cccc:dddd", ["2402:800:abcd:1::1"], { ipv6Prefix64: true });
    expect(r).toMatchObject({ allowed: true, version: 6, matchedRange: "2402:800:abcd:1::/64" });
  });
  it("IPv6 KHÔNG match (khác /64)", () => {
    expect(matchClientIp("2402:800:ffff:1::5", ["2402:800:abcd:1::1"], { ipv6Prefix64: true }).allowed).toBe(false);
  });
  it("IPv6 match theo CIDR /48 tường minh", () => {
    expect(matchClientIp("2402:800:abcd:beef::1", ["2402:800:abcd::/48"]).allowed).toBe(true);
    expect(matchClientIp("2402:800:abce::1", ["2402:800:abcd::/48"]).allowed).toBe(false);
  });
  it("IPv4-mapped IPv6 (::ffff:1.2.3.4) normalize về IPv4 và khớp whitelist IPv4", () => {
    const r = matchClientIp("::ffff:113.161.5.10", ["113.161.5.10"]);
    expect(r).toMatchObject({ allowed: true, version: 4, normalized: "113.161.5.10", matchedRange: "113.161.5.10/32" });
  });
  it("Khác họ (IPv4 client vs IPv6 range, và ngược lại) → KHÔNG match", () => {
    expect(matchClientIp("113.161.5.10", ["2402:800:abcd::/48"]).allowed).toBe(false);
    expect(matchClientIp("2402:800:abcd::1", ["113.161.5.0/24"]).allowed).toBe(false);
  });
  it("IP không hợp lệ → fallback an toàn (allowed=false, không throw)", () => {
    expect(matchClientIp("garbage", ["113.161.5.10"])).toMatchObject({ allowed: false, version: null, normalized: null });
    expect(matchClientIp(null, ["113.161.5.10"]).allowed).toBe(false);
    expect(matchClientIp("113.161.5.10", ["khong-phai-cidr", "999.1.1.1/33"]).allowed).toBe(false);
  });
});

describe("isValidIp (incl IPv4-mapped)", () => {
  it("nhận IPv4, IPv6, IPv4-mapped; loại rác", () => {
    expect(isValidIp("113.161.5.10")).toBe(true);
    expect(isValidIp("2402:800:abcd::1")).toBe(true);
    expect(isValidIp("::ffff:113.161.5.10")).toBe(true);
    expect(isValidIp("not-an-ip")).toBe(false);
    expect(isValidIp("999.1.1.1")).toBe(false);
    expect(isValidIp(null)).toBe(false);
  });
});
