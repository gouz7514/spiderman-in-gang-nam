export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="overlay">
      <div className="overlay__panel">
        <p className="overlay__eyebrow">도시를 만들 수 없습니다</p>
        <h1 className="overlay__title">연결 실패</h1>
        <p className="overlay__subtitle">
          모든 OpenStreetMap 소스에 접근하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.
        </p>
        <pre className="error__message">{message}</pre>
        <button type="button" className="button" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    </div>
  );
}
