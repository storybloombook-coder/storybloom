// GlassGlare.jsx — liquid-glass edge lighting for a frosted button. A
// specular hotspot TRAVELS around the button's rim as the phone tilts (see
// useDeviceTilt.js), so the button reads as a solid piece of glass catching a
// fixed light rather than wearing a painted highlight. Render it as a
// sibling right after the button's own tinted background -- TactileButton's
// own overflow:'hidden' wrapper clips it to the rounded rect for free.
//
// Local/JS port of the app shell's src/components/GlassGlare.tsx (same
// reasoning as this package's own local TactileButton.jsx: features/kolobok
// is a self-contained package, CLAUDE.md), stripped of TypeScript types --
// see that file for the full design rationale (rim dispersion, arc-length
// hotspot travel, etc.) if the comments here feel abbreviated.
//
// IMPORTANT: pass `radius` matching the button's actual borderRadius.

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

// ---------------------------------------------------------------- color

function rgba(c, a) {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a.toFixed(4)})`;
}

// ---------------------------------------------------------------- rim

const RIM_BANDS = [
  { inset: 0.0, width: 1.7, color: [122, 172, 255], alpha: 0.20 }, // cool outer fringe
  { inset: 1.4, width: 1.2, color: [203, 227, 255], alpha: 0.14 }, // blue -> white
  { inset: 2.3, width: 1.1, color: [255, 253, 248], alpha: 0.22 }, // rim core
  { inset: 3.1, width: 1.6, color: [255, 236, 200], alpha: 0.08 }, // warm inner fringe
  { inset: 4.4, width: 3.2, color: [255, 248, 235], alpha: 0.025 }, // falloff inward
];
const RIM_UNITS_TOTAL = 7.6; // last band's inset + width

const RIM_SIDE_MUL = { Top: 1.0, Bottom: 0.85, Left: 0.55, Right: 0.55 };

function rimScale(unit, radius) {
  return Math.max(0.65, Math.min(1.25, Math.min(unit / 52, (radius * 0.55) / RIM_UNITS_TOTAL)));
}

// ---------------------------------------------------------------- perimeter

const PERIMETER_SAMPLES = 96;

/** Samples the rounded-rect perimeter at CONSTANT arc-length spacing, starting
 *  at top-center and running clockwise. Returns positions (relative to
 *  center) plus unit tangents. */
function buildPerimeter(w, h, r) {
  const A = w / 2;
  const B = h / 2;
  const rr = Math.max(0, Math.min(r, Math.min(A, B)));
  const a = A - rr;
  const b = B - rr;
  const q = (Math.PI * rr) / 2; // quarter-arc length

  const arc = (cx, cy, from) => (u) => {
    const t = ((from + u * 90) * Math.PI) / 180;
    return [cx + rr * Math.cos(t), cy + rr * Math.sin(t), -Math.sin(t), Math.cos(t)];
  };

  const segs = [
    { len: a, f: (u) => [u * a, -B, 1, 0] },
    { len: q, f: arc(a, -b, -90) },
    { len: 2 * b, f: (u) => [A, -b + u * 2 * b, 0, 1] },
    { len: q, f: arc(a, b, 0) },
    { len: 2 * a, f: (u) => [a - u * 2 * a, B, -1, 0] },
    { len: q, f: arc(-a, b, 90) },
    { len: 2 * b, f: (u) => [-A, b - u * 2 * b, 0, -1] },
    { len: q, f: arc(-a, -b, 180) },
    { len: a, f: (u) => [-a + u * a, -B, 1, 0] },
  ];

  const total = segs.reduce((s, x) => s + x.len, 0);
  const xs = [];
  const ys = [];
  const txs = [];
  const tys = [];

  for (let i = 0; i < PERIMETER_SAMPLES; i += 1) {
    let d = (i / PERIMETER_SAMPLES) * total;
    for (let k = 0; k < segs.length; k += 1) {
      const seg = segs[k];
      if (d <= seg.len || k === segs.length - 1) {
        const [x, y, tx, ty] = seg.f(seg.len > 0 ? Math.min(1, d / seg.len) : 0);
        xs.push(x);
        ys.push(y);
        txs.push(tx);
        tys.push(ty);
        break;
      }
      d -= seg.len;
    }
  }

  return { xs, ys, txs, tys };
}

// ---------------------------------------------------------------- hotspots

const ORBIT_GAIN = 2.2;

const HOT_WARM = [255, 246, 226];
const HOT_COOL = [150, 196, 255];

const HOT_RINGS = [
  { scale: 1.0, alpha: 0.06 },
  { scale: 0.62, alpha: 0.10 },
  { scale: 0.33, alpha: 0.16 },
];

const HOTSPOTS = [
  {
    key: 'entry', offset: 0, radiusFraction: 0.34, tangential: 2.6, radial: 0.62,
    color: HOT_WARM, gain: 1.0,
  },
  {
    key: 'exit', offset: 0.5, radiusFraction: 0.30, tangential: 2.2, radial: 0.58,
    color: HOT_COOL, gain: 0.55,
  },
];

const INTERIOR_RINGS = [
  { scale: 1.0, alpha: 0.014 },
  { scale: 0.6, alpha: 0.018 },
];
const INTERIOR_TINT = [208, 228, 255];
const INTERIOR_RADIUS_FRACTION = 0.55;
const INTERIOR_PULL = 0.55;

// ---------------------------------------------------------------- worklets

function saturate(v) {
  'worklet';
  return (v * Math.SQRT2) / Math.sqrt(1 + v * v);
}

function orbitTurns(tiltX, tiltY) {
  'worklet';
  const dx = saturate(tiltX) * ORBIT_GAIN;
  const dy = -1 + saturate(tiltY) * ORBIT_GAIN;
  const angle = Math.atan2(dy, dx) + Math.PI / 2; // 0 at top-center
  const turns = angle / (Math.PI * 2);
  return turns - Math.floor(turns);
}

// ---------------------------------------------------------------- pieces

function RimHotspot({
  perimeter, tiltX, tiltY, offset, radius, tangential, radial, color, gain,
}) {
  const { xs, ys, txs, tys } = perimeter;
  const n = xs.length;

  const style = useAnimatedStyle(() => {
    let turns = orbitTurns(tiltX.value, tiltY.value) + offset;
    turns -= Math.floor(turns);

    const pos = turns * n;
    const i0 = Math.floor(pos) % n;
    const i1 = (i0 + 1) % n;
    const f = pos - Math.floor(pos);

    const x = xs[i0] + (xs[i1] - xs[i0]) * f;
    const y = ys[i0] + (ys[i1] - ys[i0]) * f;
    const tx = txs[i0] + (txs[i1] - txs[i0]) * f;
    const ty = tys[i0] + (tys[i1] - tys[i0]) * f;
    const deg = (Math.atan2(ty, tx) * 180) / Math.PI;

    return {
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${deg}deg` },
        { scaleX: tangential },
        { scaleY: radial },
      ],
    };
  });

  return (
    <Animated.View style={[styles.originBox, style]} pointerEvents="none">
      {HOT_RINGS.map((ring) => {
        const rr = radius * ring.scale;
        return (
          <View
            key={`h${ring.scale}`}
            style={{
              position: 'absolute',
              left: -rr,
              top: -rr,
              width: rr * 2,
              height: rr * 2,
              borderRadius: rr,
              backgroundColor: rgba(color, ring.alpha * gain),
            }}
          />
        );
      })}
    </Animated.View>
  );
}

