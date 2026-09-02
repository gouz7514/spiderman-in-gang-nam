import type { LoadStage } from '../game/osm/useCityData';
import { TrackerFrame } from './TrackerFrame';

const STAGE_LABEL: Record<Exclude<LoadStage, 'error'>, string> = {
  fetching: '강남 지도 데이터를 불러오는 중...',
  building: '도시를 세우는 중...',
  ready: '준비 완료',
};

/** Bars lit at each stage, out of `BAR_COUNT`. */
const STAGE_BARS: Record<Exclude<LoadStage, 'error'>, number> = {
  fetching: 4,
  building: 9,
  ready: 12,
};

const BAR_COUNT = 12;

export function LoadingScreen({ stage }: { stage: Exclude<LoadStage, 'error'> }) {
  const lit = STAGE_BARS[stage];

  return (
    <div className="overlay">
      <TrackerFrame>
        <p className="signal signal--muted">SCANNING · 서울 강남역</p>

        <p className="loading__stage">{STAGE_LABEL[stage]}</p>

        <div className="loading__bars">
          {Array.from({ length: BAR_COUNT }, (_, index) => (
            <span
              key={index}
              /* The leading bar blinks, so a slow fetch still looks alive. */
              className={`loading__bar${index < lit ? ' loading__bar--on' : ''}${
                index === lit - 1 ? ' loading__bar--head' : ''
              }`}
            />
          ))}
        </div>

        <p className="tracker__note">
          건물 데이터는 Overpass API를 통해 OpenStreetMap에서 가져옵니다.
        </p>
      </TrackerFrame>
    </div>
  );
}
