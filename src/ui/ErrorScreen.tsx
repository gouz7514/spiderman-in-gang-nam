import { AlertGlyph } from './PixelGlyphs';
import { TrackerFrame } from './TrackerFrame';

export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="overlay">
      <TrackerFrame
        alarm
        deck={
          <button type="button" className="pixel-btn pixel-btn--amber pixel-btn--wide" onClick={onRetry}>
            다시 시도
          </button>
        }
      >
        <AlertGlyph className="tracker__alert" />
        <p className="signal signal--alarm">SIGNAL LOST</p>

        <h1 className="tracker__title tracker__title--small">연결 실패</h1>
        <p className="tracker__subtitle">
          모든 OpenStreetMap 소스에 접근하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.
        </p>

        <pre className="error__message">{message}</pre>
      </TrackerFrame>
    </div>
  );
}
