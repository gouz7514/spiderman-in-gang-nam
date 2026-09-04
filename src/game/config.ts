/**
 * All tunable gameplay values live here.
 *
 * Units are metres, seconds and radians throughout. The world is built at a
 * 1:1 scale against reality, so a value of `22` for gravity really does mean
 * "22 m/s^2" — a little over 2g, which is what makes the swinging feel
 * arcade-y rather than like a physics lab pendulum.
 */

/** The slice of Seoul we reconstruct. */
export const WORLD = {
  /** Gangnam Station, Seoul. This point becomes the world origin (0, 0, 0). */
  center: { lat: 37.4979, lon: 127.0276 },
  /** Overpass query radius. 550 m keeps the download and the collider small. */
  radiusMeters: 550,
  /** Player is respawned when they leave this radius (metres from origin). */
  boundsRadius: 1400,
  /** Player is respawned when they fall below this height. */
  killY: -60,
} as const;

export const PHYSICS = {
  /** Fixed physics timestep. Must match the <Physics timeStep> prop. */
  timeStep: 1 / 60,
  /** Deliberately heavier than Earth: makes falls snappy and swings punchy. */
  gravity: -22,
} as const;

export const PLAYER = {
  /** Above the Gangnam-daero / Teheran-ro crossing, clear of every building. */
  spawn: [0, 20, 0] as [number, number, number],
  capsuleHalfHeight: 0.5,
  capsuleRadius: 0.42,

  /** Ground locomotion. */
  groundAccel: 60,
  groundMaxSpeed: 9,
  /** Shift: sprint. Also raises the swing input force — see WEB.sprintBoost. */
  sprintAccel: 95,
  sprintMaxSpeed: 17,
  /** Quake-style ground friction coefficient. */
  groundFriction: 8,
  /** Friction floor, so a nearly-stopped player still comes to rest quickly. */
  groundStopSpeed: 4,
  jumpSpeed: 9.5,

  /** Air locomotion while *not* attached to a web. */
  airAccel: 26,
  /** Air control stops helping past this horizontal speed. */
  airControlSpeedCap: 28,
  /** Space in mid-air: a one-shot forward dash. */
  airBoost: 15,
  airBoostCooldown: 1.1,

  /** Soft speed ceilings. Excess speed is bled off, never hard-clamped. */
  maxHorizontalSpeed: 80,
  maxTotalSpeed: 100,
  /** Quadratic air drag coefficient (a = -k * |v| * v). */
  airDrag: 0.0028,

  /** How hard the ground check ray reaches below the capsule. */
  groundProbe: 0.25,

  /* Wall crawling ---------------------------------------------------------- */
  /**
   * How far past the capsule a wall probe reaches. Short on purpose: the player
   * has to be all but touching the facade to stick to it, so diving down a
   * street canyon does not snag on the buildings either side.
   */
  wallProbe: 0.45,
  /**
   * A surface counts as a wall when its normal is this close to horizontal.
   * Roofs and the street are excluded by it, which is what stops the player
   * "climbing" the pavement.
   */
  wallMaxNormalY: 0.45,
  /** Roughly a run, so a 60 m tower is a few seconds rather than ten. */
  climbSpeed: 12,
  climbSprintSpeed: 20,
  climbAccel: 80,
  /** Constant pull into the facade, so contact survives a bumpy wall. */
  wallStickSpeed: 2.5,
  /** Space while clinging: push off the wall and up. */
  wallJumpOut: 9,
  wallJumpUp: 8.5,
  /** No re-sticking for this long after a wall jump, or the jump does nothing. */
  wallJumpCooldown: 0.28,
  /** Grace period with no wall under the probe before letting go. */
  wallGraceTime: 0.12,
} as const;

