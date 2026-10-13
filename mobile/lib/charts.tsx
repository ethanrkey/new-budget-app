import { useCallback, useMemo, useRef, useState } from "react";
import { PanResponder, Text, View } from "react-native";
import * as feel from "./haptics";
import Svg, { Circle, Path, Polyline, Rect } from "react-native-svg";
import { T, money } from "./theme";

// Charts are HAND-ROLLED on react-native-svg rather than pulled from a
// library, and the reason is the shapes: a sparkline and a horizontal bar
// (the donut went with the pie on 2026-10-09). victory-native XL wants Skia and a lot of surface area;
// gifted-charts has opinions about layout that fight a dark, dense design.
// Three primitives of svg is less code than configuring either, works in
// Expo Go with no native build, and the web app's Recharts usage is just as
// thin. Nothing here knows what money is — values arrive pre-computed by
// the engine, same as on the web.

/**
 * A logged-balance history line you can SCRUB.
 *
 * The web gets a Recharts tooltip for free because it has a cursor. A
 * phone has no hover, so a static line is a picture of your data rather
 * than a thing you can read: the one question these charts exist to
 * answer — "what was it in August?" — had no way to be asked.
 *
 * Drag anywhere across the chart and it snaps to the nearest reading,
 * marking it and naming it above. Release and it goes back to showing the
 * newest, which is the figure printed on the card. PanResponder rather
 * than a gesture library: this needs one axis and no composition, and the
 * chart must not start fighting the ScrollView it lives in — the
 * responder claims the gesture only once the finger has moved further
 * horizontally than vertically, so a vertical flick still scrolls the
 * page.
 *
 * Touch targets: the whole plot is the target, not the 3px dots. Snapping
 * to the nearest point means a finger anywhere near the line reads the
 * value it was aiming at.
 */
/**
 * How tall a sparkline is on a phone.
 *
 * 68pt was a sparkline in the literal sense — a glyph-height trace
 * meant to be glanced at. But this one is SCRUBBED, and at 50pt of
 * plot a finger covers most of the series and small moves between
 * readings are below the noise of the touch itself. Raised to 170pt
 * 2026-10-14 after the first real session with it on a device.
 *
 * The RANGE is unchanged and stays fitted to the data: a taller box
 * showing the same lo-to-hi span magnifies the shape, which is the
 * point. Padding the range to zero would flatten every series that
 * matters here, because these are balances and they rarely start at
 * nothing.
 */
export const SPARKLINE_HEIGHT = 170;

