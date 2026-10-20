import { describe, it, expect } from "vitest";
import { planSeam } from "../src/weld/seam";

describe("planSeam", () => {
  it("steps along an edge", () => {
    expect(planSeam([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], { stepMm: 5 })).toHaveLength(2);
  });
});
