import { describe, it, expect } from "vitest";
import { normalizeForSearch, matchesSearch } from "../normalize-search";

describe("normalizeForSearch", () => {
  it("lowercases", () => {
    expect(normalizeForSearch("CÀ Phê")).toBe("ca phe");
  });

  it("maps đ and Đ to d", () => {
    expect(normalizeForSearch("Đá")).toBe("da");
    expect(normalizeForSearch("đường")).toBe("duong");
  });

  it("strips combining diacritics via NFD", () => {
    expect(normalizeForSearch("Sữa")).toBe("sua");
    expect(normalizeForSearch("Cà phê sữa đá")).toBe("ca phe sua da");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeForSearch("  Sữa  ")).toBe("sua");
  });
});

describe("matchesSearch", () => {
  it("matches 'sua' against milk products", () => {
    expect(matchesSearch("Sữa tươi", "sua")).toBe(true);
    expect(matchesSearch("Sữa đặc", "sua")).toBe(true);
  });

  it("matches 'da' against Đá and 'Cà phê sữa đá'", () => {
    expect(matchesSearch("Đá", "da")).toBe(true);
    expect(matchesSearch("Cà phê sữa đá", "da")).toBe(true);
  });

  it("matches 'd' prefix against Đá and Đường (corrected from spec)", () => {
    expect(matchesSearch("Đá", "d")).toBe(true);
    expect(matchesSearch("Đường", "d")).toBe(true);
  });

  it("'ca' matches both 'Cà phê' and 'Cacao' (substring, diacritic-free)", () => {
    expect(matchesSearch("Cà phê", "ca")).toBe(true);
    expect(matchesSearch("Cacao", "ca")).toBe(true);
  });

  it("is case-insensitive in both directions", () => {
    expect(matchesSearch("Sữa tươi", "SUA")).toBe(true);
    expect(matchesSearch("CACAO", "ca")).toBe(true);
  });

  it("returns true for an empty/whitespace query (show everything)", () => {
    expect(matchesSearch("Bất kỳ", "")).toBe(true);
    expect(matchesSearch("Bất kỳ", "   ")).toBe(true);
  });

  it("returns false when the query is absent from the haystack", () => {
    expect(matchesSearch("Cà phê", "tra")).toBe(false);
  });
});