/**
 * The player avatar, drawn as a gingerbread figure.
 *
 * A big head over a tall torso, with limbs that run *out* of the torso rather
 * than sitting beside it. Every limb's pivot is sunk inside the torso: each
 * part carries its own back-faced outline shell, and only the portion of a
 * shell that clears the torso survives the depth test — so burying the joint
 * is what fuses the parts into one continuous outline instead of a pile of
 * loose blobs.
 *
 * The silhouette still spans exactly -0.79 m to +0.89 m: the camera framing,
 * the cast shadow and `PLAYER.capsuleHalfHeight` are all tuned against that
 * extent, so the proportions may change but that extent may not.
 */
export const HERO = {
  /**
   * Torso and limbs are one flat off-white, with no markings on the body at
   * all. Not pure white: a Lambert surface at `#ffffff` blows out under the
   * midday key light and the whole figure flattens to its ink outline.
   */
  suit: '#f4f6f8',
  suitRed: '#c8102e',
  /** Web lines, mask edge and the drawn outline are all the same ink. */
  ink: '#101215',
  lens: '#eef2f6',
  /**
   * Ink line width, in metres. The outline shell is the part grown by this
   * much, *not* scaled by a ratio: a ratio makes the line as thin as the part
   * it wraps, so an arm ends up with no visible outline at all beside the head.
   * Any wider and buried joints start to show through.
   */
  inkWidth: 0.022,

  /**
   * The silhouette is a gingerbread figure, not a ball: a head, a tall torso
   * capsule, and limbs that grow out of it. Every pivot sits *inside* the
   * torso, which is what fuses the whole thing into one outline — see
   * `Hero.tsx`. The vertical extent (-0.79 m to +0.89 m) is what the camera
   * framing, the cast shadow and `PLAYER.capsuleHalfHeight` are tuned against,
   * so parts may be re-proportioned but the extremes must not move.
   */
  head: { radius: 0.35, y: 0.52 },
  torso: { radius: 0.26, length: 0.48, y: 0.05 },
  /** Limbs hang from a pivot at the shoulder / hip and rotate about it. */
  arm: { radius: 0.105, length: 0.4, x: 0.15, pivotY: 0.2 },
  leg: { radius: 0.13, length: 0.34, x: 0.155, pivotY: -0.18, splay: 0.18 },

  /**
   * The mask is one equirectangular wrap of the head sphere, which is the whole
   * trick behind the web: a sphere's own longitude lines radiate from the crown
   * and its latitude lines ring it, so a plain grid on this texture lands as
   * radials and orbitals with no projection maths at all. The torso does not
   * reuse it — the body is plain.
   */
  suitTextureWidth: 1024,
  suitTextureHeight: 512,
  webRadials: 16,
  webOrbitals: 7,

  /** Where the mask sits on that wrap, and how wide it is across the sphere. */
  faceCentreV: 0.57,
  faceSpanDegrees: 86,
  faceTextureSize: 384,
} as const;

export const WEB = {
  /** Maximum distance from the *player* to a valid anchor. */
  maxRange: 115,
  /** The rope can never be reeled shorter than this. */
  minRopeLength: 7,
  /** Extra ray length so the camera (behind the player) can still reach maxRange. */
  rayPadding: 25,

  /** Rope shortens by this much per second while attached — swings tighten. */
  autoReelRate: 3.2,
  /**
   * Swinging from a high anchor on a long rope would put the bottom of the arc
   * below street level. On attachment we work out the longest rope whose arc
   * still clears the road by this much and reel down to it quickly, which is
   * what stops a first swing from scraping along the tarmac.
   */
  groundClearance: 8,
  /** Reel rate used to reach that clearance. Much faster than the idle reel. */
  catchUpReelRate: 34,
  /** Rope shortening per second while Space is held. Big speed gains. */
  boostReelRate: 14,
  /** Safety cap on the tangential speed-up a single reel step may produce. */
  reelGainCapPerStep: 0.05,

  /** Tangential acceleration from WASD while swinging. */
  swingAccel: 45,
  /** Extra acceleration along the current swing direction while W is held. */
  pumpAccel: 20,
  /** Multiplier on both of the above while Shift is held. */
  sprintBoost: 1.6,

  /**
   * When the rope snaps taut we delete the outward radial velocity. Feeding a
   * fraction of it back in as *tangential* speed is what turns a dead-stop
   * pendulum into a superhero swing.
   */
  radialToTangential: 0.34,
  /** Soft positional correction applied when the rope is over-stretched. */
  positionalStiffness: 0.4,

  /** Momentum is preserved on release; these only add a little on top. */
  releaseBoost: 3,
  releaseUpBoost: 2,

  ropeRadius: 0.055,
  /** Seconds the rope takes to visually travel out to the anchor. */
  shootTime: 0.07,
} as const;

