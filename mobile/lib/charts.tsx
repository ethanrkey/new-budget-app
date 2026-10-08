import { View } from "react-native";
import Svg, { Circle, G, Path, Polyline, Rect } from "react-native-svg";
import { T } from "./theme";

// Charts are HAND-ROLLED on react-native-svg rather than pulled from a
// library, and the reason is the shapes: a donut, a sparkline and a
// horizontal bar. victory-native XL wants Skia and a lot of surface area;
// gifted-charts has opinions about layout that fight a dark, dense design.
// Three primitives of svg is less code than configuring either, works in
// Expo Go with no native build, and the web app's Recharts usage is just as
// thin. Nothing here knows what money is — values arrive pre-computed by
// the engine, same as on the web.

const TAU = Math.PI * 2;

/** One donut arc. Angles in turns (0..1), clockwise from 12 o'clock. */
function arc(cx: number, cy: number, rOuter: number, rInner: number, from: number, to: number) {
  // A full ring has no start/end to draw an arc between — svg collapses it.
  const span = Math.min(to - from, 0.9999);
  const a0 = from * TAU - Math.PI / 2;
  const a1 = (from + span) * TAU - Math.PI / 2;
  const big = span > 0.5 ? 1 : 0;
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(rOuter, a0), [x1, y1] = p(rOuter, a1);
  const [x2, y2] = p(rInner, a1), [x3, y3] = p(rInner, a0);
  return `M${x0} ${y0} A${rOuter} ${rOuter} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${rInner} ${rInner} 0 ${big} 0 ${x3} ${y3} Z`;
}

export function Donut({ data, size = 150 }: { data: { key: string; amount: number; fill: string }[]; size?: number }) {
  const total = data.reduce((n, d) => n + d.amount, 0);
  const r = size / 2;
  let cursor = 0;
  return (
    <Svg width={size} height={size}>
      <G>
        {total <= 0 ? (
          <Circle cx={r} cy={r} r={r * 0.75} stroke={T.border} strokeWidth={r * 0.36} fill="none" />
        ) : (
          data.map((d) => {
            const share = d.amount / total;
            const path = arc(r, r, r * 0.95, r * 0.57, cursor, cursor + share);
            cursor += share;
            // A 2px surface-colored stroke is the gap between segments —
            // adjacent fills touching is the single most common way a donut
            // reads as one blob.
            return <Path key={d.key} d={path} fill={d.fill} stroke={T.bg} strokeWidth={2} />;
          })
        )}
      </G>
    </Svg>
  );
}

/** A logged-balance history line. Dates are already sorted by the engine. */
export function Sparkline({
  points, color, width, height = 52,
}: { points: { date: string; amount: number }[]; color: string; width: number; height?: number }) {
  if (points.length < 2) {
    return (
      <View style={{ height, justifyContent: "center" }}>
        <Svg width={width} height={height}>
          <Rect x={0} y={height / 2} width={width} height={1} fill={T.border} />
          {points.length === 1 && <Circle cx={width / 2} cy={height / 2} r={3.5} fill={color} />}
        </Svg>
      </View>
    );
  }
  const ys = points.map((p) => p.amount);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const span = hi - lo || 1;
  const pad = 6;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((p.amount - lo) / span) * (height - pad * 2);
    return `${x},${y}`;
  });
  const last = coords[coords.length - 1].split(",");
  return (
    <Svg width={width} height={height}>
      <Polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" />
      {/* The newest reading is the one being read; mark it. */}
      <Circle cx={Number(last[0])} cy={Number(last[1])} r={3.5} fill={color} />
    </Svg>
  );
}

export function HBar({ pct, color, width }: { pct: number; color: string; width: number }) {
  const w = Math.max(0, Math.min(1, pct)) * width;
  return (
    <Svg width={width} height={8}>
      <Rect x={0} y={0} width={width} height={8} rx={4} fill={T.surfaceAlt} />
      {w > 0 && <Rect x={0} y={0} width={w} height={8} rx={4} fill={color} />}
    </Svg>
  );
}
