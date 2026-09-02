import { BufferAttribute, BufferGeometry, CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { FACADE, SIGNS } from '../config';
import { latLonToLocal } from '../osm/coordinates';
import type { LocalPoint } from '../osm/coordinates';
import { hashUnit } from '../osm/parseBuildings';
import type { BuildingFootprint, CityData, PoiLabel } from '../osm/types';

/**
 * Real shopfront signboards.
 *
 * Every named OSM POI (`shop=*`, `amenity=*`, ...) is snapped to the building
 * it sits in or nearest to, and hung on the wall closest to it. Signs on the
 * same wall stack upwards, which is what a Korean commercial building actually
 * looks like — and is most of the reason a street reads as Gangnam rather than
 * as generic grey boxes.
 *
 * Text is rendered into a single canvas atlas using the browser's own font
 * stack. That is what makes Hangul work without shipping a megabyte of font
 * data, and it keeps the entire sign layer at one draw call and one texture.
 */

export interface SignGeometry {
  geometry: BufferGeometry | null;
  texture: CanvasTexture | null;
  count: number;
  dispose: () => void;
}

const EMPTY: SignGeometry = {
  geometry: null,
  texture: null,
  count: 0,
  dispose: () => undefined,
};

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

interface SignStyle {
  background: string;
  text: string;
}

/* -------------------------------------------------------------------------- */
/* Chains                                                                      */
/* -------------------------------------------------------------------------- */

interface Chain extends SignStyle {
  /** Strings matched against the OSM `brand` and `name`. */
  keys: string[];
  /** What goes on the board — the Korean name a passer-by would actually read. */
  label: string;
  /**
   * Require the key to be the whole name or its first word. Needed for short
   * keys like `CU`, which would otherwise match inside `Cuchara`.
   */
  strict?: boolean;
}

/**
 * The chains that actually line Gangnam-daero.
 *
 * OSM tags most of these with a `brand`, and the rest are recognisable from the
 * name. Colours are each chain's real signage livery — a flat background and
 * type, no logos or marks — which is what makes a street of boards read as a
 * real street rather than a row of coloured plates.
 */
const CHAINS: Chain[] = [
  // Convenience
  { keys: ['GS25'], label: 'GS25', background: '#00a5e3', text: '#ffffff' },
  { keys: ['CU'], label: 'CU', background: '#6b2c91', text: '#a6ce39', strict: true },
  { keys: ['세븐일레븐', '7-Eleven'], label: '세븐일레븐', background: '#f7f7f5', text: '#00794c' },
  { keys: ['이마트24', '위드미'], label: '이마트24', background: '#ffc220', text: '#1b1b1b' },
  { keys: ['미니스톱', 'Ministop'], label: '미니스톱', background: '#003da5', text: '#ffffff' },

  // Cafes
  { keys: ['스타벅스', 'Starbucks'], label: '스타벅스', background: '#00704a', text: '#ffffff' },
  { keys: ['투썸플레이스', 'Twosome'], label: '투썸플레이스', background: '#1b1b1b', text: '#d6001c' },
  { keys: ['이디야', 'EDIYA'], label: '이디야커피', background: '#0b3c8c', text: '#ffffff' },
  { keys: ['메가커피', 'MEGA'], label: '메가커피', background: '#ffd400', text: '#20202a' },
  { keys: ['빽다방'], label: '빽다방', background: '#ffdd00', text: '#1b1b1b' },
  { keys: ['커피빈', 'Coffee Bean'], label: '커피빈', background: '#4b2e1e', text: '#e8d9b0' },
  { keys: ['할리스', 'Hollys'], label: '할리스', background: '#c8102e', text: '#ffffff' },
  { keys: ['공차', 'Gong Cha'], label: '공차', background: '#c8102e', text: '#ffffff' },
  { keys: ['바나프레소'], label: '바나프레소', background: '#ffe100', text: '#1b1b1b' },
  { keys: ['Blue Bottle'], label: '블루보틀', background: '#f7f7f5', text: '#1a6fbb' },
  { keys: ['앤젤인어스', 'Angel-in-us'], label: '앤젤인어스', background: '#6d3b24', text: '#f4e3c8' },
  { keys: ['Sulbing', '설빙'], label: '설빙', background: '#f7f7f5', text: '#c8102e' },

  // Bakery
  { keys: ['파리바게뜨', 'Paris Baguette'], label: '파리바게뜨', background: '#003876', text: '#ffffff' },
  { keys: ['뚜레쥬르', 'Tous les Jours'], label: '뚜레쥬르', background: '#1e6b3c', text: '#ffffff' },

  // Fast food
  { keys: ['맥도날드', 'McDonald'], label: '맥도날드', background: '#da291c', text: '#ffc72c' },
  { keys: ['버거킹', 'Burger King'], label: '버거킹', background: '#ec7300', text: '#ffffff' },
  { keys: ['롯데리아', 'Lotteria'], label: '롯데리아', background: '#e4002b', text: '#ffffff' },
  { keys: ['맘스터치'], label: '맘스터치', background: '#e4002b', text: '#ffd100' },
  { keys: ['Subway', '서브웨이'], label: '서브웨이', background: '#008c15', text: '#ffc61e' },
  { keys: ['Shake Shack'], label: '쉐이크쉑', background: '#f7f7f5', text: '#4e8542' },
  { keys: ['Five Guys'], label: '파이브가이즈', background: '#e4002b', text: '#ffffff' },
  { keys: ['Dunkin'], label: '던킨', background: '#ff6e0c', text: '#ffffff' },
  { keys: ['Eggdrop'], label: '에그드랍', background: '#ffd100', text: '#1b1b1b' },
  { keys: ['KFC'], label: 'KFC', background: '#e4002b', text: '#ffffff' },

  // Retail
  { keys: ['Olive Young', '올리브영'], label: '올리브영', background: '#93c83e', text: '#ffffff' },
  { keys: ['Innisfree', '이니스프리'], label: '이니스프리', background: '#4c9a2a', text: '#ffffff' },
  { keys: ['다이소', 'Daiso'], label: '다이소', background: '#e60012', text: '#ffffff' },
  { keys: ['Uniqlo', '유니클로'], label: '유니클로', background: '#ff0000', text: '#ffffff' },
  { keys: ['Nike'], label: '나이키', background: '#1b1b1b', text: '#ffffff' },
  { keys: ['Muji'], label: '무인양품', background: '#7c1e23', text: '#ffffff' },
  { keys: ['알라딘'], label: '알라딘', background: '#1b7a3e', text: '#ffffff' },
  { keys: ['Artbox'], label: '아트박스', background: '#e8368f', text: '#ffffff' },
  { keys: ['라인프렌즈', 'Line Friends'], label: '라인프렌즈', background: '#06c755', text: '#ffffff' },
  { keys: ['Samsung', '삼성 딜라이트'], label: '삼성', background: '#1428a0', text: '#ffffff' },
  { keys: ['The Body Shop'], label: '더바디샵', background: '#004b34', text: '#ffffff' },

  // Banks
  { keys: ['KB국민은행', 'KB'], label: 'KB국민은행', background: '#ffbc00', text: '#4b4b4b' },
  { keys: ['신한은행'], label: '신한은행', background: '#0046ff', text: '#ffffff' },
  { keys: ['하나은행'], label: '하나은행', background: '#008485', text: '#ffffff' },
  { keys: ['우리은행'], label: '우리은행', background: '#0067ac', text: '#ffffff' },
  { keys: ['농협'], label: 'NH농협은행', background: '#009a44', text: '#ffffff' },
  { keys: ['IBK', '기업은행'], label: 'IBK기업은행', background: '#0f4c9c', text: '#ffffff' },

  // Cinema
  { keys: ['CGV', '씨지브이'], label: 'CGV', background: '#e71a0f', text: '#ffffff' },
  { keys: ['메가박스', 'Megabox'], label: '메가박스', background: '#4b1e78', text: '#ffffff' },
  { keys: ['롯데시네마'], label: '롯데시네마', background: '#e4002b', text: '#ffffff' },
];

function matchesKey(text: string, key: string, strict: boolean): boolean {
  if (!strict) return text.includes(key);
  return text === key || text.startsWith(`${key} `);
}

/** Finds the chain a POI belongs to, from its `brand` tag or its name. */
function matchChain(poi: PoiLabel): Chain | null {
  const candidates = poi.brand ? [poi.brand, poi.name] : [poi.name];
  for (const chain of CHAINS) {
    for (const key of chain.keys) {
      for (const candidate of candidates) {
        if (matchesKey(candidate, key, chain.strict ?? false)) return chain;
      }
    }
  }
  return null;
}

/**
 * Loosely modelled on real Korean street signage: medical practices are white
 * with blue type, food is red or orange, salons are pink, banks are navy.
 */
const STYLES: Record<string, SignStyle[]> = {
  food: [
    { background: '#c8202c', text: '#fff6ea' },
    { background: '#e2591c', text: '#fff8ee' },
    { background: '#1d1d21', text: '#ffd24a' },
  ],
  beauty: [
    { background: '#c9257c', text: '#fff2f8' },
    { background: '#f2e7ef', text: '#7a1550' },
  ],
  medical: [
    { background: '#f4f7fb', text: '#12467e' },
    { background: '#12467e', text: '#eaf3ff' },
  ],
  finance: [{ background: '#12325e', text: '#eaf1ff' }],
  retail: [
    { background: '#1c6b3a', text: '#f0fff4' },
    { background: '#f5f2e8', text: '#23201a' },
  ],
  nightlife: [
    { background: '#2a1140', text: '#e6b8ff' },
    { background: '#101018', text: '#5ce1ff' },
  ],
  generic: [
    { background: '#22364f', text: '#e6eefc' },
    { background: '#eceff4', text: '#252b33' },
  ],
};

const CATEGORY_GROUP: Record<string, keyof typeof STYLES> = {
  restaurant: 'food',
  fast_food: 'food',
  cafe: 'food',
  bakery: 'food',
  food_court: 'food',
  ice_cream: 'food',
  hairdresser: 'beauty',
  beauty: 'beauty',
  nail_salon: 'beauty',
  massage: 'beauty',
  cosmetics: 'beauty',
  dentist: 'medical',
  clinic: 'medical',
  doctors: 'medical',
  hospital: 'medical',
  pharmacy: 'medical',
  veterinary: 'medical',
  bank: 'finance',
  bureau_de_change: 'finance',
  insurance: 'finance',
  bar: 'nightlife',
  pub: 'nightlife',
  nightclub: 'nightlife',
  cinema: 'nightlife',
  karaoke: 'nightlife',
  convenience: 'retail',
  supermarket: 'retail',
  grocery: 'retail',
  clothes: 'retail',
  shoes: 'retail',
  books: 'retail',
};

function styleFor(poi: PoiLabel, chain: Chain | null): SignStyle {
  if (chain) return chain;
  const value = poi.category.split('=')[1] ?? '';
  const group = STYLES[CATEGORY_GROUP[value] ?? 'generic'];
  return group[Math.floor(hashUnit(poi.id, 11) * group.length) % group.length];
}

/* -------------------------------------------------------------------------- */
/* Building index                                                              */
/* -------------------------------------------------------------------------- */

interface IndexedBuilding {
  ring: LocalPoint[];
  height: number;
  name: string | null;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  area: number;
}

function indexBuildings(buildings: BuildingFootprint[]): IndexedBuilding[] {
  const indexed: IndexedBuilding[] = [];

  for (const building of buildings) {
    const ring = building.outer.map(latLonToLocal);
    if (ring.length < 3) continue;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let area = 0;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const point = ring[i];
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.z < minZ) minZ = point.z;
      if (point.z > maxZ) maxZ = point.z;
      area += ring[j].x * point.z - point.x * ring[j].z;
    }

    indexed.push({
      ring,
      height: building.height,
      name: building.name,
      minX,
      maxX,
      minZ,
      maxZ,
      area: Math.abs(area / 2),
    });
  }

  return indexed;
}

