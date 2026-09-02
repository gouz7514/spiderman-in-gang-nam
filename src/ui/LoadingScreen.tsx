import type { LoadStage } from '../game/osm/useCityData';

const STAGE_LABEL: Record<Exclude<LoadStage, 'error'>, string> = {
  fetching: '강남 지도 데이터를 불러오는 중...',
  building: '도시를 세우는 중...',
  ready: '준비 완료',
};

export function LoadingScreen({ stage }: { stage: Exclude<LoadStage, 'error'> }) {
  return (
    <div className="overlay">
      <div className="overlay__panel">
        <div className="spinner" />
        <p className="overlay__eyebrow">서울 · 강남역</p>
        <p className="loading__stage">{STAGE_LABEL[stage]}</p>
        <div className="loading__steps">
          <span className="loading__step loading__step--active" />
          <span
            className={`loading__step${stage !== 'fetching' ? ' loading__step--active' : ''}`}
          />
        </div>
        <p className="overlay__note">
          건물 데이터는 Overpass API를 통해 OpenStreetMap에서 가져옵니다.
        </p>
      </div>
    </div>
  );
}
