import { Island } from './Island';
import { ZoneLandmarks } from './ZoneLandmarks';
import { Kolobok } from './Kolobok';
import { CameraRig } from './CameraRig';
import { Vegetation } from './Vegetation';
import { Sky } from './Sky';
import { BackgroundForest } from './BackgroundForest';
import { CrossroadsStone } from './CrossroadsStone';
import { currentPhase, PALETTES } from '../config/atmosphere';

// Fog/lighting now come from the time-of-day palette (ART_SPEC §8) instead
// of a fixed color, so the whole scene (not just the sky dome) reads as the
// same time of day. The flat <color attach="background"> is gone -- the sky
// dome (ART_SPEC §7) is the background now.
export function KolobokScene() {
  const palette = PALETTES[currentPhase()];

  return (
    <>
      <fog attach="fog" args={[palette.fog, 16, 30]} />

      <ambientLight intensity={palette.ambient} />
      <directionalLight position={[6, 10, 4]} color={palette.dirLight} intensity={palette.dirInt} />

      <Sky />
      <BackgroundForest />
      <Island />
      <Vegetation />
      <CrossroadsStone />
      <ZoneLandmarks />
      <Kolobok />
      <CameraRig />
    </>
  );
}
