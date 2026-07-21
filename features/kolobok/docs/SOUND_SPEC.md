# SOUND_SPEC.md — procedural audio (Phase 9)

Audio with ZERO bundled files, consistent with the package philosophy: a
tiny synth renders short WAVs in code on first launch, caches them, and
plays them via expo-audio. Deleting the cache just re-renders (~200 ms).

## 1. Engine (`src/services/soundEngine.js`)

- Render mono 16-bit PCM at 22050 Hz into WAV byte arrays (RIFF header +
  samples — ~30 lines), write once to `FileSystem.cacheDirectory/sfx/` via
  expo-file-system, load with expo-audio.
- Building blocks implemented in plain JS: sine/triangle oscillators, white
  noise, one-pole low/high-pass filters, exponential decay envelopes, and
  an amplitude LFO. Seeded PRNG (reuse the texture one).
- Audio mode: `playsInSilentMode: false` (respect the hardware mute),
  no background audio, duck nothing.
- API: `sfx.play(name, {volume, rate})` (≤ 3 concurrent one-shots; extra
  requests dropped), `sfx.loop(name, volumeRef)` for ambiences (volume
  re-checked every 250 ms from a getter), all loops fade in/out over 400 ms.
- Master: default volume 0.35. Props on MainScreen:
  `soundEnabled` (default false — sound is OPT-IN via a small speaker
  toggle next to the mode toggle, host persists via `onSoundChange`).
  Strings: `ui.soundOn` / `ui.soundOff` (EN/RU) — add to STRINGS.md.
- Lifecycle: loops pause on AppState background and in flat mode; sleep
  mode halves ambience volume; story mode plays everything as normal.

## 2. Sound recipes (name → synthesis)

| name | recipe | used by |
|------|--------|---------|
| wind (loop 4 s) | white noise → lowpass 400 Hz with cutoff LFO ±150 Hz at 0.12 Hz, seamless loop crossfade 0.5 s | ambience; runtime volume = 0.15 + wind.strength × 0.35 |
| rain (loop 3 s) | dense noise bursts (600/s, 8 ms each) → highpass 1.2 kHz, soft lowpass 6 kHz | rain/storm states, volume 0.3 |
| blip | sine 520→660 Hz over 90 ms, exp decay | all taps (rate 1.0), stone plaques (rate 0.85) |
| plop | sine sweep 300→90 Hz, 140 ms, decay 0.15 | pond: float recast, fish release, splash |
| note1–5 | triangle waves at 440 / 494 / 554 / 659 / 740 Hz (A-major pentatonic), 350 ms, soft 30 ms attack | Kolobok's song: engine plays 1-2-3-5-3 sequenced at 180 ms intervals; road humming plays single random notes at volume 0.12 |
| gulp | sine sweep 200→60 Hz 200 ms + 20 ms noise tick at end | fox catch (story + easter egg) |
| sparkle | sines 1.2 k + 1.6 k + 2.4 kHz, amp LFO 8 Hz, 300 ms | golden fish, rebirth pop, egg discoveries |
| hoot | two 380 Hz sine pulses (120 ms each, 90 ms gap), lowpass 800 Hz | owl |
| rumble | noise → lowpass 120 Hz, 500 ms swell-decay | storm lightning (with the flash) |

Mapping rule: every haptic in the existing specs gets its sound sibling
here; nothing else makes noise. Total cache ≈ 400 KB.

## 3. Acceptance
- First launch renders and caches all files; second launch renders nothing.
- Hardware mute silences everything; toggle works and persists via host.
- Wind audibly swells with visible gusts (shared wind.strength source).
- The 1-2-3-5-3 song motif plays in sync with the singing animation.
- No sound in flat mode; loops stop within 500 ms of backgrounding.
