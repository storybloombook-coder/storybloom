import { Island } from './Island';
import { ZoneLandmarks } from './ZoneLandmarks';
import { Kolobok } from './Kolobok';
import { CameraRig } from './CameraRig';

export function KolobokScene() {
  return (
    <>
      <color attach="background" args={['#bfe3f2']} />
      <fog attach="fog" args={['#bfe3f2', 16, 30]} />

      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 10, 4]} intensity={1.1} />

      <Island />
      <ZoneLandmarks />
      <Kolobok />
      <CameraRig />
    </>
  );
}
