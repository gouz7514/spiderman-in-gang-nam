/**
 * Sprites for the tracker chrome, drawn as one `<rect>` per lit pixel so they
 * stay square at any size. `crispEdges` is what stops the browser smoothing the
 * cell boundaries back into a blur when the SVG is scaled up.
 */

function Sprite({ rows, className }: { rows: string[]; className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${rows[0].length} ${rows.length}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "#" ? (
            <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" />
          ) : null,
        ),
      )}
    </svg>
  );
}

const ALERT = [
  "....#....",
  "...###...",
  "...###...",
  "..##.##..",
  "..##.##..",
  ".##...##.",
  ".##.#.##.",
  "##..#..##",
  "#########",
];

export function AlertGlyph({ className }: { className?: string }) {
  return <Sprite rows={ALERT} className={className} />;
}
