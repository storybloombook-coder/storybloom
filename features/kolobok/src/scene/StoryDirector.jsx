import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useFrame } from '@react-three/fiber/native';
import * as Haptics from 'expo-haptics';
import {
  orbit, story, storyMotion, useSceneStore,
} from '../state/sceneStore';
import { resetEncounterMotion } from './encounterBeats';
import { CHAPTERS, buildRebirthResume } from './storyChapters';

const LAUNCH_IDLE_MS = 1500;  // STORY_SPEC §1: sceneReady + 1.5s of no input
const RESUME_IDLE_MS = 8000;  // §1: 8s idle in free mode resumes the story

// Live-review feedback (2026-07-19): the spec's ~64s loop pacing read too
// fast on device -- run every chapter at half speed (~128s loop) by scaling
// the tick clock, so all timeline structures stay spec-shaped while the
// whole tale breathes slower.
const STORY_TIME_SCALE = 0.5;

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
  storyMotion.grandmaCooking = false;
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
  // True while compositeRef holds buildRebirthResume's composite rather than
  // an indexed CHAPTERS[] entry -- lets the composite-done handler route to
  // startChapter(1) instead of the generic chapter+1 advance (see below).
  const rebirthResumeActive = useRef(false);

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
    // 'stopped' (a full round just finished) is a terminal state distinct
    // from 'paused' (a user interrupt, which still auto-resumes after
    // RESUME_IDLE_MS below) -- only a manual restart tap leaves it.
    if (nextMode === 'stopped') st.setStoryCompleted(true);
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
    st.setStoryCompleted(false);

    rebirthResumeActive.current = false;
    story.chapter = index;
    const built = CHAPTERS[index](ctxRef.current);
    storyMotion.kolobokAngle = built.startAngle;
    storyMotion.framing = built.framing; // fresh object -> CameraRig glides over 900ms
    compositeRef.current = built.composite;
    orbit.mode = 'story';
    story.mode = 'playing';
    st.setStoryPlaying(true);
  };

  // Live feedback: the fox finale itself now stops the tale right at the
  // gulp/SNAP (see buildFoxFinale/foxCatchGulpSteps) -- pressing ▶ from that
  // stopped state plays THIS (the "Grandma just smiled..." rebirth pop)
  // instead of restarting chapter 0's full cooking cinematic. Deliberately
  // NOT startChapter(): that would resetStoryMotion() and pick a CHAPTERS[]
  // entry, neither of which applies to this one-off resume composite.
  const startRebirthResume = () => {
    if (compositeRef.current) compositeRef.current.cancel();
    const st = useSceneStore.getState();
    st.setStoryCompleted(false);

    const built = buildRebirthResume(ctxRef.current);
    storyMotion.kolobokAngle = built.startAngle;
    storyMotion.framing = built.framing;
    compositeRef.current = built.composite;
    rebirthResumeActive.current = true;
    orbit.mode = 'story';
    story.mode = 'playing';
    st.setStoryPlaying(true);
  };

  // BACKLOG.md #10: a tap on a character/animal/izba (a non-story encounter
  // appearing) used to pause the whole autoplaying tale here. Taps should
  // never interrupt it any more -- they just play that character's own
  // quick reaction/greeting beat (ZoneLandmarks/Kolobok already guard
  // against re-triggering one that's already mid-dialogue) while the tale
  // keeps ticking underneath; `narration` still wins the shared bubble
  // slot over `encounter.line` (Scene3D.jsx), so there's no visual clash.
  useEffect(() => {
    story.lastInputAt = Date.now();
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
      if (story.mode === 'stopped') {
        // Only ever set by the finale's own gulp/SNAP ending below --
        // resume via the rebirth pop, not a full chapter-0 replay.
        startRebirthResume();
      } else if (story.mode !== 'playing') {
        startChapter(story.mode === 'paused' ? story.chapter : 0);
      }
    }
    if (story.pauseRequest) {
      story.pauseRequest = false;
      if (story.mode === 'playing') stopStory('paused');
    }

    if (story.mode === 'playing') {
      // Dragging no longer interrupts the tale (see orbit.lookingAway,
      // handled entirely in CameraRig) -- it keeps ticking here regardless.
      const composite = compositeRef.current;
      if (composite) {
        composite.tick(dt * STORY_TIME_SCALE);
        if (composite.done) {
          compositeRef.current = null;
          if (rebirthResumeActive.current) {
            // The restart-triggered rebirth pop just finished: continue the
            // loop from chapter 1 (road), deliberately skipping chapter 0's
            // full cooking cinematic.
            rebirthResumeActive.current = false;
            startChapter(1);
            return;
          }
          if (story.chapter === CHAPTERS.length - 1) {
            // Finale's gulp/SNAP composite just ended (buildFoxFinale now
            // stops there, see foxCatchGulpSteps) -- deliberately NOT
            // stopStory('stopped') here: that calls resetStoryMotion() +
            // setFadeBlack(false), which would instantly un-fade the screen
            // and reveal Kolobok again before the user ever presses restart.
            // Leave everything exactly as the finale left it (black,
            // narration still reading "...and SNAP!...") -- the restart
            // button (Scene3D's storyCompleted) is the only way forward,
            // and pressing it plays the rebirth via startRebirthResume above.
            story.loopCount += 1;
            st.setStoryPlaying(false);
            st.setStoryCompleted(true);
            orbit.mode = 'user';
            story.mode = 'stopped';
            story.idleClock = 0;
            return;
          }
          startChapter(story.chapter + 1);
        }
      }
      return;
    }

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
