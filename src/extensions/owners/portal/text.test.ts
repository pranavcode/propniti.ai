import { describe, expect, it } from "vitest";
import { extraDetail } from "./text";

describe("extraDetail", () => {
  it("drops a leading room and the title a portal request repeats", () => {
    expect(extraDetail("Water is leaking under the kitchen sink and the cabinet floor is wet", "Kitchen Water is leaking under the kitchen sink and the cabinet floor is wet. It started this morning.")).toBe("It started this morning.");
    expect(extraDetail("The AC is running but blowing warm air since last night", "Whole apartment The AC is running but blowing warm air since last night")).toBeNull();
  });
  it("drops the seeded title and unit, or keeps the unit for vendors", () => {
    expect(extraDetail("Kitchen sink leaking under cabinet", "Kitchen sink leaking under cabinet · #2102. Resident reports the issue; please schedule.")).toBe("Resident reports the issue; please schedule.");
    expect(extraDetail("Breaker keeps tripping", "Breaker keeps tripping · #Suite 108. Resident reports the issue.")).toBe("Resident reports the issue.");
    expect(extraDetail("Kitchen sink leaking under cabinet", "Kitchen sink leaking under cabinet · #2102. Please schedule.", { keepUnit: true })).toBe("#2102. Please schedule.");
  });
  it("keeps a description that doesn't start with the title", () => {
    expect(extraDetail("AC not cooling", "Thermostat set to 72, unit reads 81.")).toBe("Thermostat set to 72, unit reads 81.");
    expect(extraDetail("Leak", null)).toBeNull();
  });
});
