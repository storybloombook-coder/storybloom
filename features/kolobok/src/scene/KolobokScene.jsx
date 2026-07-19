import { Island } from './Island';
import { ZoneLandmarks } from './ZoneLandmarks';
import { Kolobok } from './Kolobok';
import { CameraRig } from './CameraRig';
import { Vegetation } from './Vegetation';
import { Sky } from './Sky';
import { BackgroundForest } from './BackgroundForest';
import { CrossroadsStone } from './CrossroadsStone';
import { EncounterDirector } from './EncounterDirector';
import { StoryDirector } from './StoryDirector';
import { KolobokParticles } from './KolobokParticles';
import { AtmosphereDirector } from './AtmosphereDirector';
import { WeatherSystems } from './WeatherSystems';
import { PondAndGrandpa } from './PondAndGrandpa';

// Fog + lights + all sky/weather blending live in AtmosphereDirector
// (WEATHER_SPEC): real solar daylight when location is available, the
// ART_SPEC §8 clock table otherwise, weather states ramping on top.
export function KolobokScene() {
  return (
    <>
      <AtmosphereDirector />
      <Sky />
      <BackgroundForest />
      <Island />
      <Vegetation />
      <WeatherSystems />
      <PondAndGrandpa />
      <CrossroadsStone />
      <ZoneLandmarks />
      <Kolobok />
      <KolobokParticles />
      <CameraRig />
      <EncounterDirector />
      <StoryDirector />
    </>
  );
}
