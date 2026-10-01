const FREEDOM_PLUS_ORBIT_BY_LEVEL = Object.freeze({
  1: 'P39',
  2: 'P14',
  3: 'P12',
  4: 'P6',
  5: 'P4',
  6: 'P4',
  7: 'P3',
});

export function freedomPlusOrbitTypeForLevel(level) {
  return FREEDOM_PLUS_ORBIT_BY_LEVEL[Number(level)] || '';
}
