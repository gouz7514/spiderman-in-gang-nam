# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev       # vite dev server
pnpm build     # tsc -b && vite build
pnpm lint      # oxlint
pnpm preview   # serve the production build
pnpm exec tsc -b --force   # full typecheck without the incremental cache
```

There is no test runner. The pure modules (`game/osm/*`, `game/world/buildCityGeometry`,
`game/physics/*`) have no DOM or WebGL dependency, so they can be exercised directly in
node — bundle a throwaway entry with esbuild (`--platform=node --format=esm`) and run it.
That is how the swing solver was validated; a straight `node --experimental-strip-types`
will not work because the imports are extensionless.

`oxlint` reports warnings (not errors) for `react(purity)` / `react(immutability)` in
`SpeedStreaks`, `ThirdPersonCamera` and `useCityData`. Those are inherent to mutating
typed arrays and Three.js objects inside `useFrame`, which is the correct pattern here.
Do not "fix" them by moving per-frame work into React state.

## Architecture

The pipeline is one-directional and runs once at startup:

```
Overpass API / localStorage / bundled snapshot
  -> parseCity()            flat BuildingFootprint[] + RoadPath[] in WGS84
  -> buildCityGeometry()    projection, extrusion, merge, BVH, collider arrays
  -> <Scene>                render + physics
```

`useCityData` owns that whole pipeline and is the only place the world is built. The
`<Canvas>` does not mount until the geometry object exists, so the scene never renders a
half-built city.

### State lives outside React

`game/state/gameState.ts` is a plain mutable singleton (Vector3s, booleans). Physics
writes to it 60x/second; React must never own that data. The rules that follow from this:

- Systems read/write `gameState` directly from `useFrame` / Rapier step callbacks.
- The HUD (`ui/useHudSnapshot`) samples it on an 80 ms timer and returns the *previous*
  object when nothing changed, so it only re-renders when a displayed number moves.
- The speed vignette writes `element.style.opacity` from `requestAnimationFrame`, never
  through state.
- React state is reserved for coarse screen phase (loading / title / playing / paused),
  which is driven entirely by pointer lock.

`gameState.world.cityMeshes` is the registration point that lets the web raycast and
the camera occlusion test find the buildings without prop drilling. It holds the
facade, podium and roof meshes; roads, signs and the ground are kept out of it,
and that omission *is* the "buildings only" web-anchor rule.

### Buildings are built by hand, not extruded

`buildBuildings.ts` emits every face itself instead of calling
`ExtrudeGeometry`. That is deliberate and worth keeping:

- **UVs.** `u` follows distance along the wall, `v` follows absolute world
  height, so window bays keep a constant real-world width however long a facade
  is, and floor lines run level across neighbouring buildings. An extrusion's
  generated UVs stretch to fit each box, which is what makes procedural facades
  look like wallpaper.
- **A separate shopfront band.** The bottom `FACADE.podiumHeight` metres go into
  their own buffer with their own texture. Without it a tower stands directly on
  the tarmac and reads as a filing cabinet.
- **Roofs that are roofs.** A deck recessed behind a parapet, plus water tanks
  and plant. This game is looked at from above more than from the street.
- It is also cheaper: the invisible floor cap an extrusion always generates is
  simply never emitted.

Invariants:

- Rings are handled in a 2D "shape space" of `(x, -z)`; world is `(u, y, -v)`.
  Outer rings are forced counter-clockwise and holes clockwise, and the outward
  wall normal then follows from the winding as `normalize(-dz, dx)` (negated for
  holes). Wall normals are verified per building in isolation — testing them
  against the whole city measures Gangnam's party walls, not the geometry.
- The tagged OSM height is the **top of the parapet**. The deck is recessed
  below it; the parapet is never stacked on top, or every building silently
  grows. Rooftop plant may stand proud of the parapet — that is real — and is
  low-rise only.
- Output is split by material (textured facade / textured podium / untextured
  roof), so the city is three draw calls and one Rapier trimesh.
- Facade textures are drawn on a canvas at load time and return null without a
  DOM, keeping the pipeline runnable in plain node.

### Street surface and signboards

`buildRoadGeometry` and `buildSignGeometry` are separate modules that
`buildCityGeometry` orchestrates. Both are decoration: no colliders, and not
registered as raycast targets, so neither can be webbed onto.

- Roads are mitred ribbons, not per-segment quads — the naive version notches
  every bend. Widths come from the OSM `lanes` tag where present (Gangnam-daero
  is `lanes=8` -> 26 m). Zebra crossings are real `footway=crossing` ways.
- **Ribbon winding is checked per triangle, not assumed.** Every street surface
  is horizontal and only ever seen from above, so a back-facing triangle is
  culled and the ground plane — a similar grey — shows through in its place.
  That failure is nearly invisible: the whole carriageway, pavement and edge-line
  layer rendered as nothing for a long time and read as "the road looks fine".
  `emitRibbon` therefore computes each triangle's own `+Y` sign and flips it when
  needed; per-*quad* is not enough, because a hairpin makes the mitred offsets
  cross and produces a bow-tie whose halves wind opposite ways.
- Pavements are paved: a 보도블록 running-bond texture plus the yellow 점자블록
  strip that runs down every Korean pavement, which is what makes the kerb line
  readable at a glance. Both take UVs from the segment tangent, so blocks keep a
  constant real-world size and stay aligned with the street.
- **Pavements are clipped off the carriageway, not merely drawn under it.** They
  are emitted as two bands outside the kerb, resampled to `ROADS.pavementStep`,
  and each piece is dropped when its centre lands on *any* road's tarmac
  (`onCarriageway`). Without the clip, a junction gets one street's paving —
  yellow tactile strip and all — laid diagonally across the other street's
  carriageway. Depth ordering alone hides most of it and is not enough: the
  tactile strip in particular has to stay *behind* the asphalt in
  `polygonOffset`, or it paints over every junction it passes through.
- **A junction box is bare tarmac.** Markings stop inside the carriageway of any
  *other* road at least `markingYieldRatio` of their own width, so where two
  comparable streets meet neither one's lines run through — while a driveway or
  service alley, far below the threshold, interrupts nothing. Solid lines go
  through the same short-bar path as dashes precisely so a junction can cut a
  hole in them; a single long ribbon is all-or-nothing.
- **`onCarriageway` treats a carriageway as a swept rectangle, not a capsule.**
  The projection parameter is deliberately not clamped to the segment. Clamping
  adds a half-width round cap at each end, and OSM splits a long street into
  several ways — so every way boundary would mask its own continuation, and a
  26 m road would lose its markings for 13 m either side of a join that is not a
  junction at all.
- Markings follow the Korean convention and are split into a white mesh and a
  yellow one, because that is the only thing needing a separate material:
  가장자리선 solid white, 차선 broken white between same-direction lanes, 중앙선
  solid yellow (doubled from `doubleCentreLineLanes` up) between opposing
  traffic. One-way ways get no 중앙선 — and note that Gangnam-daero and
  Teheran-ro are mapped as *dual carriageways*, so every wide road here is
  one-way and correctly shows lane lines only. The centre-line colour is
  `COLORS.centreLine` in `Roads.tsx`.
- The four road layers are held apart by `polygonOffset` as well as height: a
  24-bit depth buffer resolves only ~7 cm at 500 m, so Y separation alone
  z-fights at the far edge of the map.
- Roofs are green: Korean low-rise buildings wear green urethane waterproofing,
  which is the most recognisable thing about the city from above — and this game
  is played from above. Towers above `greenRoofMaxHeight` keep a grey deck.
- Signboards render every name into one canvas atlas using the browser's own
  font stack. Chains (`CHAINS` in `buildSignGeometry.ts`) are ranked *ahead* of
  proximity and show their brand rather than the branch name: by count this area
  is overwhelmingly dental clinics and hair salons, so ranking purely by
  distance fills the city with signs nobody recognises and cuts the GS25 on the
  corner. Chain colours are each brand's real livery — flat background and type,
  never a logo or mark.
- **Crown signs** carry the building's own OSM `name` in large type just under
  the parapet on tall buildings. Shopfront boards live at 4-13 m, which is
  invisible from a swing, so without these the whole sign layer disappears the
  moment the player leaves the pavement. One atlas cell is reused across up to
  `crownFaces` walls, so extra faces cost quads but no cells — which is why the
  builder counts cells and boards separately. A board shrinks to fit its wall
  rather than being skipped: OSM maps some towers (Samsung's 203 m Seocho
  building included) as many short segments, and the strict version left exactly
  the landmarks unlabelled. That is what makes Hangul work with no font download, and keeps
  the whole sign layer at one draw call and one texture. `SIGNS.maxTotal` is
  bounded by the atlas grid (`atlasSize / cellWidth x atlasSize / cellHeight`) —
  raising it without enlarging the atlas silently drops signs. The atlas is
  4096x2048, i.e. 32 MB of texture — do not grow it casually.
- Sign quads are wound so that `uDir x vDir == faceNormal`; get that backwards
  and every name renders mirrored. There is no cheap way to notice this by eye
  at gameplay distance, so verify it numerically if you touch the maths.

### One mesh, one collider

Every building surface is merged into three `BufferGeometry` objects and a **single**
static Rapier trimesh, rather than 700+ rigid bodies. Consequences to preserve:

- All buffers are non-indexed, which is why the collider index buffer is just
  `0, 1, 2, ...` over the concatenated positions.
- Only the building meshes are registered as raycast targets, which is *how* the
  "buildings only" web-anchor rule is enforced. The ground plane, road ribbons and
  signboards are separate objects and therefore cannot be webbed. Do not add them.
- Geometry passed as a prop uses `dispose={null}`; `useCityData`'s cleanup owns disposal.

### Camera: aim is never derived from the body

`camera.rotation` is set **directly** from the mouse yaw/pitch, and the position
is derived from that. Never reintroduce `lookAt(player)`: it makes the view
direction a function of where the camera body ended up, so the moment the body
has to be moved — pulled out of a building, or lifted off the street — the aim
moves with it. That is exactly what broke web-slinging at rooftops: standing on
the road the camera is floor-clamped, and a look-at camera was then pinned
within about 5 degrees of horizontal no matter how far the player pitched up.

`camera.rotation.set(pitch, yaw, 0)` with `rotation.order = 'YXZ'` reproduces
`cameraForward(yaw, pitch)` exactly, which is the convention the web raycast and
the spawn aim also use. When nothing is constraining the camera, the derived
position lands on the orbit line anyway, so it behaves like a look-at camera for
most of play. The "look ahead at speed" effect is applied by leading the orbit
*pivot* along the velocity, which leaves the aim untouched.

Why the floor clamp exists: the camera orbits, so pitching the view *up* swings
it *down*. Standing on the street the pivot is only ~2 m up, so at full pitch the
body would land about 5 m below the road — and the ground plane is deliberately
absent from the occlusion raycast (that is what stops it being a web anchor), so
nothing else catches it. `liftAboveFloor` (in `camera/cameraFraming.ts`, kept
separate so it is testable without a render loop) clamps to a floor found by a
downward BVH ray from the pivot, trading the lost height for horizontal distance
so the orbit radius, and therefore the framing, is preserved. At steep upward
pitch on the ground the player does leave the frame — that is geometry, not a
bug, and the aim keeps working throughout.

### Physics step ordering

`PHYSICS.timeStep` must stay equal to the `<Physics timeStep>` prop — the controller uses
the constant as its `dt` because `useBeforePhysicsStep` does not receive one.

`playerController.step` runs in `useBeforePhysicsStep` (reads body, mutates velocity,
writes back) and `.sync` in `useAfterPhysicsStep` (publishes the post-step transform).
Components declared after `<Physics>` in `Scene.tsx` register their `useFrame` later, so
the camera reads a player transform that is already current for the frame.

### Coordinate convention

`game/osm/coordinates.ts` projects lat/lon onto a local tangent plane at Gangnam Station:
`+X` east, `-Z` north, `+Y` up, origin `(0,0,0)`, one unit = one metre. North is `-Z` so a
default-oriented Three.js camera starts facing north. The same yaw/pitch basis
(`cameraForward`) is shared by the camera, the aim hint and the shape-space `(x, -z)`
mapping in `buildCityGeometry` — changing one without the others silently mirrors the city.

## Swing physics: the trap

`game/physics/swingPhysics.ts` treats the rope as a maximum-distance constraint. The
radial-to-tangential transfer **must** stay gated to the slack-to-taut transition
(`justCaught`). An already-taut rope shows a small outward radial velocity every tick
purely because the player is integrated along a straight tangent and drifts off the
sphere by O(v²dt²/L). Feeding that back as tangential speed injects energy proportional to
v² on every tick and the simulation diverges past 2000 m/s within seconds. This is easy to
reintroduce while "improving" the feel.

Related invariants:

- Velocity is never reset on attach or detach. `applyReleaseBoost` only ever adds.
- On attach, the rope is reeled down to `anchor.y - groundClearance` so the bottom of the
  arc clears the street; without it the first swing from a high anchor drags along the road.
- The positional correction is soft (`positionalStiffness`), not a teleport.

## Conventions

- **All gameplay tuning lives in `src/game/config.ts`.** Do not scatter magic numbers into
  components.
- `main.tsx` deliberately omits `<StrictMode>`: its double effect invocation fires two
  Overpass requests on a cold start and builds the physics world twice.
- Overpass is queried at most once per 24 h (see `osm/cache.ts`); the world is fixed after
  load. Never add a query tied to player movement or a render frame.
- `tsconfig` has `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals` and
  `noUnusedParameters` on: use `import type`, and no enums or parameter properties.
- `public/gangnam-osm-snapshot.json` is a trimmed real Overpass response used only when
  every endpoint fails. It goes through the identical parser, so parser changes must stay
  compatible with it — regenerate it whenever the query changes.
- Bump `CACHE_VERSION` in `osm/cache.ts` whenever the parsed `CityData` shape changes,
  or returning players get a stale payload that no longer has the fields the world needs.
- `buildSignGeometry` returns an empty result when `document` is undefined, which is what
  keeps the geometry pipeline runnable in plain node.

## Sky and time of day

`sunPosition.ts` computes where the sun really is over Gangnam Station from the
current clock (Korea is a fixed UTC+9, so there is no time-zone database to
consult), and `skyState.ts` turns its altitude into everything else: palette,
key-light colour and strength, fog, and whether the daylight model or a dark sky
with stars is drawn. Both are plain modules so they can be checked without a
renderer — the solar maths is verified against theory (solstice elevations,
`cos(w) = -tan(lat)tan(dec)` day lengths), not against remembered clock times.

Two things here are deliberate and look like bugs if "corrected":

- **The key light never drops below the horizon.** After sunset it becomes a
  high moon on the opposite bearing. An actual below-horizon sun lights every
  underside in the city and reads as broken.
- **Night is much brighter than real moonlight** (`SKY.moonIntensity`,
  `nightAmbient`). Gangnam at night is lit by shopfronts and street lighting,
  and a physically dark street is one the player cannot navigate.
- **`NIGHT.ground` is the single biggest lever on how dark the city reads.**
  It is the hemisphere light's ground colour, and every street surface faces
  straight up, so it lights the road more than the key light does.

The road's own albedo matters as much as the lighting: `COLORS.asphalt` in
`Roads.tsx` is a mid grey, not the near-black it started as. Beside a
near-white pavement, a 16% grey carriageway has so little light to reflect that
no amount of street lighting makes it read as lit — the pools land on it and
stay brown.

`SkyMode` (`'auto' | 'day' | 'night'`) overrides only the *clock*, never the
model: forcing day evaluates
the real solar position at 14:00 KST on today's date, so a forced winter day is
still a low winter sun rather than a generic noon. `N` cycles it in play and the
title card offers the same three choices; the pick is kept in `localStorage`.
`Atmosphere` polls `gameState.sky.mode` from `useFrame` because the key press
happens outside React.

Lit windows come from a second facade texture used as an `emissiveMap`, faded in
by `gameState.sky.dayFactor` from the frame loop. Without it a night skyline is
a field of black slabs, because the daytime window texture is dark glass.

Getting that texture to read as a city rather than as an insect eye came down to
two things, both easy to undo by accident:

- **The tile has to be bigger than the eye's pattern-matching window.** At 2x2
  bays the same lit/dark arrangement repeated every two floors, and a repeat that
  short reads as a deliberate grid. `FACADE.floorsPerTile`/`baysPerTile` are 4x4,
  i.e. a 12.8 m x 14.4 m repeat, and only ~26% of cells are lit.
- **Each building gets its own UV phase** (`facadePhase` in `buildBuildings.ts`),
  so neighbouring towers do not light the same windows. The `u` shift is
  continuous but the `v` shift is quantised to whole floors — otherwise floor
  lines stop lining up between adjacent buildings and the skyline shears.

The glow rect is inset well inside its cell with a single mullion, so a lit
window is a small warm dot rather than a filled bay, and the emissive colour is
warm (`#ffd9a3`), not white.

## Street lighting

`buildStreetLights` walks the centreline of every road in `litClasses`, placing
a post every `STREET_LIGHTS.spacing` metres. Two buffers: the posts are ordinary
shaded geometry, and the lamp heads are unlit and fade in with
`gameState.sky.dayFactor`. No colliders — a forest of 8 m poles along every kerb
is a lot of thin things for a player at 200 km/h to snag on, for very little in
return.

**The lamps are street furniture, not a light source.** They were a light source
once: each threw an additive disc on the tarmac with an additive cone hanging
above it, tuned over several passes until the coverage metric read 88% of the
carriageway. It still looked wrong. Additive sprites saturate against a dark
road and clip to flat plateaus, so a thousand of them overlapping give you brown
patches with visible rims rather than lit ground, and the beam above each one is
a surface pretending to be a volume — the silhouette is always a hard edge. All
of it is gone. Night is lit by `SKY.nightAmbient` and the hemisphere light,
which is uniform, cheap and predictable. Do not reintroduce per-lamp light
geometry without a real shader behind it.

Placement still matters, because the posts have to stand somewhere sensible:

- **Lamps have their own class list**, not `ROADS.sidewalkClasses`. `service` is
  the second-longest class in this area — 9.4 km of back alley — and excluding
  it left a third of the street network without any lamps at all.
- **A road at least `bothSidesWidth` wide gets a post on both kerbs**; narrower
  streets alternate sides so they get one post per spacing, not a double row.
- **A post is rejected if it lands on tarmac**, via `createCarriagewayMask`. That
  mask tests every road *but the post's own* with a margin — the widened test
  would otherwise mask the post against its own kerb and not one lamp would be
  placed — and then its own road at true width, because a hairpin brings another
  segment of the same way back round underneath the post.
- **Posts closer than `minGap` are one post.** Gangnam-daero is mapped as a dual
  carriageway, so its two halves each want a post on the same kerb; without the
  filter the two z-fight a decimetre apart.

When verifying post spacing in node, average the pole box's 36 vertices: vertex
0 is a *corner*, up to half a diagonal off the post's axis, which reads as a
spacing violation of a few millimetres that is not one.

## Wall crawling

`playerController` has a third locomotion mode beside ground and air: clinging
to a facade. It is a small state machine — `climbing`, `wallNormal`, `wallGrace`
and `wallJumpTimer` — sitting between the web state machine and locomotion, and
the web always wins: firing one while stuck lets go and swings.

Four things about it are load-bearing:

- **Gravity is switched off outright** (`setGravityScale(0)`), not cancelled
  with an opposing velocity. The controller writes `linvel` *before* the step,
  so gravity is still integrated afterwards and a still climber would sag by
  `g * dt` every tick — a visible slide down every wall.
- **A surface is a wall only if its normal is near horizontal**
  (`wallMaxNormalY`). That, and nothing else, is what stops the player
  "climbing" the pavement.
- **How you start depends on where you are.** In the air, brushing a facade is
  enough — that is the fantasy. From the street the player has to steer *into*
  the wall (`wishDir · wallNormal < -0.5`), so running along a shopfront does
  not glue them to it. Requiring a jump instead was tried and is far too fiddly
  to trigger: you are only airborne for a moment and the probe reaches just
  `capsuleRadius + wallProbe`.
- **`wallGraceTime` keeps contact across a gap.** Real facades have corners,
  window reveals and setbacks; dropping the moment a probe misses makes them
  unclimbable.

Movement on the wall projects the *camera's* forward and right onto the wall
plane rather than using a fixed up/across basis, so W is whatever direction the
player is looking on that surface — look up the building to climb, look sideways
to traverse. Staring straight at the facade leaves nothing of the forward axis,
which falls back to climbing upwards.

`Hero.tsx` faces the hero into the wall (`atan2(wallNormal.x, wallNormal.z)`
under its own `atan2(-x, -z)` convention) with only a slight forward lean.
A large pitch there looks like a headstand — someone clinging to a vertical wall
stands *along* it — and points the soles of the feet at the camera.

## Subway entrances

Gangnam Station's twelve street exits are real OSM data
(`railway=subway_entrance`), each with its own `ref`, so exit 11 lands on the
corner exit 11 is actually on. Each is a walled stairwell aligned to the nearest
road with a numbered totem beside it, and they have a collider but are *not*
web anchors.

The stair mouth is a dark panel a few centimetres **above** the pavement rather
than a hole: the ground is a single opaque plane with nothing underneath, so
anything sunk below it would just be hidden by the ground.

## Minimap

`buildMinimap` bakes the whole city plan into one offscreen canvas at load time
(1 px per metre over +-900 m), and `ui/Minimap.tsx` blits a rotated crop of it
every animation frame. One `drawImage` per frame, no scene traversal, no React
state — the same reasoning as the speed vignette.

The dial is heading-up. Canvas `+y` is world `+z`, so `ctx.rotate(yaw)` is what
puts the player's facing at the top; this falls out of the camera's forward
convention and is verified against every yaw rather than eyeballed. Clip to the
circle *before* the blit so the rotated image is only rasterised inside the dial.

## UI

All player-facing strings are Korean. The control list is defined once in
`src/ui/controls.ts` and rendered by both the title card and the always-on
in-game reference panel — add a control there, not in either component. HUD
corners are taken: speed bottom-left, debug top-left, controls top-right,
minimap bottom-right.

The avatar is drawn as a **gingerbread figure**, and there
is only one of it — the old five-preset picker is gone. A head sphere over a
torso capsule, with four limb capsules that run *out* of the torso. Every
measurement lives in `HERO` in `config.ts`, and `Hero.tsx` positions each part
from those numbers, because the silhouette's vertical extent (**-0.79 m to
+0.89 m**) is what the camera framing, the cast shadow and
`PLAYER.capsuleHalfHeight` are all tuned against. Re-proportion the parts
freely; move that extent and the player floats above the pavement or sinks into
it.

Every part is paired with a back-faced shell, which is what draws the inked
outline. **The shell is grown by a fixed `HERO.inkWidth`, not scaled by a
ratio.** A ratio makes the line as thin as the part it wraps, so an arm a third
of the head's radius gets a third of its line weight and the limbs read as
unlined next to a heavily inked head — the version that looked like a balloon
animal. The shell uses `meshBasicMaterial` on purpose: shading it with the sun
makes the line fade out on whichever side faces away.

**Each limb's pivot is sunk inside the torso, and that is what fuses the
character into one silhouette.** Only the portion of a shell that clears the
torso survives the depth test, so a buried joint loses its outline entirely and
the limb reads as continuous with the body; park a limb against the torso
instead and it keeps a full ring of ink and reads as a loose blob floating
nearby. `Hero.tsx` draws the limbs *before* the torso, and the torso before the
head, for the same reason.

**The body carries no markings at all.** Torso and limbs are flat `HERO.suit`,
one off-white, with no texture on them. It is deliberately not `#ffffff`: a
Lambert surface at pure white blows out under the midday key light and the whole
figure collapses to its ink outline.

The mask is one **equirectangular wrap** of the head sphere, and that projection
is the whole trick behind the web: a sphere's own longitude lines radiate from
the crown and its latitude lines ring it, so a plain grid on that canvas lands
as radials and orbitals with no projection maths at all. The orbitals only need
sagging between radials to read as spun web rather than as a globe's graticule.
That wrap is the head's alone — the torso once reused it, and no longer does.

- The mask goes on the same canvas rather than on a separate decal, so there is
  no seam to hide and the web keeps running across the face as it does on the
  real mask. `drawFace` paints on *transparency* and is composited at u = 0.75,
  the sphere's -Z and the character's front.
- The lenses are mirrored halves, so **every** coordinate in `lensPath` must
  stay above 0.5. A value below it lands past the centre line once mirrored and
  the two lenses merge into one smear — which looks like a styling problem and
  is actually a sign error.
- `drawFace` is shared verbatim with the title screen's preview, which is the
  only reason the crop a player lines up there is the one they wear. The
  preview lays down `HERO.suitRed` first, because on the avatar the suit is
  what shows through around the face.
- An uploaded photo replaces the lenses, fading to transparent at its edge.
  The upload panel offers no preset: the only way in is the player's own file,
  which is also the only kind of face that survives a reload —
  `loadCustomFace` rejects any `src` that is not a `data:` URL, so a bundled
  path could never persist. `public/hero-face.png` is left over from the
  removed preset and is now referenced by nothing.

The upload is persisted in `localStorage` under `city-spidy:face` as a data URL
(re-encoded to 512 px JPEG, aspect preserved) plus three crop numbers, and
threaded App -> GameCanvas -> Scene -> Player as a prop. `useFaceImage` decodes
it once so the avatar and the preview share one `HTMLImageElement`, and App
debounces the write because dragging the crop fires on every pointer move.

## Attribution

City data is © OpenStreetMap contributors under the ODbL, credited on the loading screen.
The hero is an original generic character built from primitives; keep it free of any
third-party likeness or branding.
