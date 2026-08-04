import { Island } from './Island';
import { ZoneLandmarks } from './ZoneLandmarks';
import { Kolobok } from './Kolobok';
import { CameraRig } from './CameraRig';
import { Vegetation } from './Vegetation';
import { Owl } from './Owl';
import { Hedgehog } from './Hedgehog';
import { Sky } from './Sky';
import { BackgroundForest } from './BackgroundForest';
import { CrossroadsStone } from './CrossroadsStone';
import { Birds } from './Birds';
import { Magpies } from './Magpies';
import { EncounterDirector } from './EncounterDirector';
import { StoryDirector } from './StoryDirector';
import { KolobokParticles } from './KolobokParticles';
import { AtmosphereDirector } from './AtmosphereDirector';
import { WeatherSystems } from './WeatherSystems';
import { PondAndGrandpa } from './PondAndGrandpa';
import { RimLightSync } from './materials/rimLight';
import { FrameTimeProbe } from './FrameTimeProbe';
import { DustTrail } from './DustTrail';
import { GoldenHourExtras } from './GoldenHourExtras';
import { BubbleAnchor } from './BubbleAnchor';
import { CameraDragShield } from './CameraDragShield';

// Fog + lights + all sky/weather blending live in AtmosphereDirector
// (WEATHER_SPEC): real solar daylight when location is available, the
// ART_SPEC §8 clock table otherwise, weather states ramping on top.
export function KolobokScene({ dragController }) {
  return (
    <>
      <FrameTimeProbe />
      <RimLightSync />
      <AtmosphereDirector />
      <Sky />
      <BackgroundForest />
      <Island />
      <Vegetation />
      <Owl />
      <Hedgehog />
      <WeatherSystems />
      <PondAndGrandpa />
      <Magpies />
      <GoldenHourExtras />
      <CrossroadsStone />
      <Birds />
      <ZoneLandmarks />
      <Kolobok />
      <DustTrail />
      <KolobokParticles />
      <CameraRig />
      <CameraDragShield dragController={dragController} />
      <EncounterDirector />
      <StoryDirector />
      <BubbleAnchor />
    </>
  );
}
