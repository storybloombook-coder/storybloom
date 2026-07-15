// audio/playRange.ts — the ONE playback path shared by the page editor and the
// reader, so what you hear while assigning a sound is exactly what plays during
// a read. expo-audio has no built-in "stop at time" / fade API, so these poll
// currentTime on an interval — fine for the short clips Storybloom plays.

import type { createAudioPlayer } from 'expo-audio';

type Player = ReturnType<typeof createAudioPlayer>;

/** Plays [startSec, endSec) of `player`, ramping volume in/out over the given
 *  fade durations. Returns a `stop()` handle so a caller can cancel playback
 *  early (a real stop, not a pause — the interval is torn down, so a later
 *  replay always restarts fresh from startSec rather than resuming mid-clip). */
export function playRange(
  player: Player,
  opts: {
    startSec: number;
    endSec: number;
    fadeInSec: number;
    fadeOutSec: number;
    onTick?: (currentTime: number) => void;
    onEnd?: () => void;
  }
): () => void {
  const { startSec, endSec, fadeInSec, fadeOutSec, onTick, onEnd } = opts;
  let timer: ReturnType<typeof setInterval> | null = null;
  player.volume = fadeInSec > 0 ? 0 : 1;
  // The interval used to bail out early whenever `player.playing` read false,
  // including checking it before play() had actually taken effect. That's a
  // race, not a reliable signal — a player loading a file fresh from disk
  // (as opposed to one just recorded, still warm) can take longer than one
  // 50ms tick to flip `playing` true, and bailing out early left the fade-in
  // ramp never applied — since fade-in defaults on, that meant total silence.
  // `currentTime` reaching endSec is the only stop condition we actually
  // need; a tick cap just guards against a genuinely stuck/failed player.
  player.seekTo(startSec).then(() => {
    player.play();
    let ticks = 0;
    timer = setInterval(() => {
      ticks += 1;
      const t = player.currentTime;
      if (t >= endSec || ticks > 400) {
        if (timer) clearInterval(timer);
        player.pause();
        onEnd?.();
        return;
      }
      onTick?.(t);
      const elapsed = t - startSec;
      const remaining = endSec - t;
      let vol = 1;
      if (fadeInSec > 0 && elapsed < fadeInSec) vol = Math.max(0, elapsed / fadeInSec);
      if (fadeOutSec > 0 && remaining < fadeOutSec) vol = Math.min(vol, Math.max(0, remaining / fadeOutSec));
      player.volume = vol;
    }, 50);
  });

  return () => {
    if (timer) clearInterval(timer);
    try {
      player.pause();
    } catch {}
  };
}

/** Loops [startSec, endSec) until stopped — for a trimmed custom AMBIENT
 *  recording that must run continuously until the page changes (the sibling of
 *  playLooping, which loops a whole clip). Fades in once at the start; the
 *  returned stop() fades out then pauses so a page turn doesn't cut it off with
 *  a click. The loop seam is a seekTo back to startSec when currentTime passes
 *  endSec — fine for an ambient bed. */
export function playRangeLooping(
  player: Player,
  opts: { startSec: number; endSec: number; fadeInSec: number; fadeOutSec: number; onTick?: (t: number) => void }
): () => void {
  const { startSec, endSec, fadeInSec, fadeOutSec, onTick } = opts;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const t0 = Date.now();
  player.volume = fadeInSec > 0 ? 0 : 1;
  player.seekTo(startSec).then(() => {
    if (stopped) return;
    player.play();
    timer = setInterval(() => {
      const t = player.currentTime;
      if (t >= endSec) player.seekTo(startSec).catch(() => {});
      onTick?.(t);
      // Fade in once over the first fadeInSec, then hold at full.
      player.volume = fadeInSec > 0 ? Math.min(1, (Date.now() - t0) / 1000 / fadeInSec) : 1;
    }, 50);
  });

  return () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    if (fadeOutSec <= 0) {
      try { player.pause(); } catch {}
      return;
    }
    const from = player.volume;
    const s = Date.now();
    const out = setInterval(() => {
      const el = (Date.now() - s) / 1000;
      try { player.volume = Math.max(0, from * (1 - el / fadeOutSec)); } catch {}
      if (el >= fadeOutSec) {
        clearInterval(out);
        try { player.pause(); } catch {}
      }
    }, 40);
  };
}

/** Default fades applied to a one-shot LIBRARY sound so it never starts or ends
 *  on an abrupt click. Short, and clamped to the clip length in playFull so a
 *  tiny effect isn't swallowed by its own fade. */
export const LIBRARY_FADE_IN_SEC = 0.03;
export const LIBRARY_FADE_OUT_SEC = 0.12;

/** Plays a whole clip (a bundled library sound) with a short fade in/out. Probes
 *  the player's duration first — a player loading fresh from disk reports 0
 *  until ready — then routes through playRange so Stop/fade behave identically
 *  to trimmed custom sounds. Returns a `stop()` that cancels even if called
 *  before the duration is known. */
export function playFull(
  player: Player,
  opts: { fadeInSec?: number; fadeOutSec?: number; onEnd?: () => void } = {}
): () => void {
  let stopped = false;
  let innerStop: (() => void) | null = null;
  let tries = 0;
  const wantIn = opts.fadeInSec ?? LIBRARY_FADE_IN_SEC;
  const wantOut = opts.fadeOutSec ?? LIBRARY_FADE_OUT_SEC;

  const wait = () => {
    if (stopped) return;
    tries += 1;
    if (player.duration > 0 || tries > 40) {
      const dur = player.duration > 0 ? player.duration : 20;
      // Clamp fades so a short effect isn't eaten by them.
      const fadeInSec = Math.min(wantIn, dur * 0.2);
      const fadeOutSec = Math.min(wantOut, dur * 0.4);
      innerStop = playRange(player, { startSec: 0, endSec: dur, fadeInSec, fadeOutSec, onEnd: opts.onEnd });
    } else {
      setTimeout(wait, 50);
    }
  };
  wait();

  return () => {
    stopped = true;
    innerStop?.();
  };
}

/** Starts `player` looping forever with a short volume fade-in, for ambient
 *  beds that should run until the page changes. Returns a `stop()` that fades
 *  the volume back down over `fadeOutSec` and then pauses, so page turns don't
 *  cut the bed off with an abrupt click. */
export function playLooping(
  player: Player,
  opts: { fadeInSec?: number; fadeOutSec?: number } = {}
): () => void {
  const fadeInSec = opts.fadeInSec ?? 0.6;
  const fadeOutSec = opts.fadeOutSec ?? 0.5;
  let fadeTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  player.loop = true;
  player.volume = fadeInSec > 0 ? 0 : 1;
  player.play();

  if (fadeInSec > 0) {
    const start = Date.now();
    fadeTimer = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const v = Math.min(1, elapsed / fadeInSec);
      player.volume = v;
      if (v >= 1 && fadeTimer) {
        clearInterval(fadeTimer);
        fadeTimer = null;
      }
    }, 40);
  }

  return () => {
    if (stopped) return;
    stopped = true;
    if (fadeTimer) clearInterval(fadeTimer);
    if (fadeOutSec <= 0) {
      try {
        player.pause();
      } catch {}
      return;
    }
    const from = player.volume;
    const start = Date.now();
    const out = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const v = Math.max(0, from * (1 - elapsed / fadeOutSec));
      try {
        player.volume = v;
      } catch {}
      if (elapsed >= fadeOutSec) {
        clearInterval(out);
        try {
          player.pause();
        } catch {}
      }
    }, 40);
  };
}
