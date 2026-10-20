// The robot controller's program format: one MOVL line per waypoint.
import type { Point } from "./seam";

export function toProgram(name: string, points: Point[], speedMmS = 8): string {
  const lines = points.map((p, i) => `MOVL P${i + 1} X=${p.x.toFixed(2)} Y=${p.y.toFixed(2)} Z=${p.z.toFixed(2)} V=${speedMmS}`);
  return [`NOP ${name}`, ...lines, "END"].join("\n");
}
