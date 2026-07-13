import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import TactileButton from './TactileButton';

type WorkingImage = { uri: string; width: number; height: number };

const HANDLE = 32;
const MIN_CROP = 40;
const SCREEN_WIDTH = Dimensions.get('window').width;
const PREVIEW_WIDTH = SCREEN_WIDTH - 48;
const MAX_PREVIEW_HEIGHT = 460;

export default function PhotoEditor({
  visible,
  source,
  queueLabel,
  onCancel,
  onDone,
}: {
  visible: boolean;
  source: WorkingImage | null;
  /** e.g. "Photo 2 of 5" — shown when editing a batch from a multi-select pick. */
  queueLabel?: string;
  onCancel: () => void;
  onDone: (result: WorkingImage) => void;
}) {
  const isDark = useColorScheme() === 'dark';
  const textColor = isDark ? '#fff' : '#000';
  const backgroundColor = isDark ? '#000' : '#fff';

  const [image, setImage] = useState<WorkingImage | null>(null);
  const [busy, setBusy] = useState(false);

  // Crop rectangle, in preview-pixel space. Corner drags mutate these
  // directly on the UI thread — no React re-render in the drag loop, which
  // is what a PanResponder + useState version kept desyncing on.
  const rectX = useSharedValue(0);
  const rectY = useSharedValue(0);
  const rectW = useSharedValue(0);
  const rectH = useSharedValue(0);
  const tlStart = useSharedValue({ x: 0, y: 0, w: 0, h: 0 });
  const trStart = useSharedValue({ x: 0, y: 0, w: 0, h: 0 });
  const blStart = useSharedValue({ x: 0, y: 0, w: 0, h: 0 });
  const brStart = useSharedValue({ x: 0, y: 0, w: 0, h: 0 });
  const moveStart = useSharedValue({ x: 0, y: 0 });

  // Live rotation preview (radians) from the two-finger twist gesture.
  const angle = useSharedValue(0);

  useEffect(() => {
    if (visible && source) {
      // Use the picker's own uri/width/height as-is — an extra no-op
      // manipulateAsync re-encode here was stripping EXIF orientation and
      // causing camera shots to display rotated 90°.
      setImage(source);
    } else if (!visible) {
      setImage(null);
    }
  }, [visible, source]);

  const previewHeight = image
    ? Math.min(PREVIEW_WIDTH * (image.height / image.width), MAX_PREVIEW_HEIGHT)
    : 0;
  const previewWidth = image
    ? previewHeight === MAX_PREVIEW_HEIGHT
      ? MAX_PREVIEW_HEIGHT * (image.width / image.height)
      : PREVIEW_WIDTH
    : 0;

  useEffect(() => {
    if (previewWidth > 0 && previewHeight > 0) {
      rectX.value = 0;
      rectY.value = 0;
      rectW.value = previewWidth;
      rectH.value = previewHeight;
      angle.value = 0;
    }
  }, [previewWidth, previewHeight]);

  async function commitRotation(deg: number) {
    if (!image || Math.abs(deg) < 0.5) return;
    setBusy(true);
    const result = await manipulateAsync(image.uri, [{ rotate: deg }], {
      compress: 1,
      format: SaveFormat.JPEG,
    });
    setImage(result);
    setBusy(false);
  }

  async function rotate90(direction: 1 | -1) {
    if (!image) return;
    setBusy(true);
    const result = await manipulateAsync(image.uri, [{ rotate: 90 * direction }], {
      compress: 1,
      format: SaveFormat.JPEG,
    });
    setImage(result);
    setBusy(false);
  }

  async function handleSave() {
    if (!image || previewWidth === 0) return;
    const scale = image.width / previewWidth;
    const rect = {
      originX: Math.round(rectX.value * scale),
      originY: Math.round(rectY.value * scale),
      width: Math.round(rectW.value * scale),
      height: Math.round(rectH.value * scale),
    };
    const isFullBounds =
      rect.originX === 0 &&
      rect.originY === 0 &&
      rect.width === image.width &&
      rect.height === image.height;
    if (isFullBounds) {
      onDone(image);
      return;
    }
    setBusy(true);
    const result = await manipulateAsync(image.uri, [{ crop: rect }], {
      compress: 1,
      format: SaveFormat.JPEG,
    });
    setBusy(false);
    onDone(result);
  }

  const clamp = (v: number, min: number, max: number) => {
    'worklet';
    return Math.max(min, Math.min(max, v));
  };

  function triggerHaptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function makeCornerGesture(corner: 'tl' | 'tr' | 'bl' | 'br') {
    const startSV =
      corner === 'tl' ? tlStart : corner === 'tr' ? trStart : corner === 'bl' ? blStart : brStart;
    return Gesture.Pan()
      .onStart(() => {
        startSV.value = { x: rectX.value, y: rectY.value, w: rectW.value, h: rectH.value };
        runOnJS(triggerHaptic)();
      })
      .onUpdate((e) => {
        const s = startSV.value;
        if (corner === 'tl') {
          const newX = clamp(s.x + e.translationX, 0, s.x + s.w - MIN_CROP);
          const newY = clamp(s.y + e.translationY, 0, s.y + s.h - MIN_CROP);
          rectW.value = s.w + (s.x - newX);
          rectH.value = s.h + (s.y - newY);
          rectX.value = newX;
          rectY.value = newY;
        } else if (corner === 'tr') {
          const newY = clamp(s.y + e.translationY, 0, s.y + s.h - MIN_CROP);
          rectW.value = clamp(s.w + e.translationX, MIN_CROP, previewWidth - s.x);
          rectH.value = s.h + (s.y - newY);
          rectY.value = newY;
        } else if (corner === 'bl') {
          const newX = clamp(s.x + e.translationX, 0, s.x + s.w - MIN_CROP);
          rectW.value = s.w + (s.x - newX);
          rectH.value = clamp(s.h + e.translationY, MIN_CROP, previewHeight - s.y);
          rectX.value = newX;
        } else {
          rectW.value = clamp(s.w + e.translationX, MIN_CROP, previewWidth - s.x);
          rectH.value = clamp(s.h + e.translationY, MIN_CROP, previewHeight - s.y);
        }
      });
  }

  const tlGesture = makeCornerGesture('tl');
  const trGesture = makeCornerGesture('tr');
  const blGesture = makeCornerGesture('bl');
  const brGesture = makeCornerGesture('br');

  const moveGesture = Gesture.Pan()
    .onStart(() => {
      moveStart.value = { x: rectX.value, y: rectY.value };
      runOnJS(triggerHaptic)();
    })
    .onUpdate((e) => {
      rectX.value = clamp(moveStart.value.x + e.translationX, 0, previewWidth - rectW.value);
      rectY.value = clamp(moveStart.value.y + e.translationY, 0, previewHeight - rectH.value);
    });

  const rotationGesture = Gesture.Rotation()
    .onStart(() => {
      runOnJS(triggerHaptic)();
    })
    .onUpdate((e) => {
      angle.value = e.rotation;
    })
    .onEnd(() => {
      const deg = (angle.value * 180) / Math.PI;
      angle.value = 0;
      runOnJS(commitRotation)(deg);
    });

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(angle.value * 180) / Math.PI}deg` }],
  }));

  const rectAnimatedStyle = useAnimatedStyle(() => ({
    left: rectX.value,
    top: rectY.value,
    width: rectW.value,
    height: rectH.value,
  }));

  const tlHandleStyle = useAnimatedStyle(() => ({
    left: rectX.value - HANDLE / 2,
    top: rectY.value - HANDLE / 2,
  }));
  const trHandleStyle = useAnimatedStyle(() => ({
    left: rectX.value + rectW.value - HANDLE / 2,
    top: rectY.value - HANDLE / 2,
  }));
  const blHandleStyle = useAnimatedStyle(() => ({
    left: rectX.value - HANDLE / 2,
    top: rectY.value + rectH.value - HANDLE / 2,
  }));
  const brHandleStyle = useAnimatedStyle(() => ({
    left: rectX.value + rectW.value - HANDLE / 2,
    top: rectY.value + rectH.value - HANDLE / 2,
  }));

  if (!image) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <GestureHandlerRootView style={[styles.root, { backgroundColor }]}>
        <View style={styles.topBar}>
          {queueLabel && (
            <Text style={StyleSheet.flatten([styles.queueLabel, { color: textColor }])}>
              {queueLabel}
            </Text>
          )}
          <Text style={StyleSheet.flatten([styles.hint, { color: textColor }])}>
            Drag corners to crop · twist with two fingers to straighten
          </Text>
        </View>

        <View style={styles.previewArea}>
          <GestureDetector gesture={rotationGesture}>
            <View style={{ width: previewWidth, height: previewHeight }}>
              <Animated.View style={[{ width: previewWidth, height: previewHeight }, imageAnimatedStyle]}>
                <Image
                  source={{ uri: image.uri }}
                  style={{ width: previewWidth, height: previewHeight }}
                  contentFit="contain"
                />
              </Animated.View>

              <GestureDetector gesture={moveGesture}>
                <Animated.View style={[styles.cropRect, rectAnimatedStyle]} />
              </GestureDetector>

              <GestureDetector gesture={tlGesture}>
                <Animated.View style={[styles.handle, tlHandleStyle]} />
              </GestureDetector>
              <GestureDetector gesture={trGesture}>
                <Animated.View style={[styles.handle, trHandleStyle]} />
              </GestureDetector>
              <GestureDetector gesture={blGesture}>
                <Animated.View style={[styles.handle, blHandleStyle]} />
              </GestureDetector>
              <GestureDetector gesture={brGesture}>
                <Animated.View style={[styles.handle, brHandleStyle]} />
              </GestureDetector>
            </View>
          </GestureDetector>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.toolbarLeft}>
            <TactileButton style={styles.iconButton} onPress={() => rotate90(-1)} disabled={busy}>
              <Text style={styles.iconGlyph}>⟲</Text>
              <Text style={StyleSheet.flatten([styles.iconLabel, { color: textColor }])}>
                Rotate Left
              </Text>
            </TactileButton>
            <TactileButton style={styles.iconButton} onPress={() => rotate90(1)} disabled={busy}>
              <Text style={styles.iconGlyph}>⟳</Text>
              <Text style={StyleSheet.flatten([styles.iconLabel, { color: textColor }])}>
                Rotate Right
              </Text>
            </TactileButton>
          </View>

          <View style={styles.toolbarRight}>
            <TactileButton
              style={StyleSheet.flatten([styles.circleCancel, { backgroundColor: isDark ? '#1c1c1e' : '#f2f2f2' }])}
              onPress={onCancel}
            >
              <Text style={StyleSheet.flatten([styles.circleGlyphCancel, { color: textColor }])}>↩</Text>
            </TactileButton>
            <TactileButton style={styles.circleAccept} onPress={handleSave} disabled={busy}>
              {busy ? <ActivityIndicator color="#208AEF" /> : <Text style={styles.circleGlyphAccept}>✓</Text>}
            </TactileButton>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    gap: 4,
  },
  queueLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  hint: {
    fontSize: 11,
    textAlign: 'center',
    opacity: 0.5,
  },
  previewArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropRect: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#208AEF',
    backgroundColor: 'rgba(32,138,239,0.08)',
  },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: '#208AEF',
    borderWidth: 2,
    borderColor: '#fff',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
  },
  toolbarLeft: {
    flexDirection: 'row',
    gap: 32,
  },
  toolbarRight: {
    flexDirection: 'row',
    gap: 16,
  },
  iconButton: {
    alignItems: 'center',
    gap: 4,
  },
  iconGlyph: {
    fontSize: 34,
    color: '#208AEF',
  },
  iconLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  circleCancel: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,69,58,0.15)',
  },
  circleAccept: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(32,138,239,0.15)',
    borderWidth: 2,
    borderColor: '#208AEF',
  },
  circleGlyphCancel: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ff453a',
  },
  circleGlyphAccept: {
    fontSize: 24,
    fontWeight: '700',
    color: '#208AEF',
  },
});
