# SPIDERMAN in GANG-NAM

A third-person web-swinging game played across the real streets around Gangnam
Station, Seoul. Building footprints are pulled live from OpenStreetMap, extruded
into a 3D city, and given physics colliders, so every wall you web onto is a
real building.

```bash
pnpm install
pnpm dev
```

Then open the printed URL, pick a hero, click **도시로 진입**, and hold the left
mouse button to fire a web.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | 이동 / 스윙 방향 조절 |
| 마우스 | 시점 |
| 좌클릭 유지 | 웹 발사 |
| 좌클릭 해제 | 웹 놓기 (관성 유지) |
| `Shift` | 달리기 · 스윙 입력 강화 |
| `Space` | 지상 점프 · 공중 대시 · 스윙 중 로프 감기 · 벽 차기 |
| `W` + 벽 | 벽 타기 (공중에서는 닿기만 해도 붙음) |
| `F` | 셀카 시점 |
| `N` | 낮/밤 전환 |
| `R` | 리스폰 |
| `` ` `` | 디버그 오버레이 |
| `Esc` | 마우스 해제 |

The control list is pinned to the top-right during play, with a heading-up
minimap in the bottom-right.

## How it works

`OpenStreetMap (Overpass API) -> building polygons -> merged Three.js geometry
-> one Rapier trimesh collider -> player physics -> web swing solver -> camera`

- **Data** — a single bounded Overpass query for a 550 m radius around
  37.4979, 127.0276, cached in `localStorage` for 24 hours: building outlines,
  every highway, and named shopfronts. If both Overpass endpoints fail, a
  bundled snapshot in `public/` is used instead.
- **Streets** — carriageway widths come from the OSM `lanes` tag, with paved
  pavements (보도블록 + 점자블록), Korean lane markings (solid white edge lines,
  broken white lane dividers, solid yellow centre lines) and real
  `footway=crossing` zebra crossings. Markings stop at junction boxes, so
  intersections are bare tarmac rather than a lattice of crossing lines.
- **Signs** — every named OSM POI becomes a signboard on the wall of its
  building, stacked up the facade. Real chains (올리브영, GS25, CU, 세븐일레븐,
  스타벅스, 다이소, 유니클로, banks...) are prioritised and wear their own
  livery, and tall buildings carry their own name in large type just under the
  parapet so the signage still reads from the air. Everything is rendered into
  one canvas atlas, so the whole sign layer is a single draw call.
- **Buildings** — every face is emitted by hand rather than extruded, so the
  walls carry a tiling window texture at a true bay width, the bottom few metres
  are a separate shopfront band, and roofs are decks recessed behind parapets
  with water tanks and plant on them. Low-rise roofs get Korean green
  waterproofing; towers keep a grey deck.
- **Sky** — the sun's real position over Gangnam is computed from the clock
  (Korea is a fixed UTC+9), which drives the palette, the key light, the fog and
  whether stars are drawn. 자동 follows the current Korean time; 낮 and 밤 force
  the clock to 14:00 or 23:00 — still today's real sun, so a forced winter day
  is a low winter sun. Pick it on the title card or press `N` in play.
- **Night** — lit windows are an emissive facade map, sparse and warm, phased
  per building so neighbouring towers light different windows. Around 1,600 lamp
  posts line the kerbs, both sides of the wide avenues and down the back alleys
  too, their heads glowing after dusk. The street itself is lit by the sky's
  ambient floor rather than by per-lamp light sprites, which keeps the tone even
  across the whole city.
- **Projection** — `src/game/osm/coordinates.ts` maps lat/lon onto a local
  metres grid centred on Gangnam Station: `+X` east, `-Z` north, `+Y` up.
- **Wall crawling** — walk into a facade, or brush one in mid-air, and the hero
  sticks to it. WASD moves along the wall relative to where the camera is
  looking, so looking up the building climbs it and looking sideways traverses;
  Space kicks off it. Only near-vertical surfaces count, which is what keeps the
  pavement from being climbable.
- **Swing** — `src/game/physics/swingPhysics.ts` implements the rope as a
  maximum-distance constraint with reeling, tangential input forces, and a
  radial-to-tangential transfer on the catch.
- **Tuning** — every gameplay number lives in `src/game/config.ts`.

## Data currency

Overpass always returns the live OpenStreetMap database (minutes behind the
latest edit); the copy is then cached locally for 24 hours. In this area 82% of
the elements have been edited since 2024 — building outlines have a median last
edit around early 2025, and shopfronts around mid 2026. The bundled offline
snapshot in `public/` is a point-in-time copy and only used when Overpass is
unreachable; regenerate it if it drifts.

City data © OpenStreetMap contributors, available under the ODbL.