export const CAMERA = {
  minDistance: 7.5,
  maxDistance: 12,
  /** Height of the look-at pivot above the player's centre. */
  pivotHeight: 1.1,
  fovBase: 55,
  fovMax: 78,
  /** Speed (m/s) at which FOV / distance / lead reach their maximum. */
  speedReference: 55,
  lookAhead: 4,
  pitchMin: -1.15,
  pitchMax: 1.15,
  sensitivity: 0.0022,
  /** Exponential smoothing rates — higher is stiffer. */
  positionDamp: 9,
  targetDamp: 13,
  fovDamp: 4,
  /** Keeps the camera off building faces. */
  collisionPadding: 0.5,
  /**
   * Minimum height the camera may sit above whatever surface the player is
   * over. Orbiting up while standing on the street would otherwise drop the
   * camera several metres *below* the road — the ground plane is not part of
   * the occlusion raycast, so nothing else stops it.
   */
  groundClearance: 1.3,
  /** How far down to look for the surface under the player. */
  groundProbeDistance: 400,

  /**
   * Mouse-wheel zoom, as a *multiplier* on the orbit distance rather than a
   * distance of its own: the speed pull-back and the selfie framing both keep
   * working, scaled by whatever the player has dialled in.
   */
  zoomMin: 0.45,
  zoomMax: 2.6,
  /** Per unit of wheel delta, applied exponentially so every notch feels equal. */
  zoomSensitivity: 0.0015,

  /**
   * Selfie view (F): the camera swings round to the front of the player and
   * looks back at them. Closer in and raised to head height, so it frames the
   * face rather than the whole body.
   */
  selfieDistance: 3.2,
  /**
   * Measured from the player's centre, like `pivotHeight`. The capsule's head
   * is about 0.75 m up, so this frames the face — go much higher and the shot
   * is of the empty air above it.
   */
  selfiePivotHeight: 0.78,
} as const;

export const BUILDINGS = {
  /** OSM `building:levels` -> metres. */
  levelHeight: 3.2,
  /** Deterministic fallback range for buildings with no height information. */
  fallbackHeightMin: 10,
  fallbackHeightMax: 35,
  minHeight: 3,
  maxHeight: 320,

  /**
   * Korean low-rise buildings almost universally wear green urethane
   * waterproofing on the roof, which is the single most recognisable thing
   * about the city seen from above — and this game is played from above.
   * Towers keep a grey mechanical roof instead.
   */
  greenRoofMaxHeight: 55,
  greenRoofChance: 0.82,
} as const;

