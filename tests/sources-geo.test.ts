import { describe, expect, it } from "vitest";
import { canonicalCity, countryFromName, mergeLocations, normalizeCountryCode, parseLocation, parsePlace, toGeo, workplaceMode } from "@/lib/sources/geo";

describe("country names and codes", () => {
  it("reads English names, aliases and Chinese names", () => {
    expect(countryFromName("Germany")).toBe("DE");
    expect(countryFromName("United Kingdom")).toBe("GB");
    expect(countryFromName("UK")).toBe("GB");
    expect(countryFromName("U.S.")).toBe("US");
    expect(countryFromName("The Netherlands")).toBe("NL");
    expect(countryFromName("Türkiye")).toBe("TR");
    expect(countryFromName("美国")).toBe("US");
    expect(countryFromName("Atlantis")).toBeNull();
  });
  it("normalises codes, mapping common non-ISO ones", () => {
    expect(normalizeCountryCode("uk")).toBe("GB");
    expect(normalizeCountryCode("de")).toBe("DE");
    expect(normalizeCountryCode("EU")).toBeNull();
    expect(normalizeCountryCode("ZZ")).toBeNull();
  });
});

describe("parsePlace", () => {
  it("city + US state code", () => expect(parsePlace("Austin, TX")).toEqual({ country: "US", city: "Austin" }));
  it("city + Canadian province", () => expect(parsePlace("Toronto, ON")).toEqual({ country: "CA", city: "Toronto" }));
  it("London, ON is Canada, not the UK", () => expect(parsePlace("London, ON").country).toBe("CA"));
  it("Perth, WA is Australia (the city decides)", () => expect(parsePlace("Perth, WA").country).toBe("AU"));
  it("Seattle, WA is the US", () => expect(parsePlace("Seattle, WA").country).toBe("US"));
  it("city + ISO country code", () => expect(parsePlace("Berlin, DE")).toEqual({ country: "DE", city: "Berlin" }));
  it("city, region, country", () => expect(parsePlace("Bengaluru, Karnataka, India")).toEqual({ country: "IN", city: "Bengaluru" }));
  it("a known city alone", () => expect(parsePlace("Vienna")).toEqual({ country: "AT", city: "Vienna" }));
  it("an unknown word alone is not a city", () => expect(parsePlace("Flexible")).toEqual({ country: null, city: null }));
  it("an unknown city next to a state is kept", () => expect(parsePlace("Lehi, UT")).toEqual({ country: "US", city: "Lehi" }));
  it("a country alone has no city", () => expect(parsePlace("Singapore")).toEqual({ country: "SG", city: null }));
  it("Chinese city names", () => expect(parsePlace("上海")).toEqual({ country: "CN", city: "上海" }));
});

describe("parseLocation", () => {
  it("several places separated by semicolons", () => {
    const p = parseLocation("New York, NY; San Mateo, CA");
    expect(p.countries).toEqual(["US"]);
    expect(p.cities).toEqual(["New York", "San Mateo"]);
    expect(p.remote).toBeNull();
  });
  it("remote within a country", () => {
    for (const s of ["Remote - United States", "Remote, US", "US Remote", "United States (Remote)", "Remote (US)"]) {
      const p = parseLocation(s);
      expect(p.remote, s).toBe("remote");
      expect(p.countries, s).toEqual(["US"]);
      expect(p.worldwide, s).toBe(false);
    }
  });
  it("remote anywhere is worldwide", () => {
    expect(parseLocation("Anywhere")).toMatchObject({ remote: "remote", worldwide: true });
    expect(parseLocation("Remote - Worldwide")).toMatchObject({ remote: "remote", worldwide: true });
  });
  it("anywhere in a country is remote there, not worldwide", () => {
    expect(parseLocation("Anywhere in France")).toMatchObject({ remote: "remote", worldwide: false, countries: ["FR"] });
    expect(parseLocation("Anywhere in France, Belgium, Spain").countries).toEqual(["FR", "BE", "ES"]);
  });
  it("reads run-together Japanese and Chinese addresses", () => {
    expect(parseLocation("福岡県福岡市")).toMatchObject({ countries: ["JP"], cities: ["福岡"] });
    expect(parseLocation("北京市朝阳区")).toMatchObject({ countries: ["CN"], cities: ["北京"] });
  });
  it("a bare work mode is not a place", () => {
    expect(parseLocation("Hybrid")).toEqual({ countries: [], cities: [], remote: "hybrid", worldwide: false, regions: [] });
  });
  it("a global talent pool is worldwide but not called remote", () => {
    expect(parseLocation("Global")).toMatchObject({ remote: null, worldwide: true });
  });
  it("regions are kept as labels, expanded only when unambiguous", () => {
    const emea = parseLocation("Remote (EMEA)");
    expect(emea).toMatchObject({ remote: "remote", countries: [], regions: ["EMEA"] });
    expect(parseLocation("Remote - DACH").countries).toEqual(["DE", "AT", "CH"]);
    expect(parseLocation("US & Canada").countries).toEqual(expect.arrayContaining(["US", "CA"]));
  });
  it("hybrid wins over remote words in the same string", () => {
    expect(parseLocation("Hybrid - London, UK")).toMatchObject({ remote: "hybrid", countries: ["GB"], cities: ["London"] });
  });
  it("on-site is read when stated", () => expect(parseLocation("On-site, Munich").remote).toBe("onsite"));
  it("empty input is unknown, not a guess", () => {
    expect(parseLocation("")).toEqual({ countries: [], cities: [], remote: null, worldwide: false, regions: [] });
    expect(parseLocation(null)).toEqual({ countries: [], cities: [], remote: null, worldwide: false, regions: [] });
  });
});

describe("mergeLocations / toGeo / workplaceMode", () => {
  it("unions places, canonicalises city spellings and keeps the most flexible mode", () => {
    const m = mergeLocations([parseLocation("Bangalore, India"), parseLocation("Bengaluru, Karnataka, India"), { remote: "remote", countries: ["IN"] }]);
    expect(m.countries).toEqual(["IN"]);
    expect(m.cities).toEqual(["Bengaluru"]);
    expect(m.remote).toBe("remote");
    expect(toGeo(m)).toEqual({ countries: ["IN"], cities: ["Bengaluru"], remote: "remote", worldwide: false });
  });
  it("drops non-ISO country codes", () => expect(mergeLocations([{ countries: ["US", "EU", "XX"] }]).countries).toEqual(["US"]));
  it("canonical city names", () => {
    expect(canonicalCity("München")).toBe("Munich");
    expect(canonicalCity("NYC")).toBe("New York");
    expect(canonicalCity("Lehi")).toBe("Lehi");
  });
  it("maps ATS workplace types", () => {
    expect(workplaceMode("Remote")).toBe("remote");
    expect(workplaceMode("OnSite")).toBe("onsite");
    expect(workplaceMode("on-site")).toBe("onsite");
    expect(workplaceMode("hybrid")).toBe("hybrid");
    expect(workplaceMode("unspecified")).toBeNull();
    expect(workplaceMode(null)).toBeNull();
  });
});
