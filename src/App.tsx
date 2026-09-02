import { useCallback, useEffect, useRef, useState } from "react";
import { GameCanvas } from "./app/GameCanvas";
import { useCityData } from "./game/osm/useCityData";
import {
  loadCustomFace,
  saveCustomFace,
  useFaceImage,
} from "./game/player/customFace";
import type { CustomFace } from "./game/player/customFace";
import { gameState } from "./game/state/gameState";
import { attachInput, requestPointerLock } from "./game/state/input";
import { loadSkyMode, saveSkyMode } from "./game/world/skyState";
import type { SkyMode } from "./game/world/skyState";
import { DebugPanel } from "./ui/DebugPanel";
import { ErrorScreen } from "./ui/ErrorScreen";
import { Hud } from "./ui/Hud";
import { LoadingScreen } from "./ui/LoadingScreen";
import { TitleScreen } from "./ui/TitleScreen";
import "./ui/ui.css";

/** Debounce before a crop change is written back to localStorage. */
const SAVE_DELAY_MS = 400;

/**
 * Screen flow: load -> title -> play, with pointer lock as the single source of
 * truth for "is the player actually playing". Losing the lock (Esc, alt-tab)
 * pauses the simulation and brings the title card back as a pause menu.
 */
export default function App() {
  const { stage, city, error, retry } = useCityData();
  const [entered, setEntered] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [face, setFace] = useState<CustomFace | null>(loadCustomFace);
  const saveTimer = useRef(0);

  const faceImage = useFaceImage(face?.src ?? null);

  const [skyMode, setSkyModeState] = useState<SkyMode>(() => {
    const stored = loadSkyMode();
    gameState.sky.mode = stored;
    return stored;
  });

  useEffect(() => attachInput(setPointerLocked), []);

  // The N key writes straight to `gameState`; mirror it back so the title
  // screen still shows the right choice when the player pauses.
  useEffect(() => {
    const id = window.setInterval(() => {
      setSkyModeState((previous) =>
        gameState.sky.mode === previous ? previous : gameState.sky.mode,
      );
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const selectSkyMode = useCallback((mode: SkyMode) => {
    gameState.sky.mode = mode;
    saveSkyMode(mode);
    setSkyModeState(mode);
  }, []);

  const enterCity = useCallback(() => {
    setEntered(true);
    requestPointerLock();
  }, []);

  // Dragging the crop fires on every pointer move; re-serialising the photo's
  // data URL that often is wasteful, so the write trails the state.
  const changeFace = useCallback((next: CustomFace | null) => {
    setFace(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () => saveCustomFace(next),
      SAVE_DELAY_MS,
    );
  }, []);

  const playing = entered && pointerLocked;

  return (
    <div className="app">
      {city && (
        <GameCanvas
          city={city}
          face={face}
          faceImage={faceImage}
          active={playing}
        />
      )}

      {stage === "error" && (
        <ErrorScreen message={error ?? "알 수 없는 오류"} onRetry={retry} />
      )}

      {(stage === "fetching" || stage === "building") && (
        <LoadingScreen stage={stage} />
      )}

      {stage === "ready" && city && !playing && (
        <TitleScreen
          paused={entered}
          buildingCount={city.buildingCount}
          face={face}
          faceImage={faceImage}
          onChangeFace={changeFace}
          onEnter={enterCity}
          skyMode={skyMode}
          onSelectSkyMode={selectSkyMode}
        />
      )}

      {playing && <Hud minimap={city?.minimap ?? null} />}

      <DebugPanel />
    </div>
  );
}