export const FACADE = {
  /**
   * Buildings are extruded prisms, so without surface detail they read as
   * coloured boxes however good the footprints are. Two tiling procedural
   * textures fix that without a single extra triangle: one storey of windows,
   * and one shopfront storey for the base.
   *
   * UVs are computed from world position — `u` from the distance along the wall,
   * `v` from the absolute height — so floor lines are continuous along a facade
   * and line up between neighbouring buildings.
   */
  floorHeight: 3.6,
  bayWidth: 3.2,
  /**
   * The tile holds this many storeys/bays. A 2x2 tile makes the pattern of lit
   * windows repeat every two floors and two bays, which at night reads as a
   * regular grid rather than as a building. Combined with the per-building UV
   * phase below, 4x4 is enough to break that up.
   */
  floorsPerTile: 4,
  baysPerTile: 4,
  textureSize: 1024,

  /**
   * Fraction of windows lit after dark. Real towers are mostly dark at night;
   * lighting most of them turns the skyline into a lightbox.
   */
  windowLitChance: 0.26,

  /** Height of the shopfront band at the base of every building. */
  podiumHeight: 4.6,
  podiumBayWidth: 4.2,
  podiumTextureWidth: 256,
  podiumTextureHeight: 512,

  /** Korean roofs are walled: the deck sits recessed behind a low parapet. */
  parapetHeight: 0.85,
  parapetInset: 0.34,
  /** Below this footprint area the parapet inset would self-intersect. */
  parapetMinArea: 26,

  /**
   * How brightly the lit-window map glows once the sun is down. Without it a
   * night city is a field of black slabs, because the daytime window texture is
   * dark glass.
   */
  nightWindowGlow: 0.62,

  /** Water tanks, aircon plant and rooftop huts. */
  clutterChance: 0.78,
  clutterMaxPerRoof: 3,
  clutterMinRoofArea: 110,
} as const;

export const ENTRANCES = {
  /**
   * Gangnam Station's twelve street exits, from `railway=subway_entrance`.
   * OSM has every one with its real `ref`, so exit 11 lands on the corner exit
   * 11 is actually on.
   */
  halfLength: 2.1,
  halfWidth: 1.4,
  wallHeight: 1.05,
  wallThickness: 0.16,

  /**
   * The mouth is a dark panel a few centimetres *above* the pavement, not a
   * hole: the ground is one opaque plane with nothing underneath, so anything
   * sunk below it would simply be invisible.
   */
  mouthY: 0.12,
  treadCount: 5,
  treadWidth: 0.1,

  totemHeight: 2.5,
  totemSize: 0.3,
  totemOffset: 0.28,

  /**
   * The exit board is a landscape panel bolted across the totem, wider than the
   * post it hangs on, exactly as Seoul Metro's own signage is. Its 2:1 shape
   * has to match the atlas cell's: the text is drawn into a landscape cell, so
   * mapping that cell onto a portrait quad squeezes the Hangul until "강남역"
   * is a smear.
   */
  signWidth: 1.2,
  signHeight: 0.6,
  signBottom: 1.6,

  railingColor: '#767b83',
  totemColor: '#1b1e23',
  mouthColor: '#080a0e',
  treadColor: '#3d434c',

  atlasWidth: 2048,
  atlasHeight: 1024,
  cellWidth: 512,
  cellHeight: 256,
} as const;

export const SKY = {
  /**
   * The sky is driven by where the sun actually is over Gangnam Station at the
   * current Korean wall-clock time. Korea keeps a fixed UTC+9 with no daylight
   * saving, so there is no time-zone database to consult.
   */
  updateMs: 30_000,

  /** Sun altitude, in radians, at which it is fully day / fully night. */
  dayAltitude: 0.16,
  nightAltitude: -0.14,
  /** Golden hour is centred just above the horizon. */
  goldenAltitude: 0.03,
  goldenWidth: 0.22,

  sunIntensity: 2.5,
  /**
   * Deliberately brighter than real moonlight. Gangnam at night is lit by
   * shopfronts and street lighting, and a physically dark street is one the
   * player cannot navigate.
   */
  moonIntensity: 1.35,
  /**
   * Hemisphere-light strength at either end of the day. Night is the *higher*
   * of the two and that is deliberate: by day the sun does the work and the
   * ambient is only fill, whereas after dark the ambient is the only thing
   * lighting the streets and the sides of buildings. Total light is still far
   * lower at night once `sunIntensity` is counted.
   */
  nightAmbient: 1.85,
  dayAmbient: 1.55,
  /** After dark the key light becomes a high moon rather than an upward sun. */
  moonElevation: 0.62,

  /** Below this the daylight model is dropped for a plain dark sky and stars. */
  skyCutoffAltitude: -0.3,
  starsAltitude: -0.05,

  /** Fog thickens a little after dark. */
  fogDensityDay: 0.0015,
  fogDensityNight: 0.0021,
} as const;

