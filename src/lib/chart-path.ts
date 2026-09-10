/**
 * Path helpers shared by the analytics charts.
 */

/**
 * Monotone cubic Hermite spline.
 *
 * A plain Catmull-Rom would round the corners more prettily but overshoots on
 * a sharp turn — it would draw the team above 100 or below a trough it never
 * reached, which is a chart telling a small lie for a nicer curve. The
 * monotone variant is constrained to never leave the interval between two
 * neighbouring points.
 */
export function monotonePath(points: Array<{ x: number; y: number }>): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i];
  }

  const tangent: number[] = new Array(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent[i] = 0; // Local extremum: flatten so the curve cannot overshoot.
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangent[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d +=
      ` C ${points[i].x + h} ${points[i].y + tangent[i] * h}` +
      ` ${points[i + 1].x - h} ${points[i + 1].y - tangent[i + 1] * h}` +
      ` ${points[i + 1].x} ${points[i + 1].y}`;
  }
  return d;
}
