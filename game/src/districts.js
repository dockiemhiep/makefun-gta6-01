// districts.js: the map knowledge of Port Solano that gameplay and the HUD share.
// Street names, the rectangle of each city block, which district a block belongs to,
// and the display names of the street and district at any point.
import { BLOCKS, ROAD, CELL, HALF, CITY_MIN, roadCoord, nearestRoadIndex, clamp } from './world.js';

export const STREETS_NS = ['Marea Blvd', 'Coral Ave', 'Lantern Ave', 'Sabal Ave', 'Meridian Ave', 'Cobalt Ave', 'Foundry Ave', 'Tern Ave', 'Eastline Rd'];
export const STREETS_EW = ['Northgate Rd', 'Vesper St', 'Orchid St', 'Bolero St', 'Sunset Strip', 'Gull St', 'Canal St', 'Harbor St', 'Dockside St'];
const DISTRICT_NAMES = { beach: 'Marea Beach', docks: 'The Docks', downtown: 'Downtown', midtown: 'Old Solano', coast: 'Solano Shore' };

/** The rectangle of block (bi, bj), sidewalk included: bi counts west to east, bj north to south. */
export function blockRect(bi, bj) {
  return { x0: roadCoord(bi) + ROAD / 2, x1: roadCoord(bi + 1) - ROAD / 2, z0: roadCoord(bj) + ROAD / 2, z1: roadCoord(bj + 1) - ROAD / 2 };
}

/** Index 0..7 of the block column or row that holds a coordinate. */
export const blockIndexOf = (c) => clamp(Math.floor((c + HALF) / CELL), 0, BLOCKS - 1);

/** District of a block: sets its building style, heights and how much neon it carries. */
export function districtOfBlock(bi, bj) {
  if (bi <= 1) return 'beach';
  if (bj >= 6) return 'docks';
  if (bi >= 3 && bi <= 6 && bj >= 2 && bj <= 5) return 'downtown';
  return 'midtown';
}

/** Display name of the district at a point, for the HUD. */
export function districtNameAt(x, z) {
  if (x < CITY_MIN) return DISTRICT_NAMES.coast;
  return DISTRICT_NAMES[districtOfBlock(blockIndexOf(x), blockIndexOf(z))];
}

/** Display name of the nearest street at a point, for the HUD. */
export function streetNameAt(x, z) {
  const i = nearestRoadIndex(x);
  const j = nearestRoadIndex(z);
  return Math.abs(x - roadCoord(i)) < Math.abs(z - roadCoord(j)) ? STREETS_NS[i] : STREETS_EW[j];
}