export const ROADS = {
  /** Fallback width in metres per OSM highway class, used when `lanes` is absent. */
  width: {
    motorway: 22,
    trunk: 20,
    primary: 18,
    secondary: 14,
    tertiary: 11,
    residential: 8,
    unclassified: 7,
    living_street: 6,
    service: 4.5,
    pedestrian: 6,
    footway: 2.2,
  } as Record<string, number>,
  defaultWidth: 6,
  /** A tagged lane is worth this much width. Gangnam-daero is `lanes=8`. */
  laneWidth: 3.25,

  /** Pavement added on each side of a carriageway, forming the kerb line. */
  sidewalkWidth: 3.4,
  /** Classes that get a pavement. Service alleys and footpaths do not. */
  sidewalkClasses: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential'],
  /** Metres covered by one repeat of the paving-block texture. */
  sidewalkTileSize: 2.4,

  /**
   * 점자블록: the yellow tactile paving that runs the length of every Korean
   * pavement. More than anything else it is what tells you at a glance which
   * side of the kerb you are on.
   */
  tactileWidth: 0.6,
  /** Centre of the strip, as a fraction of the pavement width out from the kerb. */
  tactileOffset: 0.5,
  /** Metres covered by one repeat of the tactile block texture. */
  tactileTileSize: 0.6,
  /**
   * Pavements are resampled to this spacing before being emitted, so they can
   * be clipped where another street's carriageway crosses them.
   */
  pavementStep: 2.5,

  /**
   * Lane markings, following the Korean convention:
   *   - 중앙선 (centre line, opposing traffic): solid yellow, doubled on wide roads
   *   - 차선 (lane divider, same direction): broken white
   *   - 가장자리선 (edge line): solid white
   */
  markingWidth: 0.16,
  /** Distance from the carriageway edge to the solid edge line. */
  edgeInset: 0.55,
  dashLength: 3,
  dashGap: 5,
  /**
   * Solid lines are emitted as a run of short bars rather than one long ribbon,
   * so that a junction can cut a hole in them. Consecutive bars overlap
   * slightly to hide the joins on a curve.
   */
  solidStep: 2.5,
  solidOverlap: 1.08,
  /**
   * A road's markings stop inside the carriageway of any *other* road at least
   * this fraction of its own width. A real junction box is bare tarmac with
   * only crossings and stop lines in it, so where two comparable streets meet,
   * both sets of lines stop and the box is left clean. A driveway or service
   * alley is far below the threshold and does not interrupt anything.
   */
  markingYieldRatio: 0.6,
  /** Lane dividers and a centre line are only drawn on roads this wide. */
  minWidthForCentreLine: 7,
  /** From this many lanes upwards the centre line is doubled. */
  doubleCentreLineLanes: 6,
  /** Half the gap between the two lines of a double centre line. */
  centreLineGap: 0.15,

  /** Zebra bars on OSM `footway=crossing` ways. */
  crossingWidth: 4.4,
  crossingBarLength: 0.55,
  crossingBarGap: 0.55,

  /**
   * Layer heights. Combined with per-material `polygonOffset`, this keeps the
   * stack stable out to the far edge of the map — a 24-bit depth buffer only
   * resolves about 7 cm at 500 m, so height separation alone is not enough.
   */
  y: {
    sidewalk: 0.02,
    tactile: 0.038,
    asphalt: 0.05,
    marking: 0.09,
  },
} as const;

