import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import {
  orbit, story, storyMotion, useSceneStore,
} from '../state/sceneStore';
import { resetEncounterMotion } from './encounterBeats';
import { CHAPTERS } from './storyChapters';

const LAUNCH_IDLE_MS = 1500;  // STORY_SPEC §1: sceneReady + 1.5s of no input
const RESUME_IDLE_MS = 8000;  // §1: 8s idle in free mode resumes the story

/** Returns every storyMotion field to "no override" -- the free-mode
 *  identity values. kolobokAngle is deliberately left alone (whatever angle
 *  he's at is where free mode picks him up). */
function resetStoryMotion() {
  storyMotion.posOverride = null;
  storyMotion.scale = 1;
  storyMotion.faceYaw = 0;
  storyMotion.bodyTilt = 0;
  storyMotion.spinT = 0;
  storyMotion.squash = 0;
  storyMotion.expression = null;
  storyMotion.windowGlow = 0;
  storyMotion.smokeBoost = 1;
  storyMotion.foxHeadPitch = 0;
  storyMotion.framing = null;
  storyMotion.teleportAngle = null;
}

/** STORY_SPEC's story-mode state machine: launches the tale after 1.5s of
 *  launch idleness, ticks the active chapter composite, advances/loops
 *  chapters, interrupts on user input (handing control back with zero
 *  camera jump -- see CameraRig's orbit.angle write-back), resumes from the
 *  interrupted chapter's start after 8s of idleness, and turns off on
 *  navigation. Mounts inside the Canvas; all per-frame state lives on the
 *  transient `story`/`storyMotion` objects. */
export function StoryDirector() {
  const encounter = useSceneStore((s) => s.encounter);
  const pendingNavigation = useSceneStore((s) => s.pendingNavigation);

  const compositeRef = useRef(null);
  const reducedMotionRef = useRef(false);
  const mountedAtRef = useRef(Date.now());

  // ctx handed to every chapter builder: the discrete store actions plus
  // the finale's haptic hooks (STORY_SPEC §4: gulp + rebirth only).
  const ctxRef = useRef(null);
  if (!ctxRef.current) {
    const s = useSceneStore.getState();
    ctxRef.current = {
      setNarration: s.setNarration,
      setStoryEncounter: s.setStoryEncounter,
      setStoryEncounterPhase: s.setStoryEncounterPhase,
      setFadeBlack: s.setFadeBlack,
      onGulp: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
      onRebirth: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    };
  }

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) reducedMotionRef.current = enabled;
    });
    return () => { cancelled = true; };
  }, []);

  const stopStory = (nextMode) => {
    if (compositeRef.current) {
      compositeRef.current.cancel();
      compositeRef.current = null;
    }
    const st = useSceneStore.getState();
    // Only clear encounters the STORY created -- an interrupt caused by the
    // user tapping an animal must leave that new interactive beat running.
    // Same for encounterMotion: if a user-owned beat exists, EncounterDirector
    // (whose effect ran before this one, mount order) already populated it
    // for the NEW beat -- wiping it here would kill that beat's motion.
    if (!st.encounter || st.encounter.story) {
      if (st.encounter?.story) st.clearEncounter();
      resetEncounterMotion();
    }
    st.setNarration(null);
    st.setFadeBlack(false);
    st.setStoryPlaying(false);
    resetStoryMotion();
    orbit.mode = 'user';
    story.mode = nextMode;
    story.idleClock = 0;
  };

  const startChapter = (index) => {
    if (compositeRef.current) compositeRef.current.cancel();
    resetStoryMotion();
    resetEncounterMotion();
    const st = useSceneStore.getState();
    if (st.encounter?.story) st.clearEncounter();
    st.setNarration(null);

    story.chapter = index;
    const built = CHAPTERS[index](ctxRef.current);
    storyMotion.kolobokAngle = built.startAngle;
    storyMotion.framing = built.framing; // fresh object -> CameraRig glides over 900ms
    compositeRef.current = built.composite;
    orbit.mode = 'story';
    story.mode = 'playing';
    st.setStoryPlaying(true);
  };

  // Interrupt-on-user-encounter: a NON-story encounter appearing while the
  // story plays is a scene tap (animal, Kolobok, izba) -- hand control back
  // and let that interactive beat run (STORY_SPEC §1 "the tap starts its
  // normal interactive encounter").
  useEffect(() => {
    story.lastInputAt = Date.now();
    if (encounter && !encounter.story && story.mode === 'playing') {
      stopStory('paused');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter]);

  // Navigation (stone plaque / overlay pill) -> story off (STORY_SPEC §1).
  useEffect(() => {
    if (pendingNavigation) stopStory('off');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNavigation]);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const now = Date.now();
    const st = useSceneStore.getState();

    // ---- Manual controls (▶ / ❚❚), consumed transiently ----
    if (story.playRequest) {
      story.playRequest = false;
      if (story.mode !== 'playing') startChapter(story.mode === 'paused' ? story.chapter : 0);
    }
    if (story.pauseRequest) {
      story.pauseRequest = false;
      if (story.mode === 'playing') stopStory('paused');
    }

    if (story.mode === 'playing') {
      // Pan-past-12px interrupt (set by Scene3D's gesture handler).
      if (story.interruptRequest) {
        story.interruptRequest = false;
        stopStory('paused');
        return;
      }
      const composite = compositeRef.current;
      if (composite) {
        composite.tick(dt);
        if (composite.done) {
          compositeRef.current = null;
          if (story.chapter === CHAPTERS.length - 1) {
            // Finale done: loop. Every 4th loop replays the full birth.
            story.loopCount += 1;
            startChapter(story.loopCount % 4 === 0 ? 0 : 1);
          } else {
            startChapter(story.chapter + 1);
          }
        }
      }
      return;
    }

    // Clear any stale interrupt flag raised outside playback.
    story.interruptRequest = false;

    // ---- Autoplay / auto-resume timers ----
    if (reducedMotionRef.current) return; // §4: no autoplay under reduced motion
    if (story.mode === 'off') return;     // only ▶ or a remount revives

    const idleSince = Math.max(story.lastInputAt, mountedAtRef.current);
    const idleFor = now - idleSince;
    const blocked = st.encounter || st.pendingNavigation;

    if (story.mode === 'idle' && !blocked && idleFor > LAUNCH_IDLE_MS) {
      startChapter(0);
    } else if (story.mode === 'paused' && !blocked && idleFor > RESUME_IDLE_MS) {
      startChapter(story.chapter);
    }
  });

  return null;
}
