import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  LinearTransition,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import TactileButton from './TactileButton';

export const THUMB_SIZE = 96;
const GRID_GAP = 12;
const CELL = THUMB_SIZE + GRID_GAP;

function triggerDragHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export default function DraggableThumb({
  index,
  uri,
  columns,
  totalCount,
  textColor,
  draggingIndex,
  targetIndex,
  onReorder,
  onEdit,
  onRemove,
}: {
  index: number;
  uri: string;
  columns: number;
  totalCount: number;
  textColor: string;
  /** Shared across every thumbnail in the grid: -1 when nothing is being dragged. */
  draggingIndex: SharedValue<number>;
  targetIndex: SharedValue<number>;
  onReorder: (from: number, to: number) => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const wiggle = useSharedValue(0);
  // True from onStart until this thumb's own release animation settles --
  // see DraggablePageCard.tsx's isSettlingOut for why this can't just be
  // `draggingIndex.value === index` (that flips false the instant the drag
  // ends, abandoning the translateX/Y settle animation mid-flight for an
  // instant snap to 0 before layout={LinearTransition} even starts).
  const isSettlingOut = useSharedValue(false);

  function computeTargetIndex(dx: number, dy: number) {
    'worklet';
    const col = index % columns;
    const row = Math.floor(index / columns);
    const centerX = col * CELL + dx + THUMB_SIZE / 2;
    const centerY = row * CELL + dy + THUMB_SIZE / 2;
    let targetCol = Math.round((centerX - THUMB_SIZE / 2) / CELL);
    let targetRow = Math.round((centerY - THUMB_SIZE / 2) / CELL);
    targetCol = Math.min(Math.max(targetCol, 0), columns - 1);
    targetRow = Math.max(targetRow, 0);
    return Math.min(Math.max(targetRow * columns + targetCol, 0), totalCount - 1);
  }

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(350)
    .onStart(() => {
      dragging.value = 1;
      isSettlingOut.value = true;
      draggingIndex.value = index;
      targetIndex.value = index;
      runOnJS(triggerDragHaptic)();
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      targetIndex.value = computeTargetIndex(e.translationX, e.translationY);
    })
    .onEnd((e) => {
      const target = computeTargetIndex(e.translationX, e.translationY);
      const onSettled = (finished?: boolean) => {
        if (finished) isSettlingOut.value = false;
      };
      translateX.value = withTiming(0, undefined, onSettled);
      translateY.value = withTiming(0);
      dragging.value = 0;
      draggingIndex.value = -1;
      targetIndex.value = -1;
      if (target !== index) {
        runOnJS(onReorder)(index, target);
      }
    });

  useAnimatedReaction(
    () => draggingIndex.value !== -1 && draggingIndex.value !== index,
    (shouldWiggle, previous) => {
      if (shouldWiggle === previous) return;
      if (shouldWiggle) {
        wiggle.value = withRepeat(withSequence(withTiming(-2.5, { duration: 120 }), withTiming(2.5, { duration: 120 })), -1, true);
      } else {
        wiggle.value = withTiming(0, { duration: 100 });
      }
    }
  );

  // Single combined transform: this item's own drag offset (if it's the one
  // being dragged), OR a live "make room" shift (if the drag's current
  // target would displace it), plus the shared wiggle + press scale. RN
  // doesn't merge `transform` across separate style objects, so everything
  // has to land in one useAnimatedStyle.
  const animatedStyle = useAnimatedStyle(() => {
    const isMe = isSettlingOut.value;
    const from = draggingIndex.value;
    const to = targetIndex.value;

    let shiftX = 0;
    let shiftY = 0;
    if (!isMe && from !== -1) {
      let shift = 0;
      if (to > from && index > from && index <= to) shift = -1;
      else if (to < from && index < from && index >= to) shift = 1;
      if (shift !== 0) {
        const targetSlot = index + shift;
        const myRow = Math.floor(index / columns);
        const myCol = index % columns;
        const slotRow = Math.floor(targetSlot / columns);
        const slotCol = targetSlot % columns;
        shiftX = (slotCol - myCol) * CELL;
        shiftY = (slotRow - myRow) * CELL;
      }
    }

    return {
      transform: [
        { translateX: isMe ? translateX.value : withTiming(shiftX) },
        { translateY: isMe ? translateY.value : withTiming(shiftY) },
        { rotate: `${wiggle.value}deg` },
        { scale: withTiming(dragging.value ? 1.08 : 1) },
      ],
      zIndex: dragging.value ? 100 : 0,
      shadowOpacity: withTiming(dragging.value ? 0.3 : 0),
    };
  });

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View layout={LinearTransition} style={[styles.thumbWrapper, styles.shadow, animatedStyle]}>
        <TactileButton onPress={() => onEdit(index)}>
          <Image source={{ uri }} style={styles.thumb} contentFit="cover" />
        </TactileButton>
        <View style={styles.thumbRemoveWrapper}>
          <TactileButton style={styles.thumbRemove} onPress={() => onRemove(index)}>
            <Text style={styles.thumbRemoveLabel}>✕</Text>
          </TactileButton>
        </View>
        <Text style={StyleSheet.flatten([styles.thumbLabel, { color: textColor }])}>{index + 1}</Text>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  thumbWrapper: {
    width: THUMB_SIZE,
    alignItems: 'center',
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
  },
  thumbRemoveWrapper: {
    position: 'absolute',
    top: -6,
    right: -6,
  },
  thumbRemove: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,69,58,0.15)',
    borderWidth: 1.5,
    borderColor: '#ff453a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveLabel: {
    color: '#ff453a',
    fontSize: 12,
    fontWeight: '700',
  },
  thumbLabel: {
    marginTop: 4,
    fontSize: 12,
    opacity: 0.6,
  },
});
