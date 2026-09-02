/** The control list, shared by the title card and the in-game reference panel. */
export const CONTROLS: readonly { key: string; label: string }[] = [
  { key: "WASD", label: "이동" },
  { key: "Shift", label: "달리기 · 강하게" },
  { key: "마우스", label: "시점" },
  { key: "휠", label: "확대 · 축소" },
  { key: "좌클릭 유지", label: "거미줄 발사" },
  { key: "좌클릭 해제", label: "거미줄 놓기" },
  { key: "Space", label: "점프 · 거미줄 감기 · 벽 차기" },
  { key: "W + 벽", label: "벽 타기 (벽으로 이동)" },
  { key: "F", label: "셀카 시점" },
  { key: "N", label: "낮 / 밤 전환" },
  { key: "P", label: "일시정지 · 시점 조정" },
  { key: "R", label: "리스폰" },
  { key: "`", label: "디버그" },
  { key: "Esc", label: "마우스 해제" },
];
