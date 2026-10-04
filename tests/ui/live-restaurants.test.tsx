import { describe, expect, it } from "vitest";
import {
  liveRestaurantFromWorkerEntry,
  webetuLocation,
  webetuLocationIsStale,
  webetuLocationToPersist,
  WEBETU_LOCATION_TTL_MS,
} from "@/src/lib/utils";

// The live-restaurants route maps each worker read-API entry through
// liveRestaurantFromWorkerEntry, so a restaurant shown in "Your Restaurants" is always
// one the preferences save path accepts.
describe("liveRestaurantFromWorkerEntry", () => {
  it("maps the worker read-API shape into a saveable restaurant", () => {
    const r = liveRestaurantFromWorkerEntry({
      name: "الإقامة الجامعية 03 باب الزوار",
      idDepot: 190,
      nameAR: "الإقامة الجامعية 03 باب الزوار",
      nameFR: "Résidence 03 Bab Ezzouar",
      meals: ["lunch", "dinner"],
    });
    expect(r).toMatchObject({
      catalogId: "onou-depot-190",
      idDepot: 190,
      name: "الإقامة الجامعية 03 باب الزوار",
      nameFR: "Résidence 03 Bab Ezzouar",
      breakfast: false,
      lunch: true,
      dinner: true,
    });
  });

  it("treats a missing meals list as no meals offered", () => {
    const r = liveRestaurantFromWorkerEntry({ name: "R", idDepot: 7 });
    expect(r).toMatchObject({ breakfast: false, lunch: false, dinner: false });
  });

  it("keeps explicit meal flags over the meals list", () => {
    const r = liveRestaurantFromWorkerEntry({ name: "R", idDepot: 7, breakfast: true, meals: [] });
    expect(r?.breakfast).toBe(true);
  });

  it("drops entries the save path would reject", () => {
    // The pre-fix worker payload: no depot id.
    expect(liveRestaurantFromWorkerEntry({ name: "R", meals: ["lunch"] })).toBeNull();
    expect(liveRestaurantFromWorkerEntry({ idDepot: 7 })).toBeNull();
    expect(liveRestaurantFromWorkerEntry({ name: "R", idDepot: 0 })).toBeNull();
    expect(liveRestaurantFromWorkerEntry(null)).toBeNull();
    expect(liveRestaurantFromWorkerEntry([{ name: "R", idDepot: 7 }])).toBeNull();
  });
});

// A saved location is sent to the worker as a query param and is the location the
// worker then books against, so a wrong one is worse than none.
describe("webetuLocation", () => {
  it("accepts an Algerian wilaya code and a positive residence id", () => {
    expect(webetuLocation("16", 5185801)).toEqual({ wilaya: "16", residence: 5185801 });
    expect(webetuLocation(" 01 ", "5185801")).toEqual({ wilaya: "01", residence: 5185801 });
  });

  it("rejects anything that is not a usable location", () => {
    expect(webetuLocation(null, 999)).toBeNull();
    expect(webetuLocation("16", null)).toBeNull();
    expect(webetuLocation("16", 0)).toBeNull();
    expect(webetuLocation("16", -1)).toBeNull();
    expect(webetuLocation("16", 1.5)).toBeNull();
    expect(webetuLocation("16", "abc")).toBeNull();
    expect(webetuLocation("", 999)).toBeNull();
    expect(webetuLocation("abc", 999)).toBeNull();
    expect(webetuLocation("-16", 999)).toBeNull();
    expect(webetuLocation("1600", 999)).toBeNull();
  });
});

// Reusing a saved location makes the worker answer "override" without checking
// anything, so a saved value is self-confirming; the TTL is what lets a wrong entry
// -- including one written by the earlier provenance bug -- ever be corrected.
describe("webetuLocationIsStale", () => {
  const now = 1_800_000_000_000;

  it("treats a recently verified location as fresh", () => {
    expect(webetuLocationIsStale(now - 1000, now)).toBe(false);
    expect(webetuLocationIsStale(now - (WEBETU_LOCATION_TTL_MS - 1), now)).toBe(false);
  });

  it("treats a location past the window as due for re-verification", () => {
    expect(webetuLocationIsStale(now - WEBETU_LOCATION_TTL_MS, now)).toBe(true);
    expect(webetuLocationIsStale(now - WEBETU_LOCATION_TTL_MS * 2, now)).toBe(true);
  });

  it("treats an unknown timestamp as stale so legacy docs get re-checked once", () => {
    expect(webetuLocationIsStale(null, now)).toBe(true);
    expect(webetuLocationIsStale(undefined, now)).toBe(true);
    expect(webetuLocationIsStale(NaN, now)).toBe(true);
  });
});

describe("webetuLocationToPersist", () => {
  const reused = { wilaya: "16", residence: 5185801 };

  it("saves a location the worker discovered for a user who has none", () => {
    expect(
      webetuLocationToPersist(
        { wilayaSource: "discovered", wilaya: "31", residence: 999 },
        null
      )
    ).toEqual({ wilaya: "31", residence: 999 });
  });

  it("corrects a location the worker discovers differently on a re-verification", () => {
    // Re-verification passes reused=null (the stale entry is deliberately not sent),
    // so a corrected location is written.
    expect(
      webetuLocationToPersist(
        { wilayaSource: "discovered", wilaya: "31", residence: 999 },
        null
      )
    ).toEqual({ wilaya: "31", residence: 999 });
  });

  it("rewrites an unchanged location after a re-verification, to refresh its age", () => {
    // Otherwise the entry stays stale and every later request re-discovers.
    expect(
      webetuLocationToPersist(
        { wilayaSource: "discovered", wilaya: "16", residence: 5185801 },
        null
      )
    ).toEqual({ wilaya: "16", residence: 5185801 });
  });

  it("writes nothing when the discovered location matches what we reused", () => {
    expect(
      webetuLocationToPersist(
        { wilayaSource: "discovered", wilaya: "16", residence: 5185801 },
        reused
      )
    ).toBeNull();
  });

  it("never saves a location the worker did not read from Webetu on this call", () => {
    // "default" is the worker's hardcoded Algiers fallback, "cache" its own local
    // state, and "override" the value we just sent it -- none is evidence about
    // where this student actually is.
    for (const wilayaSource of ["default", "cache", "override", "", undefined]) {
      expect(
        webetuLocationToPersist({ wilayaSource, wilaya: "31", residence: 999 }, null)
      ).toBeNull();
    }
  });

  it("drops a discovered location that is not usable", () => {
    for (const bad of [
      { wilaya: "31", residence: 0 },
      { wilaya: "31", residence: -1 },
      { wilaya: "31", residence: "abc" },
      { wilaya: "31" },
      { wilaya: "abc", residence: 999 },
      { residence: 999 },
    ]) {
      expect(webetuLocationToPersist({ wilayaSource: "discovered", ...bad }, null)).toBeNull();
    }
  });

  it("tolerates a missing or non-object body", () => {
    expect(webetuLocationToPersist(null, null)).toBeNull();
    expect(webetuLocationToPersist(undefined, reused)).toBeNull();
    expect(webetuLocationToPersist("nope", null)).toBeNull();
  });
});
