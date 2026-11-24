// The pixel knight on the Profile screen.
//
// The knight is a 16 x 20 grid of little squares. Each letter in BODY is a
// colour (see COLOURS); '.' means "nothing here". Gear is drawn on top as
// extra squares, so the knight visibly gains items as the level goes up.

const KNIGHT_COLOURS = {
  a: '#9aa3ad', // helmet
  b: '#2b2f36', // visor
  c: '#f0a830', // eye glow
  d: '#e8c9a0', // neck
  e: '#6f7c8c', // armour
  f: '#e8c34a', // armour emblem
  i: '#5a3a22', // belt
  j: '#4d5866', // legs
  k: '#3a3129', // boots
};

const KNIGHT_BODY = [
  '......aaaa......',
  '.....aaaaaa.....',
  '....aabbbbaa....',
  '....aabccbaa....',
  '....aabbbbaa....',
  '.....aaaaaa.....',
  '......dddd......',
  '...eeeeeeeeee...',
  '..eeeeefeeeeee..',
  '..eeeefffeeeee..',
  '..eeeeefeeeeee..',
  '..eeeeeeeeeeee..',
  '..iiiiiiiiiiii..',
  '...eeeeeeeeee...',
  '...eeee..eeee...',
  '...jjjj..jjjj...',
  '...jjjj..jjjj...',
  '...jjjj..jjjj...',
  '..kkkkk..kkkkk..',
  '..kkkkk..kkkkk..',
];

// The levels at which each piece of gear unlocks. This is a COPY of GEAR in
// src/xp.js: the window can't `require` files from src/, so keep the two
// lists the same by hand.
const GEAR = [
  { level: 1, item: 'wooden sword' },
  { level: 3, item: 'steel sword' },
  { level: 5, item: 'cape' },
  { level: 8, item: 'shield' },
  { level: 12, item: 'crown' },
];

// What the window should show for a level (same idea as gearFor in src/xp.js).
function gearForLevel(level) {
  return {
    owned: GEAR.filter((g) => g.level <= level).map((g) => g.item),
    next: GEAR.find((g) => g.level > level) || null,
  };
}

// Each gear piece is a colour plus a list of [row, col] squares.
// `behind` pieces are drawn before the knight, so the body covers them.
const GEAR_ART = {
  'wooden sword': { colour: '#b07a45', trim: { colour: '#d9b384', squares: [[8, 14]] }, squares: [[8, 14], [9, 14], [10, 14], [11, 14], [12, 14], [13, 14], [12, 13]] },
  'steel sword': { colour: '#d9dde2', squares: [[6, 14], [7, 14], [8, 14], [9, 14], [10, 14], [11, 14], [12, 14], [12, 13], [13, 14]] },
  'cape': { colour: '#b03030', behind: true, squares: rectSquares(8, 16, 1, 14) },
  'shield': { colour: '#b07a45', squares: rectSquares(9, 13, 0, 2), trim: { colour: '#e8c34a', squares: [[11, 1]] } },
  'crown': { colour: '#e8c34a', squares: [[0, 6], [0, 9], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10]] },
};

// Every [row, col] in a block: rows from..to-1, columns from..to.
function rectSquares(rowFrom, rowTo, colFrom, colTo) {
  const squares = [];
  for (let r = rowFrom; r < rowTo; r++) {
    for (let c = colFrom; c <= colTo; c++) squares.push([r, c]);
  }
  return squares;
}

function svgNode(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function addSquare(svg, row, col, colour) {
  svg.append(svgNode('rect', { x: col, y: row, width: 1, height: 1, fill: colour }));
}

function addGear(svg, art) {
  for (const [row, col] of art.squares) addSquare(svg, row, col, art.colour);
  if (art.trim) for (const [row, col] of art.trim.squares) addSquare(svg, row, col, art.trim.colour);
}

// Draws the knight for this level. `size` is the width in pixels.
function drawKnight(level, { size = 144 } = {}) {
  const svg = svgNode('svg', {
    width: size, height: size * 1.25, viewBox: '0 0 16 20', 'shape-rendering': 'crispEdges',
  });
  const owned = gearForLevel(level).owned;
  // The steel sword replaces the wooden one, so the wooden one isn't drawn.
  const shown = owned.filter((item) => !(item === 'wooden sword' && owned.includes('steel sword')));

  for (const item of shown) if (GEAR_ART[item].behind) addGear(svg, GEAR_ART[item]);
  KNIGHT_BODY.forEach((rowText, row) => {
    [...rowText].forEach((letter, col) => {
      if (letter !== '.') addSquare(svg, row, col, KNIGHT_COLOURS[letter]);
    });
  });
  for (const item of shown) if (!GEAR_ART[item].behind) addGear(svg, GEAR_ART[item]);
  return svg;
}
