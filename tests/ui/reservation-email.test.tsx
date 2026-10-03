import { describe, expect, it } from "vitest";
import { buildResultHtml } from "@/src/lib/email";
import { normalizeRunResults } from "@/src/domains/dashboard";

describe("buildResultHtml", () => {
  const results = [
    { date: "2026-07-01", status: "already_booked", mealsBooked: 3, mealsTotal: 3, restaurant: "Résidence Attar" },
    { date: "2026-07-02", status: "success", mealsBooked: 3, mealsTotal: 3, restaurant: "Résidence Attar" },
    { date: "2026-07-03", status: "failed", mealsBooked: 0, mealsTotal: 3, restaurant: "" },
  ];

  it("renders a per-date breakdown when results are present", () => {
    const html = buildResultHtml("partial", "2 of 3 confirmed", results);
    expect(html).toContain("Reservation results:");
    // Each date appears with its label and meal count.
    expect(html).toContain("2026-07-01");
    expect(html).toContain("Already booked");
    expect(html).toContain("(3/3 meals)");
    expect(html).toContain("Résidence Attar");
    // A failed date is marked not completed, with no fabricated meal count.
    expect(html).toContain("2026-07-03");
    expect(html).toContain("Not completed");
    expect(html).not.toContain("(0/3 meals)");
  });

  it("falls back to the summary line when no results are present", () => {
    const html = buildResultHtml("success", "3 meal reservation(s) confirmed", []);
    expect(html).not.toContain("Reservation results:");
    expect(html).toContain("3 meal reservation(s) confirmed");
  });

  it("escapes HTML in restaurant names", () => {
    const html = buildResultHtml("success", null, [
      { date: "2026-07-01", status: "success", mealsBooked: 1, mealsTotal: 1, restaurant: "<script>x</script>" },
    ]);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("normalizeRunResults", () => {
  it("drops non-arrays and malformed entries, keeping valid ones", () => {
    expect(normalizeRunResults(null)).toEqual([]);
    expect(normalizeRunResults("nope")).toEqual([]);
    const out = normalizeRunResults([
      { date: "2026-07-01", status: "success", mealsBooked: 3, mealsTotal: 3, restaurant: "R" },
      { status: "success" }, // no date -> dropped
      null,
      42,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-07-01");
  });

  it("clamps meal counts to 0..3 and truncates long strings", () => {
    const out = normalizeRunResults([
      { date: "2026-07-01", status: "success", mealsBooked: 99, mealsTotal: -5, restaurant: "x".repeat(200) },
    ]);
    expect(out[0].mealsBooked).toBe(3);
    expect(out[0].mealsTotal).toBe(0);
    expect(out[0].restaurant.length).toBe(120);
  });

  it("caps the number of entries at 40", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-07-${i}`,
      status: "success",
      mealsBooked: 1,
      mealsTotal: 1,
      restaurant: "",
    }));
    expect(normalizeRunResults(many)).toHaveLength(40);
  });
});
