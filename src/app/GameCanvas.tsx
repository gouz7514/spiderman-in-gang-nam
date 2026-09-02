import { Canvas } from '@react-three/fiber';
import { ACESFilmicToneMapping } from 'three';
import { CAMERA } from '../game/config';
import type { CityGeometry } from '../game/world/buildCityGeometry';
import type { CustomFace } from '../game/player/customFace';
import { Scene } from './Scene';

/**
 * The WebGL surface. `dpr` is capped so a 3x retina display does not quietly
 * cost 9x the fill rate, and the canvas is fully non-interactive: every pointer
 * event is handled by the pointer-lock listeners on `window` instead.
 */
interface GameCanvasProps {
  city: CityGeometry;
  face: CustomFace | null;
  faceImage: HTMLImageElement | null;
  active: boolean;
}

export function GameCanvas({ city, face, faceImage, active }: GameCanvasProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: CAMERA.fovBase, near: 0.4, far: 6000, position: [0, 40, 40] }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Scene city={city} face={face} faceImage={faceImage} active={active} />
    </Canvas>
  );
}
