/**
 * The only thing drawn over the city during a photo pause.
 *
 * Deliberately tiny and in one corner: the pause exists so the player can take
 * a screenshot, so anything that covers the view defeats it. The badge is the
 * one clickable thing on screen — clicking the city itself is not offered,
 * because a screenshot tool's drag lands as a click and would resume the game
 * mid-capture, and because a drag on the city orbits the view instead.
 */
interface PauseNoticeProps {
  onResume: () => void;
}

export function PauseNotice({ onResume }: PauseNoticeProps) {
  return (
    <button type="button" className="pause-notice" onClick={onResume}>
      <span className="pause-notice__mark">❚❚</span>
      <span className="pause-notice__label">일시정지</span>
      <span className="pause-notice__hint">드래그 시점 · 휠 확대 · P 계속 · Esc 메뉴</span>
    </button>
  );
}