function InteriorBloom({
  perimeter, tiltX, tiltY, radius,
}) {
  const { xs, ys } = perimeter;
  const n = xs.length;

  const style = useAnimatedStyle(() => {
    const turns = orbitTurns(tiltX.value, tiltY.value);
    const pos = turns * n;
    const i0 = Math.floor(pos) % n;
    const i1 = (i0 + 1) % n;
    const f = pos - Math.floor(pos);
    const x = xs[i0] + (xs[i1] - xs[i0]) * f;
    const y = ys[i0] + (ys[i1] - ys[i0]) * f;
    return {
      transform: [
        { translateX: x * (1 - INTERIOR_PULL) },
        { translateY: y * (1 - INTERIOR_PULL) },
      ],
    };
  });

  return (
    <Animated.View style={[styles.originBox, style]} pointerEvents="none">
      {INTERIOR_RINGS.map((ring) => {
        const rr = radius * ring.scale;
        return (
          <View
            key={`b${ring.scale}`}
            style={{
              position: 'absolute',
              left: -rr,
              top: -rr,
              width: rr * 2,
              height: rr * 2,
              borderRadius: rr,
              backgroundColor: rgba(INTERIOR_TINT, ring.alpha),
            }}
          />
        );
      })}
    </Animated.View>
  );
}

// ---------------------------------------------------------------- component

export default function GlassGlare({ tiltX, tiltY, radius, intensity = 1 }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width, height } = size;
  const unit = Math.min(width, height);
  const r = radius ?? unit / 2;

  const perimeter = useMemo(
    () => buildPerimeter(width, height, r),
    [width, height, r],
  );

  function onLayout(e) {
    const next = e.nativeEvent.layout;
    if (next.width !== size.width || next.height !== size.height) {
      setSize({ width: next.width, height: next.height });
    }
  }

  if (width === 0 || height === 0) {
    return <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none" />;
  }

  const scale = rimScale(unit, r);

  return (
    <View
      style={[StyleSheet.absoluteFill, { opacity: intensity }]}
      onLayout={onLayout}
      pointerEvents="none"
    >
      <InteriorBloom
        perimeter={perimeter}
        tiltX={tiltX}
        tiltY={tiltY}
        radius={unit * INTERIOR_RADIUS_FRACTION}
      />

      {RIM_BANDS.map((band) => {
        const inset = band.inset * scale;
        return (
          <View
            key={`r${band.inset}`}
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: inset,
              left: inset,
              right: inset,
              bottom: inset,
              borderRadius: Math.max(0, r - inset),
              borderWidth: band.width * scale,
              borderTopColor: rgba(band.color, band.alpha * RIM_SIDE_MUL.Top),
              borderBottomColor: rgba(band.color, band.alpha * RIM_SIDE_MUL.Bottom),
              borderLeftColor: rgba(band.color, band.alpha * RIM_SIDE_MUL.Left),
              borderRightColor: rgba(band.color, band.alpha * RIM_SIDE_MUL.Right),
            }}
          />
        );
      })}

      {HOTSPOTS.map((h) => (
        <RimHotspot
          key={h.key}
          perimeter={perimeter}
          tiltX={tiltX}
          tiltY={tiltY}
          offset={h.offset}
          radius={unit * h.radiusFraction}
          tangential={h.tangential}
          radial={h.radial}
          color={h.color}
          gain={h.gain}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  originBox: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 0,
    height: 0,
  },
});
