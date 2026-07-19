import { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet, View, Text, Pressable, AccessibilityInfo, StatusBar, Platform,
} from 'react-native';
import { FlatMenu } from './FlatMenu';
import { ErrorBoundary } from './ErrorBoundary';
import { useSceneStore } from './state/sceneStore';
import { t } from './config/strings';

// Plain `top: 12` renders (and, worse, is TOUCHABLE) partly underneath the
// Android status bar -- confirmed on-device via uiautomator: the button's
// own bounds sat inside the status bar's screen region and taps there were
// unreliable. `StatusBar.currentHeight` is Android-only (undefined on iOS,
// which insets differently); no new dependency needed since
// react-native-safe-area-context isn't in this package's allowed list.
const TOGGLE_TOP = (Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 0) + 12;

/** SPEC.md "Scene modes": the ONLY file in this package that knows both
 *  branches exist. Flat is pure RN (FlatMenu.jsx); 3D lives in Scene3D.jsx,
 *  loaded via a conditional `require()` (not a static import) so that
 *  three/@react-three/fiber/expo-gl are never evaluated at all while in flat
 *  mode -- not just unrendered, but never even module-initialized. That
 *  matters because a device with no usable GL could plausibly throw from
 *  those modules' own top-level/native-init code, which a static import
 *  would let take the whole screen down before anything renders.
 *
 *  Rescue is ErrorBoundary-only (no separate soft-error counter): this
 *  R3F-native version's Canvas has no onError prop -- it catches its own
 *  internal errors and re-throws them during render instead, which the
 *  ErrorBoundary below already catches. A second, unverified error channel
 *  would just be dead code pretending to be a safety net. */
export function MainScreen({
  onNavigate, initialSceneMode, onSceneModeChange, onSceneError,
}) {
  const locale = useSceneStore((s) => s.locale);
  // Flat is the safe default while we don't yet know: flashing the 3D scene
  // even briefly at a reduce-motion user is exactly what that setting exists
  // to prevent.
  const [sceneMode, setSceneModeState] = useState(initialSceneMode ?? 'flat');

  const setSceneMode = (mode) => {
    setSceneModeState(mode);
    onSceneModeChange?.(mode);
  };

  useEffect(() => {
    if (initialSceneMode) return undefined;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (!cancelled && !reduceMotion) setSceneMode('3d');
    });
    return () => { cancelled = true; };
    // Intentionally once: this is a one-time initial default, not a live
    // subscription -- the explicit toggle button is what changes mode after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rescueToFlat = (error) => {
    onSceneError?.(error);
    setSceneMode('flat');
  };

  const toggleMode = () => setSceneMode(sceneMode === '3d' ? 'flat' : '3d');

  const Scene3D = useMemo(() => {
    if (sceneMode !== '3d') return null;
    // eslint-disable-next-line global-require
    return require('./Scene3D').Scene3D;
  }, [sceneMode]);

  return (
    <View style={styles.root}>
      {sceneMode === '3d' && Scene3D ? (
        <ErrorBoundary onError={rescueToFlat}>
          <Scene3D onNavigate={onNavigate} />
        </ErrorBoundary>
      ) : (
        <FlatMenu onNavigate={onNavigate} locale={locale} />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sceneMode === '3d' ? t('ui.toggleFlat', locale) : t('ui.toggle3d', locale)}
        onPress={toggleMode}
        style={[styles.toggle, { top: TOGGLE_TOP }]}
        hitSlop={8}
      >
        <Text style={styles.toggleText}>{sceneMode === '3d' ? '☰' : '3D'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6e7c8' },
  toggle: {
    position: 'absolute',
    // top comes from TOGGLE_TOP (status-bar-aware) via the inline style
    // array where this is used. Right-12 is the "top-right corner" per
    // SPEC.md "Scene modes".
    right: 12,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleText: { fontSize: 15, fontWeight: '700', color: '#2e2a22' },
});