export const MINIMAP = {
  /** Widget diameter, in CSS pixels. */
  size: 190,
  /** How much of the world fits across the widget, in metres. */
  worldSpan: 380,
  /** Resolution of the pre-rendered base image. */
  pixelsPerMetre: 1,
  /** Half-extent of the world baked into the base image, in metres. */
  coverage: 900,
} as const;

export const STREET_LIGHTS = {
  /**
   * Lamp posts down the kerb line, whose heads glow after dark. They are street
   * furniture, not a light source: the additive pools and beams they used to
   * throw are gone. Night is lit by `SKY.nightAmbient` instead — see the note
   * in `skyState.ts`.
   */
  spacing: 18,
  /** A way shorter than this gets no lamp at all; anything longer gets one. */
  minSegment: 8,
  /**
   * Which road classes get lamps. Deliberately *not* `ROADS.sidewalkClasses`:
   * `service` is the second-longest class in this area (9.4 km of back alley),
   * and leaving it out left a third of the street network pitch black.
   */
  litClasses: [
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
    'service', 'busway',
  ],
  /** Only roads at least this wide are lit. */
  minRoadWidth: 4,
  /**
   * A road at least this wide gets a post on *both* kerbs at every station
   * instead of alternating. One row of lamps cannot light a 26 m carriageway
   * from the side, and Gangnam-daero is 26 m.
   */
  bothSidesWidth: 13,
  /** Distance out from the kerb; puts the post on the pavement. */
  kerbOffset: 1.1,
  /**
   * Nothing stops two lamps from two different ways landing on the same patch
   * of pavement — Gangnam-daero is mapped as a dual carriageway, so its two
   * halves each want to light the same kerb. Posts closer than this are one
   * post as far as the player is concerned, and two of them z-fight.
   */
  minGap: 7,

  poleHeight: 8,
  poleSize: 0.17,
  /** The arm reaches back out over the carriageway. */
  armLength: 1.5,
  armSize: 0.13,
  headLength: 0.9,
  headWidth: 0.34,
  headDepth: 0.2,

  poleColor: '#3a3f47',
  /** Lamp colour once lit — sodium-ish warm white. */
  lampColor: '#ffd79a',
} as const;

export const SIGNS = {
  /**
   * Korean commercial buildings wear a stack of signboards up the facade, which
   * is most of what makes a Gangnam street look like a Gangnam street. Each OSM
   * POI with a name becomes one board on the nearest wall of its building.
   */
  maxTotal: 512,
  maxPerBuilding: 8,
  /** A POI this far from any building footprint is dropped. */
  maxSnapDistance: 32,

  width: 3.6,
  height: 0.92,
  /** Height of the lowest board, and the vertical pitch of the stack. */
  baseHeight: 4.2,
  pitch: 1.1,
  /** Stand-off from the wall so the board never z-fights with the facade. */
  standOff: 0.18,

  /**
   * Text atlas. One texture, one draw call for every sign in the city.
   * The board budget is bounded by the grid this makes:
   * `(atlasWidth / cellWidth) x (atlasHeight / cellHeight)`.
   */
  atlasWidth: 4096,
  atlasHeight: 2048,
  cellWidth: 256,
  cellHeight: 64,
  /** Names longer than this are truncated with an ellipsis. */
  maxNameLength: 13,

  /**
   * Crown signs: the building's own name near the roofline.
   *
   * Shopfront boards sit at 4-13 m, which is invisible from a swing. Korean
   * towers carry their name in large type just under the parapet, and that is
   * the sign a player actually reads while airborne — so tall named buildings
   * get one, repeated on their longest walls.
   */
  crownMinHeight: 30,
  /** Crown boards are this many times the size of a shopfront board. */
  crownScale: 3.6,
  /** Gap between the parapet and the top of the board. */
  crownDrop: 3.2,
  /** The same atlas cell is reused on this many of the longest walls. */
  crownFaces: 3,
  /** Below this height the board goes on one face only. */
  crownMultiFaceHeight: 55,
} as const;