function containsPoint(ring: LocalPoint[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const zi = ring[i].z;
    const zj = ring[j].z;
    if (zi > z !== zj > z && x < ((ring[j].x - ring[i].x) * (z - zi)) / (zj - zi) + ring[i].x) {
      inside = !inside;
    }
  }
  return inside;
}

interface EdgeHit {
  edgeIndex: number;
  distance: number;
  /** Parametric position of the closest point along that edge. */
  t: number;
}

/** Every edge of a footprint, ordered by distance from the point. */
function rankEdges(ring: LocalPoint[], x: number, z: number): EdgeHit[] {
  const hits: EdgeHit[] = [];

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 1e-6) continue;

    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq));
    hits.push({ edgeIndex: i, distance: Math.hypot(a.x + dx * t - x, a.z + dz * t - z), t });
  }

  hits.sort((p, q) => p.distance - q.distance);
  return hits;
}

/** Distance from a point to a footprint, used when snapping a POI. */
function distanceToRing(ring: LocalPoint[], x: number, z: number): number {
  const [nearest] = rankEdges(ring, x, z);
  return nearest ? nearest.distance : Infinity;
}

/** True when the point falls inside any footprint other than `skipIndex`. */
function occupied(
  buildings: IndexedBuilding[],
  x: number,
  z: number,
  skipIndex: number,
): boolean {
  for (let i = 0; i < buildings.length; i++) {
    if (i === skipIndex) continue;
    const building = buildings[i];
    if (x < building.minX || x > building.maxX || z < building.minZ || z > building.maxZ) continue;
    if (containsPoint(building.ring, x, z)) return true;
  }
  return false;
}