export function Sparkline({
  points, color, width, height = SPARKLINE_HEIGHT,
}: { points: { date: string; amount: number }[]; color: string; width: number; height?: number }) {
  // WHERE YOU LEFT IT. `active` survives the release: lifting a finger
  // is not "never mind", it is "that one". Snapping back to the newest
  // reading meant the chart forgot the answer the moment you stopped
  // asking, which made it feel like it had not heard you. `touching`
  // is separate, because the crosshair belongs to the gesture and the
  // selection does not.
  const [active, setActive] = useState<number | null>(null);
  const [touching, setTouching] = useState(false);
  const PAD = 8;
  const plotH = height - 18;            // room for the readout line above

  const geom = useMemo(() => {
    if (points.length === 0) return null;
    const ys = points.map((p) => p.amount);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const span = hi - lo || Math.abs(hi) || 1;
    // SPACED BY DATE, not by index. Readings are logged whenever you
    // happen to check your bank, so the gaps between them are uneven by
    // nature; placing them one per slot makes a six-day drift and a
    // one-day drift draw the same slope, and slope is the whole message
    // of a line this small. Same change as the web chart, same day —
    // they are two renderings of one series and a disagreement between
    // them is the thing that started this.
    const t = points.map((p) => Date.parse(`${p.date}T00:00:00`));
    const t0 = t[0], tSpan = t[t.length - 1] - t0;
    const x = (i: number) => {
      if (points.length === 1) return width / 2;
      // Every reading on the same date: no time to spread over, so fall
      // back to even spacing rather than dividing by zero.
      const frac = tSpan > 0 ? (t[i] - t0) / tSpan : i / (points.length - 1);
      return frac * (width - PAD * 2) + PAD;
    };
    const y = (v: number) => plotH - PAD - ((v - lo) / span) * (plotH - PAD * 2);
    return { x, y, lo, hi };
  }, [points, width, plotH]);

  const nearest = useCallback((px: number) => {
    if (!geom || points.length === 0) return 0;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(geom.x(i) - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }, [geom, points]);

  // The last point the finger was over. A ref rather than state
  // because the comparison has to be made inside the gesture handler,
  // where a re-render has not happened yet — reading `active` here
  // would compare against the previous frame and tick twice on some
  // points and not at all on others.
  const lastTick = useRef<number | null>(null);
  const tickTo = (i: number) => {
    if (lastTick.current === i) return;
    lastTick.current = i;
    // THE ONE PLACE IN THIS APP WHERE A HAPTIC CARRIES INFORMATION a
    // glance does not: the ticks are the series' granularity. Five
    // readings over a month feel different from thirty, before the
    // numbers have been read. The readout above still says everything
    // out loud, so nothing here is only a haptic.
    feel.selection();
  };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => points.length > 1,
    // Claim the gesture only when it is clearly horizontal, so the page
    // still scrolls under a vertical flick that happens to start here.
    onMoveShouldSetPanResponder: (_e, g) => points.length > 1 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: (e) => {
      const i = nearest(e.nativeEvent.locationX);
      setTouching(true); setActive(i);
      lastTick.current = null; tickTo(i);
    },
    onPanResponderMove: (e) => {
      const i = nearest(e.nativeEvent.locationX);
      setActive(i); tickTo(i);
    },
    // Both ends of the scrub are marked. Letting go of a chart that
    // was following your finger is a state change worth feeling.
    onPanResponderRelease: () => { setTouching(false); feel.selection(); },
    onPanResponderTerminate: () => { setTouching(false); feel.selection(); },
  }), [nearest, points.length]);

  if (points.length < 2 || !geom) {
    return (
      <View style={{ height, justifyContent: "center" }}>
        <Svg width={width} height={height}>
          <Rect x={0} y={height / 2} width={width} height={1} fill={T.border} />
          {points.length === 1 && <Circle cx={width / 2} cy={height / 2} r={4} fill={color} />}
        </Svg>
      </View>
    );
  }

  const coords = points.map((p, i) => `${geom.x(i)},${geom.y(p.amount)}`);
  const shown = active ?? points.length - 1;
  const sx = geom.x(shown), sy = geom.y(points[shown]!.amount);
  // The readout is clamped inside the chart, so the first and last points
  // do not push their own label off the edge.
  const readoutW = 132;
  const left = Math.max(0, Math.min(width - readoutW, sx - readoutW / 2));

  return (
    <View style={{ height }} {...pan.panHandlers}>
      <View style={{ height: 16, justifyContent: "center" }}>
        <Text
          style={{
            position: "absolute", left, width: readoutW, textAlign: "center",
            color: active == null ? T.faint : T.text, fontSize: 11,
            fontVariant: ["tabular-nums"],
          }}
          numberOfLines={1}
        >
          {prettyDay(points[shown]!.date)}  {money(points[shown]!.amount)}
        </Text>
      </View>
      <Svg width={width} height={plotH}>
        {/* An area under the line gives the series weight without a grid,
            which at this size would be more ink than data. */}
        <Path
          d={`M${geom.x(0)},${plotH} L${coords.join(" L")} L${geom.x(points.length - 1)},${plotH} Z`}
          fill={color}
          opacity={0.12}
        />
        <Polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <Circle key={`${p.date}-${i}`} cx={geom.x(i)} cy={geom.y(p.amount)} r={2.5} fill={color} opacity={0.65} />
        ))}
        {touching && <Rect x={sx - 0.5} y={0} width={1} height={plotH} fill={T.dim} opacity={0.5} />}
        {/* The point being read is drawn with a surface ring so it stays
            legible where the line crosses it. */}
        <Circle cx={sx} cy={sy} r={touching ? 5.5 : 4} fill={color} stroke={T.surface} strokeWidth={2} />
      </Svg>
    </View>
  );
}

const prettyDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function HBar({ pct, color, width }: { pct: number; color: string; width: number }) {
  const w = Math.max(0, Math.min(1, pct)) * width;
  return (
    <Svg width={width} height={8}>
      <Rect x={0} y={0} width={width} height={8} rx={4} fill={T.surfaceAlt} />
      {w > 0 && <Rect x={0} y={0} width={w} height={8} rx={4} fill={color} />}
    </Svg>
  );
}
