// Seam planning: turns a CAD edge into robot waypoints. planSeam() runs for every seam of a job.
export interface Point { x: number; y: number; z: number }
export interface SeamOptions { stepMm: number; weave?: { amplitudeMm: number; frequencyHz: number } }

export function planSeam(edge: Point[], opts: SeamOptions): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < edge.length; i++) {
    const a = edge[i - 1], b = edge[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / opts.stepMm));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return opts.weave ? applyWeave(out, opts.weave) : out;
}

export function applyWeave(points: Point[], weave: { amplitudeMm: number; frequencyHz: number }): Point[] {
  return points.map((p, i) => ({ ...p, y: p.y + weave.amplitudeMm * Math.sin(i * weave.frequencyHz) }));
}
