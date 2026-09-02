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
import {
  attachInput,
  requestPointerLock,
  setPhotoPaused,
} from "./game/state/input";
import { loadSkyMode, saveSkyMode } from "./game/world/skyState";
import type { SkyMode } from "./game/world/skyState";
import { DebugPanel } from "./ui/DebugPanel";
import { ErrorScreen } from "./ui/ErrorScreen";
import { Hud } from "./ui/Hud";
import { LoadingScreen } from "./ui/LoadingScreen";
import { PauseNotice } from "./ui/PauseNotice";
import { TitleScreen } from "./ui/TitleScreen";
import "./ui/ui.css";

/** Debounce before a crop change is written back to localStorage. */
const SAVE_DELAY_MS = 400;

/**
 * Screen flow: load -> title -> play, with pointer lock as the single source of
 * truth for "is the player actually playing". Losing the lock (Esc, alt-tab)
 * pauses the simulation and brings the title card back as a pause menu.
 *
 * The photo pause (P) is the one exception: the lock is given up the same way,
 * so the simulation and the HUD stop with it, but the title card is suppressed
 * and the city is left on screen to be captured.
 */
export default function App() {
  const { stage, city, error, retry } = useCityData();
  const [entered, setEntered] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  /** P: the simulation is stopped but no menu is drawn, so the view is clean. */
  const [photoPaused, setPhotoPausedState] = useState(false);
  const [face, setFace] = useState<CustomFace | null>(loadCustomFace);
  const saveTimer = useRef(0);

  const faceImage = useFaceImage(face?.src ?? null);

  const [skyMode, setSkyModeState] = useState<SkyMode>(() => {
    const stored = loadSkyMode();
    gameState.sky.mode = stored;
    return stored;
  });

  useEffect(() => attachInput(setPointerLocked, setPhotoPausedState), []);

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
    <div className={photoPaused ? "app app--paused" : "app"}>
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

      {stage === "ready" && city && !playing && !photoPaused && (
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

      {photoPaused && <PauseNotice onResume={() => setPhotoPaused(false)} />}

      <DebugPanel />
    </div>
  );
}
