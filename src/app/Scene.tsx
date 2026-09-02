import { Physics } from '@react-three/rapier';
import { PHYSICS } from '../game/config';
import { ThirdPersonCamera } from '../game/camera/ThirdPersonCamera';
import { SwingDebug } from '../game/debug/SwingDebug';
import { Player } from '../game/player/Player';
import { WebRenderer } from '../game/web/WebRenderer';
import { Atmosphere } from '../game/world/Atmosphere';
import { City } from '../game/world/City';
import { Ground } from '../game/world/Ground';
import { Roads } from '../game/world/Roads';
import { Signs } from '../game/world/Signs';
import { StreetLights } from '../game/world/StreetLights';
import { SubwayEntrances } from '../game/world/SubwayEntrances';
import { SpeedStreaks } from '../game/world/SpeedStreaks';
import type { CityGeometry } from '../game/world/buildCityGeometry';
import type { CustomFace } from '../game/player/customFace';

/**
 * Assembles the world. Order matters a little: everything declared after
 * <Physics> registers its render-loop callback afterwards, so the camera reads
 * a player transform that is already up to date for this frame.
 */
interface SceneProps {
  city: CityGeometry;
  face: CustomFace | null;
  faceImage: HTMLImageElement | null;
  active: boolean;
}

export function Scene({ city, face, faceImage, active }: SceneProps) {
  return (
    <>
      <Atmosphere />

      <Physics
        gravity={[0, PHYSICS.gravity, 0]}
        timeStep={PHYSICS.timeStep}
        paused={!active}
      >
        <City geometry={city} />
        <Ground />
        <SubwayEntrances entrances={city.entrances} />
        <Player face={face} faceImage={faceImage} />
      </Physics>

      <Roads
        roads={city.roads}
        sidewalkTexture={city.sidewalkTexture}
        tactileTexture={city.tactileTexture}
      />
      <Signs signs={city.signs} />
      <StreetLights lights={city.streetLights} />

      <WebRenderer />
      <SpeedStreaks />
      <SwingDebug />
      <ThirdPersonCamera />
    </>
  );
}
