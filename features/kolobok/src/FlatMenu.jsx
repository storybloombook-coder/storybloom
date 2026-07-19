import { StyleSheet, View, Text, Pressable } from 'react-native';
import { MENU } from './config/menu';
import { t } from './config/strings';

/** Pure-RN fallback menu (SPEC.md "Scene modes"): zero three.js/GL cost --
 *  this file imports nothing from three/@react-three/fiber/expo-gl, so it
 *  stays safe to render even when the 3D branch can't (no WebGL, repeated
 *  GL failures, or the user has reduce-motion on). Same onNavigate contract
 *  and accessibility labels as the crossroads stone it mirrors. */
export function FlatMenu({ onNavigate, locale }) {
  const navigate = (route) => {
    if (onNavigate) onNavigate(route);
    else console.log('[kolobok] navigate ->', route);
  };

  return (
    <View style={styles.root}>
      <View style={styles.gradientTop} />
      <View style={styles.gradientBottom} />

      <View style={styles.mascot}>
        <View style={styles.mascotFace}>
          <View style={styles.mascotEye} />
          <View style={styles.mascotEye} />
        </View>
      </View>

      <View style={styles.menuStack}>
        {MENU.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={t(item.labelKey, locale)}
            onPress={() => navigate(item.route)}
            style={styles.pill}
          >
            <Text style={styles.pillText}>{t(item.labelKey, locale)}</Text>
            <View style={[styles.pillUnderline, { backgroundColor: item.accent }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Two stacked flat-color Views standing in for a gradient (no gradient
  // lib in the allowed-dependency list) -- a soft top-to-bottom transition
  // from #f6e7c8 to #efe0d0.
  gradientTop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#f6e7c8' },
  gradientBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', backgroundColor: '#efe0d0' },
  mascot: { marginBottom: 36 },
  mascotFace: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f2c14e',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  mascotEye: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3a2c1a' },
  menuStack: { width: '78%', gap: 14 },
  pill: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  pillText: { fontSize: 16, fontWeight: '600', color: '#2e2a22' },
  pillUnderline: { width: 28, height: 3, borderRadius: 2, marginTop: 6 },
});
