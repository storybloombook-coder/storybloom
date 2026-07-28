// GlassGlare.tsx — a soft diagonal highlight over a frosted-glass (BlurView)
// button that shifts with the phone's own tilt (see lib/useDeviceTilt), so
// the glass reads as reflecting real light rather than a static blur. Render
// it as a sibling right after the button's BlurView -- TactileButton's own
// overflow:'hidden' wrapper clips it to the button's rounded rect for free.
//
// No gradient library in this app, so the soft-edged glow is faked with
// three overlapping bars of decreasing width and increasing opacity (wide +
// faint outside, narrow + brightest at the core) rather than a true gradient.

import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

// Diagonal streak, not a horizontal one -- reads more like a real specular
// reflection sweeping across a curved/tilted glass surface.
const ROTATE_DEG = '25deg';
// How far the highlight can travel from center, as a fraction of the
// button's own measured size -- so a tiny 40x40 corner circle and a
// full-width menu pill both feel like the SAME sheet of glass tilting,
// rather than the highlight sliding a fixed pixel distance regardless of
// button size.
const TRAVEL_FRACTION = 0.6;
// How much longer than the button's own diagonal the bars are drawn --
// keeps the streak's ends clear of the button's edges through its full
// travel range instead of visibly running out partway.
const BAR_LENGTH_FACTOR = 1.6;

export default function GlassGlare({
  tiltX,
  tiltY,
}: {
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }

  // rangeX/rangeY read 0 until the first onLayout measures the button, so
  // the bars just sit motionless at dead center in the meantime -- but the
  // hook itself must still run on every render (rules of hooks), so this
  // can't live behind the early-return below.
  const rangeX = size.width * TRAVEL_FRACTION;
  const rangeY = size.height * TRAVEL_FRACTION;
  const barStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tiltX.value * rangeX },
      { translateY: tiltY.value * rangeY },
      { rotate: ROTATE_DEG },
    ],
  }));

  if (size.width === 0 || size.height === 0) {
    return <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none" />;
  }

  const barLength = Math.max(size.width, size.height) * BAR_LENGTH_FACTOR;
  const baseLeft = (size.width - barLength) / 2;
  const baseTop = size.height / 2;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      <Animated.View
        style={[styles.bar, styles.barOuter, { width: barLength, left: baseLeft, top: baseTop }, barStyle]}
      />
      <Animated.View
        style={[styles.bar, styles.barMid, { width: barLength, left: baseLeft, top: baseTop }, barStyle]}
      />
      <Animated.View
        style={[styles.bar, styles.barCore, { width: barLength, left: baseLeft, top: baseTop }, barStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute' },
  barOuter: { height: 30, marginTop: -15, backgroundColor: 'rgba(255,255,255,0.06)' },
  barMid: { height: 16, marginTop: -8, backgroundColor: 'rgba(255,255,255,0.12)' },
  barCore: { height: 6, marginTop: -3, backgroundColor: 'rgba(255,255,255,0.22)' },
});
