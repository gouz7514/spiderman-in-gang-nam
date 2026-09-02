import type { CustomFace } from "../game/player/customFace";
import type { SkyMode } from "../game/world/skyState";
import { CONTROLS } from "./controls";
import { FaceUpload } from "./FaceUpload";

interface TitleScreenProps {
  /** True when the player has already been in the city and lost pointer lock. */
  paused: boolean;
  buildingCount: number;
  face: CustomFace | null;
  faceImage: HTMLImageElement | null;
  onChangeFace: (face: CustomFace | null) => void;
  onEnter: () => void;
  skyMode: SkyMode;
  onSelectSkyMode: (mode: SkyMode) => void;
}

const SKY_MODES: { value: SkyMode; label: string }[] = [
  { value: "auto", label: "자동" },
  { value: "day", label: "낮" },
  { value: "night", label: "밤" },
];

export function TitleScreen({
  paused,
  buildingCount,
  face,
  faceImage,
  onChangeFace,
  onEnter,
  skyMode,
  onSelectSkyMode,
}: TitleScreenProps) {
  return (
    <div className="overlay">
      <div className="overlay__panel">
        <p className="overlay__eyebrow">
          {paused ? "일시정지" : "서울 · 강남역"}
        </p>
        <h1 className="overlay__title">SPIDERMAN in GANG-NAM</h1>
        <p className="overlay__subtitle">강남의 스파이더맨이 되어보자</p>

        <FaceUpload face={face} faceImage={faceImage} onChange={onChangeFace} />

        <div className="sky-modes" role="radiogroup" aria-label="시간대">
          {SKY_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === skyMode}
              className={`sky-mode${option.value === skyMode ? " sky-mode--active" : ""}`}
              onClick={() => onSelectSkyMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="sky-modes__note">자동 선택 시 현재 한국 시각 기준</p>

        <div className="controls">
          {CONTROLS.map(({ key, label }) => (
            <div className="controls__row" key={key}>
              <span className="controls__key">{key}</span>
              <span className="controls__label">{label}</span>
            </div>
          ))}
        </div>

        <button type="button" className="button" onClick={onEnter}>
          {paused ? "계속하기" : "시작하기"}
        </button>

        <p className="overlay__note">
          OpenStreetMap 데이터에서 실제 건물 {buildingCount.toLocaleString()}
          개를 불러왔어요.
          <br />
          데이터는 24시간마다 갱신돼요.
        </p>
      </div>

      <div className="credit">
        <a
          className="credit__label"
          href="https://www.instagram.com/coffeerro/"
          target="_blank"
          rel="noreferrer"
        >
          made by COFFEERRO
        </a>
        <img
          className="credit__qr"
          src={`${import.meta.env.BASE_URL}coffeerro-qr.png`}
          alt="COFFEERRO 인스타그램 QR 코드"
        />
      </div>
    </div>
  );
}
