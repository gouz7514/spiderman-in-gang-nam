import { useEffect, useState } from 'react';
import { localToLatLon } from '../game/osm/coordinates';
import { gameState } from '../game/state/gameState';

interface DebugSnapshot {
  fps: number;
  position: string;
  latLon: string;
  velocity: string;
  speed: string;
  grounded: boolean;
  attached: boolean;
  ropeLength: string;
  anchorDistance: string;
  anchor: string;
}

function readSnapshot(): DebugSnapshot {
  const { player, web, debug } = gameState;
  const { position, velocity } = player;
  const coordinate = localToLatLon(position.x, position.z);

  return {
    fps: debug.fps,
    position: `${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`,
    latLon: `${coordinate.lat.toFixed(5)}, ${coordinate.lon.toFixed(5)}`,
    velocity: `${velocity.x.toFixed(1)}, ${velocity.y.toFixed(1)}, ${velocity.z.toFixed(1)}`,
    speed: `${player.speed.toFixed(1)} m/s · ${(player.speed * 3.6).toFixed(0)} km/h`,
    grounded: player.grounded,
    attached: web.attached,
    ropeLength: web.attached ? `${web.ropeLength.toFixed(2)} m` : '—',
    anchorDistance: web.attached ? `${web.anchorDistance.toFixed(2)} m` : '—',
    anchor: web.attached
      ? `${web.anchor.x.toFixed(1)}, ${web.anchor.y.toFixed(1)}, ${web.anchor.z.toFixed(1)}`
      : '—',
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="debug__row">
      <span className="debug__key">{label}</span>
      <span className="debug__value">{value}</span>
    </div>
  );
}

/** Toggled with the backtick key. Polls at 10 Hz; renders nothing when off. */
export function DebugPanel() {
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSnapshot((previous) => {
        if (!gameState.debug.enabled) return previous === null ? previous : null;
        return readSnapshot();
      });
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  if (!snapshot) return null;

  return (
    <div className="debug">
      <div className="debug__title">디버그</div>
      <Row label="fps" value={String(snapshot.fps)} />
      <Row label="속도" value={snapshot.speed} />
      <Row label="속도 벡터" value={snapshot.velocity} />
      <Row label="위치" value={snapshot.position} />
      <Row label="위도, 경도" value={snapshot.latLon} />
      <Row label="접지" value={snapshot.grounded ? '예' : '아니오'} />
      <Row label="웹 연결" value={snapshot.attached ? '예' : '아니오'} />
      <Row label="로프 길이" value={snapshot.ropeLength} />
      <Row label="앵커 거리" value={snapshot.anchorDistance} />
      <Row label="앵커 좌표" value={snapshot.anchor} />
    </div>
  );
}
