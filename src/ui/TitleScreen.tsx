import type { CustomFace } from "../game/player/customFace";
import type { SkyMode } from "../game/world/skyState";
import { CONTROLS } from "./controls";
import { FaceUpload } from "./FaceUpload";
import { TrackerFrame } from "./TrackerFrame";

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
  const deck = (
    <>
      <div className="deck__group" role="radiogroup" aria-label="시간대">
        <span className="deck__label">TIME</span>
        {SKY_MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === skyMode}
            className={`pixel-btn pixel-btn--mint${
              option.value === skyMode ? " pixel-btn--on" : ""
            }`}
            onClick={() => onSelectSkyMode(option.value)}
          >
            {option.label}
          </button>
        ))}
        <span className="deck__note">자동은 현재 한국 시각 기준</span>
      </div>

      <button
        type="button"
        className="pixel-btn pixel-btn--coral pixel-btn--wide"
        onClick={onEnter}
      >
        {paused ? "계속하기" : "시작하기"}
      </button>
    </>
  );

  return (
    <div className="overlay">
      <TrackerFrame deck={deck}>
        <h1 className="tracker__title">
          SPIDERMAN
          <span className="tracker__title-line">in GANG-NAM</span>
        </h1>

        <FaceUpload face={face} faceImage={faceImage} onChange={onChangeFace} />

        <div className="keys">
          {CONTROLS.map(({ key, label }) => (
            <div className="keys__row" key={key}>
              <span className="keys__cap">{key}</span>
              <span className="keys__label">{label}</span>
            </div>
          ))}
        </div>

        <p className="tracker__note">
          OpenStreetMap {buildingCount.toLocaleString()}개 건물 불러오기 완료 ·
          24시간마다 갱신
        </p>
      </TrackerFrame>

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