/** Unit outward normal of `edgeIndex`, pointing away from the ring's centroid. */
function outwardNormal(ring: LocalPoint[], edgeIndex: number): Vec2 {
  const a = ring[edgeIndex];
  const b = ring[(edgeIndex + 1) % ring.length];
  const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  let nx = -(b.z - a.z) / length;
  let nz = (b.x - a.x) / length;

  let cx = 0;
  let cz = 0;
  for (const vertex of ring) {
    cx += vertex.x;
    cz += vertex.z;
  }
  cx /= ring.length;
  cz /= ring.length;

  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  if (nx * (midX - cx) + nz * (midZ - cz) < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { x: nx, z: nz };
}

interface Vec2 {
  x: number;
  z: number;
}

/* -------------------------------------------------------------------------- */
/* Atlas                                                                       */
/* -------------------------------------------------------------------------- */

const FONT_STACK =
  "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";

/** Shrinks the type until the name fits, then truncates only as a last resort. */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): { text: string; fontSize: number } {
  let fontSize = 34;
  context.font = `700 ${fontSize}px ${FONT_STACK}`;

  while (fontSize > 17 && context.measureText(text).width > maxWidth) {
    fontSize -= 2;
    context.font = `700 ${fontSize}px ${FONT_STACK}`;
  }

  if (context.measureText(text).width <= maxWidth) return { text, fontSize };

  let truncated = text;
  while (truncated.length > 2 && context.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return { text: `${truncated}…`, fontSize };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Builds every signboard in the city into one atlas-textured mesh.
 *
 * @returns an empty result when there is no DOM — the geometry modules are also
 * exercised in plain node.
 */
export function buildSignGeometry(city: CityData): SignGeometry {
  if (typeof document === 'undefined') return EMPTY;

  const buildings = indexBuildings(city.buildings);
  if (buildings.length === 0) return EMPTY;

  const columns = Math.floor(SIGNS.atlasWidth / SIGNS.cellWidth);
  const rows = Math.floor(SIGNS.atlasHeight / SIGNS.cellHeight);
  const capacity = Math.min(SIGNS.maxTotal, columns * rows);

  const canvas = document.createElement('canvas');
  canvas.width = SIGNS.atlasWidth;
  canvas.height = SIGNS.atlasHeight;
  const context = canvas.getContext('2d');
  if (!context) return EMPTY;

  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const positions: number[] = [];
  const uvs: number[] = [];
  const insetU = 0.5 / SIGNS.atlasWidth;
  const insetV = 0.5 / SIGNS.atlasHeight;

  let cells = 0;
  let boards = 0;

  interface CellUv {
    u0: number;
    u1: number;
    vTop: number;
    vBottom: number;
  }

  /**
   * Draws one board into the next free atlas cell.
   *
   * Cells and boards are counted separately on purpose: a crown sign repeats
   * the same cell on several faces of its building, so it costs one cell and
   * several quads.
   */
  function allocateCell(label: string, style: SignStyle): CellUv | null {
    if (cells >= capacity) return null;

    const column = cells % columns;
    const row = Math.floor(cells / columns);
    const cellX = column * SIGNS.cellWidth;
    const cellY = row * SIGNS.cellHeight;

    context!.fillStyle = style.background;
    context!.fillRect(cellX, cellY, SIGNS.cellWidth, SIGNS.cellHeight);
    // A thin lighter rim reads as the aluminium frame of a lightbox sign.
    context!.strokeStyle = 'rgba(255,255,255,0.28)';
    context!.lineWidth = 3;
    context!.strokeRect(cellX + 1.5, cellY + 1.5, SIGNS.cellWidth - 3, SIGNS.cellHeight - 3);

    const { text, fontSize } = fitText(context!, label, SIGNS.cellWidth - 22);
    context!.font = `700 ${fontSize}px ${FONT_STACK}`;
    context!.fillStyle = style.text;
    context!.fillText(text, cellX + SIGNS.cellWidth / 2, cellY + SIGNS.cellHeight / 2 + 1);

    cells += 1;
    return {
      u0: cellX / SIGNS.atlasWidth + insetU,
      u1: (cellX + SIGNS.cellWidth) / SIGNS.atlasWidth - insetU,
      // CanvasTexture flips Y, so canvas row 0 is v = 1.
      vTop: 1 - cellY / SIGNS.atlasHeight - insetV,
      vBottom: 1 - (cellY + SIGNS.cellHeight) / SIGNS.atlasHeight + insetV,
    };
  }

  /**
   * Emits one board standing off a wall.
   *
   * `right` is chosen so that `right x up == outward normal`, which makes the
   * quad wind counter-clockwise as seen from the street. Get that backwards and
   * every name renders mirrored.
   */
  function pushBoard(
    px: number,
    pz: number,
    nx: number,
    nz: number,
    centreY: number,
    width: number,
    height: number,
    uv: CellUv,
  ): void {
    const rx = nz;
    const rz = -nx;
    const hw = width / 2;
    const hh = height / 2;

    const x0 = px - rx * hw;
    const z0 = pz - rz * hw;
    const x1 = px + rx * hw;
    const z1 = pz + rz * hw;
    const yBottom = centreY - hh;
    const yTop = centreY + hh;

    positions.push(
      x0, yBottom, z0,
      x1, yBottom, z1,
      x1, yTop, z1,

      x0, yBottom, z0,
      x1, yTop, z1,
      x0, yTop, z0,
    );
    uvs.push(
      uv.u0, uv.vBottom,
      uv.u1, uv.vBottom,
      uv.u1, uv.vTop,
      uv.u0, uv.vBottom,
      uv.u1, uv.vTop,
      uv.u0, uv.vTop,
    );
    boards += 1;
  }

  /* ---------------------------------------------------------------------- */
  /* Crown signs: building names, high up, readable from the air             */
  /* ---------------------------------------------------------------------- */

  const crowns = buildings
    .filter((building) => building.name && building.height >= SIGNS.crownMinHeight)
    .sort((a, b) => b.height - a.height);

  for (const building of crowns) {
    const label = building.name as string;
    // Company towers often carry the operator's livery; anything else gets a
    // neutral corporate plate.
    const chain = matchChain({
      id: label,
      name: label,
      category: 'building=yes',
      brand: null,
      position: { lat: 0, lon: 0 },
    });
    const style: SignStyle = chain ?? {
      background: hashUnit(label, 40) > 0.5 ? '#20242c' : '#f2f2ee',
      text: hashUnit(label, 40) > 0.5 ? '#f2f2ee' : '#20242c',
    };

    // Longest walls first: they are the most visible and fit the widest board.
    const walls = building.ring
      .map((point, index) => {
        const next = building.ring[(index + 1) % building.ring.length];
        return { index, length: Math.hypot(next.x - point.x, next.z - point.z) };
      })
      .sort((a, b) => b.length - a.length);

    const longest = walls[0];
    if (!longest || longest.length < 6) continue;

    // Shrink to fit rather than skipping. A tower whose outline OSM happens to
    // have mapped in short segments — Samsung's 203 m Seocho tower among them —
    // would otherwise be the one building on the skyline with no name on it.
    const scale = Math.min(SIGNS.crownScale, (longest.length * 0.8) / SIGNS.width);
    const width = SIGNS.width * scale;
    const height = SIGNS.height * scale;
    // The parapet is recessed out of the OSM height, so drop below both.
    const centreY = building.height - FACADE.parapetHeight - SIGNS.crownDrop - height / 2;
    if (centreY < SIGNS.crownMinHeight * 0.4) continue;

    const faceCount = building.height >= SIGNS.crownMultiFaceHeight ? SIGNS.crownFaces : 1;
    const usable = walls.filter((wall) => wall.length >= width * 1.05).slice(0, faceCount);
    if (usable.length === 0) continue;

    const uv = allocateCell(label, style);
    if (!uv) break;

    for (const wall of usable) {
      const a = building.ring[wall.index];
      const b = building.ring[(wall.index + 1) % building.ring.length];
      const tx = (b.x - a.x) / wall.length;
      const tz = (b.z - a.z) / wall.length;
      const { x: nx, z: nz } = outwardNormal(building.ring, wall.index);
      const along = wall.length / 2;
      pushBoard(
        a.x + tx * along + nx * SIGNS.standOff,
        a.z + tz * along + nz * SIGNS.standOff,
        nx, nz, centreY, width, height, uv,
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Shopfront boards                                                        */
  /* ---------------------------------------------------------------------- */

  // Chains first, then whatever is closest to the centre.
  //
  // The board budget is far smaller than the number of named POIs, and by count
  // this area is overwhelmingly dental clinics and hair salons. Ranking purely
  // by distance therefore fills the city with signs nobody recognises, while
  // the GS25 and the 올리브영 on the corner — the things that actually make a
  // street legible as Gangnam — get cut. So every chain gets a board, and the
  // remainder is filled by proximity.
  const ranked = city.pois.map((poi) => {
    const local = latLonToLocal(poi.position);
    return { poi, chain: matchChain(poi), distance: Math.hypot(local.x, local.z) };
  });
  ranked.sort((a, b) => {
    if (!!a.chain !== !!b.chain) return a.chain ? -1 : 1;
    return a.distance - b.distance;
  });

  /** Boards already hung on a given building wall, keyed `building:edge`. */
  const stacks = new Map<string, number>();

  for (const entry of ranked) {
    if (cells >= capacity) break;
    const { poi, chain } = entry;

    const point = latLonToLocal(poi.position);

    /* Snap the POI to a building ------------------------------------------ */
    let chosen: IndexedBuilding | null = null;
    let chosenIndex = -1;
    let chosenDistance = Infinity;
    let inside = false;

    for (let i = 0; i < buildings.length; i++) {
      const building = buildings[i];
      if (
        point.x < building.minX - SIGNS.maxSnapDistance ||
        point.x > building.maxX + SIGNS.maxSnapDistance ||
        point.z < building.minZ - SIGNS.maxSnapDistance ||
        point.z > building.maxZ + SIGNS.maxSnapDistance
      ) {
        continue;
      }

      const isInside = containsPoint(building.ring, point.x, point.z);
      if (isInside) {
        // A POI can fall inside several overlapping footprints; the smallest is
        // the most specific and almost always the right one.
        if (!inside || building.area < (chosen?.area ?? Infinity)) {
          chosen = building;
          chosenIndex = i;
          chosenDistance = 0;
          inside = true;
        }
        continue;
      }
      if (inside) continue;

      const distance = distanceToRing(building.ring, point.x, point.z);
      if (distance < chosenDistance) {
        chosen = building;
        chosenIndex = i;
        chosenDistance = distance;
      }
    }

    if (!chosen || chosenDistance > SIGNS.maxSnapDistance) continue;

    /* Pick the wall and the slot in its stack ------------------------------ */
    // Prefer a wall that actually faces open space. Gangnam blocks are built
    // shoulder to shoulder, so the closest wall to a POI is often a metre from
    // the neighbouring building and any sign on it would never be seen.
    const candidates = rankEdges(chosen.ring, point.x, point.z);
    if (candidates.length === 0) continue;

    let hit = candidates[0];
    for (const candidate of candidates.slice(0, 6)) {
      const edge = chosen.ring[candidate.edgeIndex];
      const next = chosen.ring[(candidate.edgeIndex + 1) % chosen.ring.length];
      if (Math.hypot(next.x - edge.x, next.z - edge.z) < 2) continue;

      const normal = outwardNormal(chosen.ring, candidate.edgeIndex);
      // 2.2 m matches the width of a real Gangnam back alley: any more and a
      // genuinely street-facing wall gets rejected by the building opposite.
      const probeX = (edge.x + next.x) / 2 + normal.x * 2.2;
      const probeZ = (edge.z + next.z) / 2 + normal.z * 2.2;
      if (!occupied(buildings, probeX, probeZ, chosenIndex)) {
        hit = candidate;
        break;
      }
    }

    const a = chosen.ring[hit.edgeIndex];
    const b = chosen.ring[(hit.edgeIndex + 1) % chosen.ring.length];
    const wallLength = Math.hypot(b.x - a.x, b.z - a.z);
    if (wallLength < 2) continue;

    const key = `${chosenIndex}:${hit.edgeIndex}`;
    const slot = stacks.get(key) ?? 0;
    if (slot >= SIGNS.maxPerBuilding) continue;

    // Narrow walls get proportionally smaller boards rather than overhanging.
    const scale = Math.min(1, (wallLength * 0.92) / SIGNS.width);
    const width = SIGNS.width * scale;
    const height = SIGNS.height * scale;
    const centreY = SIGNS.baseHeight + slot * SIGNS.pitch * scale;
    if (centreY + height / 2 > chosen.height - 0.4) continue;

    const tx = (b.x - a.x) / wallLength;
    const tz = (b.z - a.z) / wallLength;
    const { x: nx, z: nz } = outwardNormal(chosen.ring, hit.edgeIndex);

    // Keep the board fully on the wall.
    const along = Math.min(Math.max(hit.t * wallLength, width / 2), wallLength - width / 2);

    // A chain shows its brand, not the branch name: "GS25", not
    // "GS25 주식회사 재이앤역삼아워홈점".
    const uv = allocateCell(chain ? chain.label : poi.name, styleFor(poi, chain));
    if (!uv) break;

    pushBoard(
      a.x + tx * along + nx * SIGNS.standOff,
      a.z + tz * along + nz * SIGNS.standOff,
      nx, nz, centreY, width, height, uv,
    );

    stacks.set(key, slot + 1);
  }

  if (boards === 0) return EMPTY;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.computeVertexNormals();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter; // no mipmaps: the atlas cells must not bleed
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;

  return {
    geometry,
    texture,
    count: boards,
    dispose: () => {
      geometry.dispose();
      texture.dispose();
    },
  };
}
