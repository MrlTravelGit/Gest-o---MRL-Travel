import { describe, expect, it } from "vitest";
import { getDefaultExchangeRateDate } from "./exchange-rate-date";

describe("getDefaultExchangeRateDate", () => {
  it.each([
    ["segunda-feira", "2026-09-14T15:00:00Z", "2026-09-14"],
    ["sexta-feira", "2026-09-18T15:00:00Z", "2026-09-18"],
    ["sábado", "2026-09-19T15:00:00Z", "2026-09-18"],
    ["domingo", "2026-09-20T15:00:00Z", "2026-09-18"],
  ])("usa a data esperada na %s", (_label, input, expected) => {
    expect(getDefaultExchangeRateDate(new Date(input))).toBe(expected);
  });

  it("considera o calendário do Brasil perto da virada UTC", () => {
    expect(getDefaultExchangeRateDate(new Date("2026-09-19T01:30:00Z"))).toBe("2026-09-18");
  });
});
