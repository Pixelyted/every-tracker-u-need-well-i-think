// Decides where each block sits horizontally inside its day column.
//
// Clashing quests must stay readable, so instead of drawing them on top of
// each other we split the slot into side-by-side columns.
// For every occurrence we return { col, cols }: "sit in column `col` of
// `cols` equal columns".

const { toMinutes } = require('./time');

// Splits the grid blocks (sorted by start) into groups that overlap
// in a chain. Everything in one group shares the same number of columns.
function overlapGroups(active) {
  const groups = [];
  let current = [];
  let groupEnd = -1;
  for (const occ of active) {
    if (current.length > 0 && toMinutes(occ.start) >= groupEnd) {
      groups.push(current);
      current = [];
      groupEnd = -1;
    }
    current.push(occ);
    groupEnd = Math.max(groupEnd, toMinutes(occ.end));
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Inside one group, put each occurrence in the first column whose last
// block has already ended (a simple "greedy" placement).
function placeGroup(group, layout) {
  const columnEnds = [];
  const placed = [];
  for (const occ of group) {
    let col = columnEnds.findIndex((end) => end <= toMinutes(occ.start));
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(0);
    }
    columnEnds[col] = toMinutes(occ.end);
    placed.push({ key: occ.key, col });
  }
  for (const p of placed) {
    layout[p.key] = { col: p.col, cols: columnEnds.length };
  }
}

// Blocks drawn in the time grid. Limited events are banners above the grid,
// and weekly main quests on a break are hidden behind the camp banner.
function isGridBlock(occ) {
  return occ.kind !== 'limited' && occ.status !== 'break';
}

function layoutColumns(occurrences) {
  const layout = {};
  for (const occ of occurrences) {
    layout[occ.key] = { col: 0, cols: 1 };
  }
  // Ghosts (skipped, moved, cancelled) take part too: they don't CLASH, but
  // they must stay visible, so they get their own column instead of being
  // covered by (or printed over) another block.
  const blocks = occurrences
    .filter(isGridBlock)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (const group of overlapGroups(blocks)) {
    placeGroup(group, layout);
  }
  return layout;
}

module.exports = { layoutColumns };
