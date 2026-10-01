import { describe, expect, it } from "vitest";
import { liveRestaurantFromWorkerEntry } from "@/src/lib/utils";

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
