import { describe, expect, it } from "vitest";
import { liveWebetuRestaurantFromPayload } from "@/src/lib/utils";

// The live-restaurants route (app/webetu/restaurants/live/route.ts) normalizes each
// worker restaurant with liveWebetuRestaurantFromPayload — the same function the
// preferences save path validates against — so a restaurant shown in "Your Restaurants"
// is always saveable. These lock in the depot-id key handling that regressed and
// produced "restaurant idDepot is required." on selection.
describe("liveWebetuRestaurantFromPayload (live restaurant normalization)", () => {
  it("reads the depot id from the idDepot key", () => {
    const r = liveWebetuRestaurantFromPayload({ idDepot: 123, name: "R" });
    expect(r.idDepot).toBe(123);
    expect(r.catalogId).toBe("onou-depot-123");
  });

  it("falls back to the id_depot key when idDepot is absent", () => {
    const r = liveWebetuRestaurantFromPayload({ id_depot: 456, name: "R" });
    expect(r.idDepot).toBe(456);
    expect(r.catalogId).toBe("onou-depot-456");
  });

  it("falls back to the id key when idDepot and id_depot are absent", () => {
    const r = liveWebetuRestaurantFromPayload({ id: 789, name: "R" });
    expect(r.idDepot).toBe(789);
    expect(r.catalogId).toBe("onou-depot-789");
  });

  it("throws when no usable depot id is present", () => {
    expect(() => liveWebetuRestaurantFromPayload({ name: "R" })).toThrow(
      /idDepot is required/,
    );
  });
});
