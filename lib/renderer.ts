import type { GameState } from './game';

/** Hand-painted-style vector art. All game coordinates are 60 px tiles. */
const T = 60;
type VisualPosition = { x: number; y: number; fromX: number; fromY: number; toX: number; toY: number; changedAt: number };
const visualPositions = new WeakMap<CanvasRenderingContext2D, { elapsed: number; positions: Map<string, VisualPosition> }>();
type MapName = 'candy' | 'forest' | 'snow';
type Palette = { ground: string[]; seam: string; edge: string; leaf: string[]; trunk: string; crates: string[][]; flower: string };
const palettes: Record<MapName, Palette> = {
  candy: { ground: ['#c7eed3', '#b8e5c8'], seam: '#a6d9bc', edge: '#80ba91', leaf: ['#287f72', '#389c79', '#57b48d', '#83d3a1'], trunk: '#4d9b75', crates: [['#f5b7c3', '#db809d', '#ffe2e6'], ['#ffe0a4', '#dba45c', '#fff0c8'], ['#b8dbe9', '#7cadc5', '#e0f2f5']], flower: '#fff9df' },
  forest: { ground: ['#c2e5ae', '#aed695'], seam: '#9bc985', edge: '#659d65', leaf: ['#277357', '#368d60', '#56a974', '#8ac688'], trunk: '#6b9765', crates: [['#dab484', '#a97c52', '#edcc98'], ['#e4c397', '#b18b5d', '#f4dcae'], ['#e9b490', '#bb875f', '#f8d6b2']], flower: '#fff9db' },
  snow: { ground: ['#e5f4f6', '#d4e9f1'], seam: '#c4dfe8', edge: '#82b5cf', leaf: ['#5c8eab', '#7ba6bf', '#a0c4d6', '#f0faff'], trunk: '#82a5b4', crates: [['#a9d3e8', '#70a9ca', '#e1f6ff'], ['#cabee7', '#9c8ac2', '#ede6ff'], ['#bedfe0', '#86b8bf', '#ecffff']], flower: '#ffffff' },
};

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient | CanvasPattern, stroke?: string, width = 1) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
function path(ctx: CanvasRenderingContext2D, coords: number[], fill: string, stroke?: string, width = 1) {
  ctx.beginPath(); ctx.moveTo(coords[0], coords[1]); for (let i = 2; i < coords.length; i += 2) ctx.lineTo(coords[i], coords[i + 1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
function strokeCurve(ctx: CanvasRenderingContext2D, color: string, width: number, points: number[]) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(points[0], points[1]); ctx.bezierCurveTo(points[2], points[3], points[4], points[5], points[6], points[7]); ctx.stroke();
}
function gradient(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, a: string, b: string) {
  const g = ctx.createLinearGradient(x, y, x, y + height); g.addColorStop(0, a); g.addColorStop(1, b); return g;
}
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2; const rr = i % 2 ? r * .46 : r; if (!i) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

/** x/y are the avatar's center, size is its overall width. No emoji or external assets. */
export function drawAvatar(ctx: CanvasRenderingContext2D, character: string, x: number, y: number, size: number, time = 0): void {
  const kind = ['blue', 'pink', 'orange', 'mint'].includes(character) ? character : 'blue';
  const skins: Record<string, { top: string; bottom: string; outline: string; light: string; boot: string }> = {
    blue: { top: '#79cfff', bottom: '#278bd9', outline: '#326eab', light: '#b6e8ff', boot: '#2781c6' },
    pink: { top: '#ffc3da', bottom: '#ee80b0', outline: '#bb6b99', light: '#ffe4ee', boot: '#d96d9f' },
    orange: { top: '#ffd285', bottom: '#ed9f41', outline: '#bd803b', light: '#ffe9ac', boot: '#d88936' },
    mint: { top: '#a1e3c8', bottom: '#4eb99a', outline: '#408c78', light: '#d5fff0', boot: '#39a887' },
  };
  const s = skins[kind]; const bob = Math.sin(time * .003 + x * .1) * 1.1;
  ctx.save(); ctx.translate(x, y + bob); ctx.scale(size / 68, size / 68); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // The two little shoes and mittens make the silhouette read at game size.
  ellipse(ctx, -13, 28, 10, 6.5, s.boot, s.outline, 1.5); ellipse(ctx, 13, 28, 10, 6.5, s.boot, s.outline, 1.5);
  ellipse(ctx, -24, 12, 7.5, 9.2, s.bottom, s.outline, 1.4); ellipse(ctx, 24, 12, 7.5, 9.2, s.bottom, s.outline, 1.4);
  ctx.fillStyle = gradient(ctx, 0, 1, 28, s.top, s.bottom); round(ctx, -22, -1, 44, 29, 17); ctx.fill(); ctx.strokeStyle = s.outline; ctx.lineWidth = 1.7; ctx.stroke();
  ellipse(ctx, 0, 16, 13.3, 10.6, kind === 'blue' ? '#eaf9ff' : kind === 'orange' ? '#fff1d1' : '#f4fff9');
  if (kind === 'blue') {
    ellipse(ctx, -21, -25, 9, 12, s.bottom, s.outline, 1.8); ellipse(ctx, 21, -25, 9, 12, s.bottom, s.outline, 1.8);
  } else if (kind === 'pink') {
    ctx.save(); ctx.rotate(-.13); round(ctx, -24, -57, 15, 36, 8); ctx.fillStyle = gradient(ctx, 0, -57, 35, s.light, s.bottom); ctx.fill(); ctx.strokeStyle = s.outline; ctx.lineWidth = 1.6; ctx.stroke(); round(ctx, -20, -52, 7, 24, 5); ctx.fillStyle = '#e990b4'; ctx.fill(); ctx.restore();
    ctx.save(); ctx.rotate(.13); round(ctx, 9, -57, 15, 36, 8); ctx.fillStyle = gradient(ctx, 0, -57, 35, s.light, s.bottom); ctx.fill(); ctx.strokeStyle = s.outline; ctx.lineWidth = 1.6; ctx.stroke(); round(ctx, 13, -52, 7, 24, 5); ctx.fillStyle = '#e990b4'; ctx.fill(); ctx.restore();
  } else if (kind === 'orange') {
    ellipse(ctx, -23, -30, 10.5, 11, s.top, s.outline, 1.7); ellipse(ctx, 23, -30, 10.5, 11, s.top, s.outline, 1.7);
    ellipse(ctx, -23, -30, 5.5, 6, '#eaa060'); ellipse(ctx, 23, -30, 5.5, 6, '#eaa060');
  } else {
    path(ctx, [-8, -35, -1, -47, 7, -35], '#ffd284', s.outline, 1.5);
    path(ctx, [9, -33, 18, -41, 21, -28], '#ffd284', s.outline, 1.5);
  }
  // Glossy animal hood with a sculpted pale face opening.
  ctx.fillStyle = gradient(ctx, 0, -38, 54, s.top, s.bottom); round(ctx, -31, -38, 62, 54, 26); ctx.fill(); ctx.strokeStyle = s.outline; ctx.lineWidth = 1.8; ctx.stroke();
  ctx.save(); ctx.globalAlpha = .65; strokeCurve(ctx, s.light, 4.3, [-23, -24, -22, -33, -13, -35, -5, -35]); ctx.restore();
  if (kind === 'blue') {
    ellipse(ctx, -10, -29.3, 4.2, 5, '#f3fcff'); ellipse(ctx, 10, -29.3, 4.2, 5, '#f3fcff');
    ellipse(ctx, -9.3, -29, 1.5, 2, '#416b8f'); ellipse(ctx, 9.3, -29, 1.5, 2, '#416b8f');
    path(ctx, [-5, -26, 5, -26, 0, -21], '#ffd361', '#dba74c', .6);
  } else if (kind === 'mint') {
    ellipse(ctx, -15, -28.5, 4.2, 5, '#ecfff7'); ellipse(ctx, 15, -28.5, 4.2, 5, '#ecfff7');
    ellipse(ctx, -14, -28.5, 1.6, 2.3, '#398776'); ellipse(ctx, 14, -28.5, 1.6, 2.3, '#398776');
    path(ctx, [-15, -20, -11, -14, -7, -20], '#fff9da'); path(ctx, [7, -20, 11, -14, 15, -20], '#fff9da');
  } else if (kind === 'orange') {
    ellipse(ctx, 0, -28, 6.5, 4.5, '#ffeac1'); ellipse(ctx, 0, -29, 3, 2.2, '#97654a');
  } else {
    ellipse(ctx, -13, -29, 1.5, 2, '#bb6b99'); ellipse(ctx, 13, -29, 1.5, 2, '#bb6b99');
    path(ctx, [-2.8, -27, 2.8, -27, 0, -24], '#d7799c');
  }
  ctx.fillStyle = gradient(ctx, 0, -21, 32, '#fff6df', '#ffe4c7'); round(ctx, -24, -21, 48, 31, 16); ctx.fill(); ctx.strokeStyle = kind === 'blue' ? '#3f8dc3' : s.outline; ctx.lineWidth = 1.1; ctx.stroke();
  // A slight asymmetric hair curl gives the original chibi faces personality.
  ctx.beginPath(); ctx.moveTo(-10, -20); ctx.quadraticCurveTo(-5, -25, 3, -21); ctx.quadraticCurveTo(6, -19, 5, -16); ctx.quadraticCurveTo(1, -21, -4, -18); ctx.fillStyle = '#8b6c58'; ctx.fill();
  const blink = Math.sin(time * .0011 + (kind === 'pink' ? 3 : 0)) > .997;
  if (blink) { strokeCurve(ctx, '#49536a', 2.1, [-15, -7, -12, -5, -10, -5, -7, -7]); strokeCurve(ctx, '#49536a', 2.1, [7, -7, 10, -5, 12, -5, 15, -7]); }
  else {
    ellipse(ctx, -10.5, -7, 4.2, 5.5, '#3c4c65'); ellipse(ctx, 10.5, -7, 4.2, 5.5, '#3c4c65');
    ellipse(ctx, -11.8, -9, 1.5, 1.8, '#fff'); ellipse(ctx, 9.2, -9, 1.5, 1.8, '#fff');
    ellipse(ctx, -9.6, -5.2, .8, .8, '#95c0d0'); ellipse(ctx, 11.4, -5.2, .8, .8, '#95c0d0');
  }
  ctx.save(); ctx.globalAlpha = .6; ellipse(ctx, -18, .1, 4.3, 2.2, '#f5a6a8'); ellipse(ctx, 18, .1, 4.3, 2.2, '#f5a6a8'); ctx.restore();
  strokeCurve(ctx, '#9b6f61', 1.7, [-4, 1.5, -1.5, 4.5, 1.5, 4.5, 4, 1.5]);
  if (kind === 'pink') {
    path(ctx, [10, 11, 18, 7, 18, 17], '#e979a7', '#c86196', .7); path(ctx, [10, 11, 3, 7, 3, 17], '#e979a7', '#c86196', .7); ellipse(ctx, 10.5, 12, 2.7, 3, '#ffd0e1');
  } else if (kind === 'blue') {
    ellipse(ctx, 0, 17, 3, 3, '#70b6e3'); ellipse(ctx, -.7, 16.1, 1, 1, '#d5f2ff');
  } else if (kind === 'mint') {
    ellipse(ctx, -6, 17, 2.3, 2.3, '#a4dcca'); ellipse(ctx, 6, 17, 2.3, 2.3, '#a4dcca');
  } else star(ctx, 0, 17, 4.7, '#eab259');
  ctx.restore();
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, s = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); for (let k = 0; k < 5; k++) { const a = k * Math.PI * .4; ellipse(ctx, Math.cos(a) * 2.5, Math.sin(a) * 2.5, 2.2, 2.2, color); } ellipse(ctx, 0, 0, 1.6, 1.6, '#edc874'); ctx.restore();
}

function drawGround(ctx: CanvasRenderingContext2D, map: MapName, tiles: number[][], time: number) {
  const p = palettes[map];
  ctx.fillStyle = p.edge; ctx.fillRect(0, 0, 900, 660);
  for (let row = 0; row < 11; row++) for (let col = 0; col < 15; col++) {
    const x = col * T, y = row * T;
    ctx.fillStyle = p.ground[(row + col) % 2]; ctx.fillRect(x, y, T, T);
    ctx.strokeStyle = p.seam; ctx.lineWidth = .6; ctx.strokeRect(x + .5, y + .5, T - 1, T - 1);
    // Sparse hand placed meadow details, seeded from tile coordinates.
    const seed = (col * 19 + row * 37) % 23;
    if ((tiles[row]?.[col] ?? 0) === 0) {
      if (seed < 4) {
        ctx.globalAlpha = .45; strokeCurve(ctx, map === 'snow' ? '#b1d3e2' : '#79b48b', 1.5, [x + 12, y + 47, x + 10, y + 43, x + 9, y + 42, x + 7, y + 42]); strokeCurve(ctx, map === 'snow' ? '#b1d3e2' : '#79b48b', 1.4, [x + 12, y + 47, x + 12, y + 42, x + 14, y + 39, x + 15, y + 39]); ctx.globalAlpha = 1;
      }
      if (seed === 8 || seed === 14) drawFlower(ctx, x + 48, y + 17, p.flower, .72);
      if (map === 'snow' && seed === 4) { ellipse(ctx, x + 18, y + 19, 8, 3, '#f8ffff'); ellipse(ctx, x + 36, y + 44, 5, 2, '#f8ffff'); }
    }
  }
  // Soft canopy shadows lend the playfield a miniature diorama feeling.
  ctx.save(); ctx.globalAlpha = .05; ctx.fillStyle = '#174e54';
  for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.ellipse(110 + k * 140 + Math.sin(time * .0002) * 2, 20, 83, 42, -.4, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
}

function drawBush(ctx: CanvasRenderingContext2D, x: number, y: number, map: MapName, seed: number) {
  const p = palettes[map];
  ellipse(ctx, x + 31, y + 48, 27, 10, 'rgba(43,99,65,.16)');
  round(ctx, x + 7, y + 18, 47, 31, 12); ctx.fillStyle = p.leaf[0]; ctx.fill();
  ellipse(ctx, x + 15, y + 23, 12, 16, p.leaf[1]); ellipse(ctx, x + 44, y + 23, 13, 16, p.leaf[1]);
  ellipse(ctx, x + 30, y + 18, 20, 21, p.leaf[2]); ellipse(ctx, x + 16, y + 16, 11, 12, p.leaf[2]); ellipse(ctx, x + 45, y + 16, 11, 12, p.leaf[2]);
  ellipse(ctx, x + 25, y + 8, 12, 8, p.leaf[3]); ellipse(ctx, x + 42, y + 10, 8, 6, p.leaf[3]);
  ctx.save(); ctx.globalAlpha = .48; strokeCurve(ctx, p.leaf[3], 2.6, [x + 10, y + 22, x + 11, y + 17, x + 13, y + 16, x + 16, y + 16]); ctx.restore();
  ellipse(ctx, x + 25, y + 30, 2, 3, p.leaf[1]); ellipse(ctx, x + 37, y + 29, 1.8, 2.5, p.leaf[1]);
  if (map === 'snow') {
    ctx.beginPath(); ctx.moveTo(x + 5, y + 14); ctx.bezierCurveTo(x + 1, y + 2, x + 19, y - 2, x + 24, y + 2); ctx.bezierCurveTo(x + 34, y - 6, x + 55, y + 1, x + 55, y + 12); ctx.bezierCurveTo(x + 56, y + 24, x + 45, y + 19, x + 40, y + 18); ctx.bezierCurveTo(x + 35, y + 24, x + 24, y + 22, x + 22, y + 17); ctx.bezierCurveTo(x + 14, y + 23, x + 7, y + 21, x + 5, y + 14); ctx.fillStyle = '#f4fdff'; ctx.fill();
    strokeCurve(ctx, '#fff', 2, [x + 15, y + 7, x + 24, y + 2, x + 37, y + 2, x + 43, y + 6]);
  } else if (seed % 6 === 0) {
    drawFlower(ctx, x + 19, y + 10, map === 'candy' ? '#ffd4e7' : '#fff4ce', 1.05); drawFlower(ctx, x + 45, y + 28, '#fff5d9', .8);
  } else if (seed % 7 === 2) { ellipse(ctx, x + 15, y + 28, 3.1, 3.7, '#ef94a8'); ellipse(ctx, x + 20, y + 31, 2.6, 3, '#ffbbbd'); }
  if (map !== 'snow' && seed % 9 === 1) {
    // Tiny sugar mushrooms sit at the edge of the hedge.
    ellipse(ctx, x + 47, y + 48, 8, 2.5, '#32624f22');
    round(ctx, x + 43, y + 36, 7, 12, 3); ctx.fillStyle = '#fff0d4'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 46.5, y + 36, 10, 8, 0, Math.PI, Math.PI * 2); ctx.quadraticCurveTo(x + 56, y + 39, x + 46, y + 40); ctx.quadraticCurveTo(x + 37, y + 39, x + 36.5, y + 36); ctx.fillStyle = map === 'candy' ? '#ed9bb8' : '#de9b6b'; ctx.fill();
    ellipse(ctx, x + 42, y + 33, 2.5, 1.7, '#fff4e7'); ellipse(ctx, x + 50, y + 34, 1.6, 1.4, '#fff4e7');
  }
}

function drawCrate(ctx: CanvasRenderingContext2D, x: number, y: number, map: MapName, seed: number) {
  const p = palettes[map]; const [front, side, top] = p.crates[seed % 3];
  ellipse(ctx, x + 31, y + 50, 26, 8, 'rgba(57,99,70,.16)');
  round(ctx, x + 6, y + 13, 48, 37, 8); ctx.fillStyle = side; ctx.fill();
  round(ctx, x + 5, y + 5, 45, 39, 7); ctx.fillStyle = front; ctx.fill(); ctx.strokeStyle = side; ctx.lineWidth = 1.2; ctx.stroke();
  round(ctx, x + 6, y + 3, 47, 16, 6); ctx.fillStyle = top; ctx.fill();
  path(ctx, [x + 50, y + 13, x + 54, y + 9, x + 54, y + 43, x + 49, y + 49], side);
  if (map === 'forest') {
    round(ctx, x + 11, y + 20, 31, 18, 2); ctx.strokeStyle = side; ctx.lineWidth = 1.8; ctx.stroke();
    strokeCurve(ctx, side, 3, [x + 13, y + 22, x + 23, y + 27, x + 31, y + 32, x + 40, y + 36]);
    strokeCurve(ctx, side, 3, [x + 40, y + 22, x + 31, y + 27, x + 23, y + 32, x + 13, y + 36]);
    ellipse(ctx, x + 12, y + 22, 1, 1, '#8f6a46'); ellipse(ctx, x + 40, y + 37, 1, 1, '#8f6a46');
  } else if (map === 'snow') {
    ctx.save(); ctx.globalAlpha = .75; ctx.strokeStyle = '#f6ffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 27, y + 22); ctx.lineTo(x + 27, y + 36); ctx.moveTo(x + 20, y + 25); ctx.lineTo(x + 34, y + 33); ctx.moveTo(x + 20, y + 33); ctx.lineTo(x + 34, y + 25); ctx.stroke(); ctx.restore();
    strokeCurve(ctx, '#fff', 2, [x + 12, y + 25, x + 12, y + 21, x + 14, y + 20, x + 17, y + 20]);
  } else {
    // Wrapped candy ribbons run continuously over the top and the front.
    ctx.fillStyle = '#ffffff65'; ctx.fillRect(x + 23, y + 6, 9, 37); ctx.fillRect(x + 8, y + 26, 39, 8);
    ctx.save(); ctx.translate(x + 28, y + 10); ctx.rotate(-.16); ellipse(ctx, -6, 0, 6, 3.1, '#ffffffb5'); ctx.rotate(.32); ellipse(ctx, 6, 0, 6, 3.1, '#ffffffb5'); ctx.restore(); ellipse(ctx, x + 28, y + 10, 2.8, 2.8, '#fff9ea');
  }
  strokeCurve(ctx, '#ffffff90', 1.8, [x + 10, y + 10, x + 11, y + 7, x + 17, y + 7, x + 21, y + 7]);
}

function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, remaining: number, time: number) {
  const pulse = 1 + Math.sin(time * (remaining < 700 ? .025 : .009)) * (remaining < 700 ? .06 : .025);
  ctx.save(); ctx.translate(x, y); ctx.scale(pulse, pulse);
  ellipse(ctx, 1, 16, 20, 6, 'rgba(41,115,136,.2)');
  const g = ctx.createRadialGradient(-9, -13, 2, 1, 2, 24); g.addColorStop(0, '#c9faff'); g.addColorStop(.38, '#6eddf3'); g.addColorStop(.78, '#31b5e0'); g.addColorStop(1, '#238acb');
  ellipse(ctx, 0, -1, 21, 22, g, '#2d96c8', 1.4);
  ctx.save(); ctx.rotate(-.4); ellipse(ctx, -6, -13, 7, 3.3, '#eaffff'); ellipse(ctx, 7, -11, 2.2, 1.8, '#b6f8ff'); ctx.restore();
  strokeCurve(ctx, '#98eff6', 2, [-12, 11, -7, 18, 8, 20, 15, 8]);
  round(ctx, -5, -24, 10, 7, 3); ctx.fillStyle = '#4ab4cb'; ctx.fill(); ctx.strokeStyle = '#278bb7'; ctx.lineWidth = 1; ctx.stroke();
  strokeCurve(ctx, '#bd9659', 2.8, [0, -23, 1, -33, 8, -25, 8, -34]);
  star(ctx, 8, -34, 5 + Math.sin(time * .026) * 1.1, '#fff4b2'); star(ctx, 8, -34, 2.6, '#ffbd60');
  ctx.restore();
}

function drawItem(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, time: number) {
  const bob = Math.sin(time * .004 + x) * 2;
  ellipse(ctx, x, y + 12, 14, 4, 'rgba(57,99,70,.13)');
  ctx.save(); ctx.translate(x, y - 3 + bob);
  const colors: Record<string, string[]> = { capacity: ['#95deff', '#54addd'], range: ['#ffdaa4', '#e9ad64'], speed: ['#edc3fb', '#bc8fdc'], shield: ['#bcefd1', '#64ba92'] }; const c = colors[type] || colors.capacity;
  round(ctx, -16, -16, 32, 32, 10); ctx.fillStyle = gradient(ctx, 0, -16, 32, c[0], c[1]); ctx.fill(); ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 2; ctx.stroke();
  if (type === 'capacity') { ellipse(ctx, 0, 0, 8.2, 8.5, '#e0faff', '#69b3d1', 1); strokeCurve(ctx, '#fff', 2, [-5, -2, -5, -6, -2, -7, 0, -7]); ctx.fillStyle = '#6ba6c0'; ctx.fillRect(-2, -12, 4, 4); }
  else if (type === 'range') { ctx.strokeStyle = '#fff9e3'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.stroke(); ellipse(ctx, 0, 0, 4, 4, '#fff5cf'); }
  else if (type === 'speed') { path(ctx, [3, -11, -7, 2, 0, 2, -3, 11, 9, -3, 2, -3], '#fff6ff'); }
  else { ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(10, -6); ctx.lineTo(8, 5); ctx.quadraticCurveTo(4, 11, 0, 12); ctx.quadraticCurveTo(-6, 9, -8, 5); ctx.lineTo(-10, -6); ctx.closePath(); ctx.fillStyle = '#effff5'; ctx.fill(); strokeCurve(ctx, '#91d3ae', 2, [-4, 0, -1, 4, -1, 4, 5, -3]); }
  ctx.restore();
}

function drawWater(ctx: CanvasRenderingContext2D, x: number, y: number, remaining: number, time: number) {
  const opacity = Math.min(1, remaining / 180);
  ctx.save(); ctx.globalAlpha = opacity;
  const g = ctx.createRadialGradient(x, y, 2, x, y, 33); g.addColorStop(0, '#f1ffffe8'); g.addColorStop(.5, '#84e6f7dc'); g.addColorStop(1, '#4fcfe299');
  round(ctx, x - 28, y - 24, 56, 48, 17); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#e2fdffcc'; ctx.lineWidth = 2.7; ctx.beginPath(); ctx.ellipse(x, y, 22 + Math.sin(time * .02 + x) * 2, 16, 0, 0, Math.PI * 2); ctx.stroke();
  for (let j = 0; j < 4; j++) { const angle = j * Math.PI / 2 + x * .03 + time * .002; const r = 20 + Math.sin(time * .01 + j) * 7; ellipse(ctx, x + Math.cos(angle) * r, y + Math.sin(angle) * r - 3, 3, 4.2, '#e2fcffbb'); }
  ctx.restore();
}

function drawTrap(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const float = Math.sin(time * .005) * 2;
  ctx.save(); ctx.translate(x, y + float);
  const g = ctx.createRadialGradient(-12, -13, 1, 0, -5, 38); g.addColorStop(0, '#dcfbff03'); g.addColorStop(.7, '#b2f2ff30'); g.addColorStop(1, '#78dbf5b0');
  ellipse(ctx, 0, -5, 33, 37, g, '#e8fdff', 2.8);
  strokeCurve(ctx, '#fff', 4, [-22, -15, -22, -27, -12, -34, -4, -35]); strokeCurve(ctx, '#b0f4ff', 3, [26, -4, 29, 12, 20, 25, 9, 27]); ellipse(ctx, 15, -29, 4, 2.4, '#fff9');
  ctx.restore();
}

export function renderGame(ctx: CanvasRenderingContext2D, state: GameState, time: number, opts: { localId?: string; preview?: boolean } = {}): void {
  const map = (state.map || 'candy') as MapName;
  let visual = visualPositions.get(ctx);
  if (!visual || state.elapsed < visual.elapsed - 200) {
    visual = { elapsed: state.elapsed, positions: new Map() }; visualPositions.set(ctx, visual);
  }
  visual.elapsed = state.elapsed;
  ctx.save(); ctx.clearRect(0, 0, 900, 660); ctx.imageSmoothingEnabled = true;
  drawGround(ctx, map, state.tiles, time);
  // Effects and object shadows live on the ground plane.
  for (const blast of state.blasts) drawWater(ctx, (blast.x + .5) * T, (blast.y + .5) * T, blast.remaining, time);
  for (const item of state.items) drawItem(ctx, item.type, (item.x + .5) * T, (item.y + .5) * T, time);
  const objects: { depth: number; draw: () => void }[] = [];
  // Lobby props are render-only: no bombs or pickups enter the live simulation.
  if (opts.preview) {
    const occupied = new Set(state.players.map(player => `${player.x},${player.y}`));
    for (const object of [...state.items, ...state.bombs]) occupied.add(`${object.x},${object.y}`);
    const findSpot = (wantedX: number, wantedY: number) => {
      let best: { x: number; y: number; distance: number } | undefined;
      for (let y = 1; y < 10; y++) for (let x = 1; x < 14; x++) {
        if (state.tiles[y][x] || occupied.has(`${x},${y}`)) continue;
        const distance = Math.abs(x - wantedX) + Math.abs(y - wantedY);
        if (!best || distance < best.distance) best = { x, y, distance };
      }
      if (best) occupied.add(`${best.x},${best.y}`);
      return best;
    };
    for (const [wantedX, wantedY] of [[4, 3], [10, 2], [11, 7]]) {
      const spot = findSpot(wantedX, wantedY); if (!spot) continue;
      objects.push({ depth: (spot.y + .5) * T + 17, draw: () => drawBomb(ctx, (spot.x + .5) * T, (spot.y + .5) * T + 4, 1800, time) });
    }
    for (const [wantedX, wantedY, type] of [[5, 7, 'capacity'], [9, 4, 'range'], [7, 1, 'speed']] as const) {
      const spot = findSpot(wantedX, wantedY); if (!spot) continue;
      drawItem(ctx, type, (spot.x + .5) * T, (spot.y + .5) * T, time);
    }
  }
  for (let y = 0; y < 11; y++) for (let x = 0; x < 15; x++) {
    const tile = state.tiles[y]?.[x];
    if (tile === 1) objects.push({ depth: y * T + 47, draw: () => drawBush(ctx, x * T, y * T + 1, map, x * 7 + y * 11) });
    if (tile === 2) objects.push({ depth: y * T + 47, draw: () => drawCrate(ctx, x * T, y * T + 3, map, (x * 3 + y * 5) % 7) });
  }
  for (const bomb of state.bombs) objects.push({ depth: (bomb.y + .5) * T + 17, draw: () => drawBomb(ctx, (bomb.x + .5) * T, (bomb.y + .5) * T + 4, bomb.remaining, time) });
  for (const player of state.players) {
    if (!player.alive) continue;
    const targetX = (player.x + .5) * T, targetY = (player.y + .5) * T;
    let pos = visual.positions.get(player.id);
    if (!pos) { pos = { x: targetX, y: targetY, fromX: targetX, fromY: targetY, toX: targetX, toY: targetY, changedAt: time }; visual.positions.set(player.id, pos); }
    if (pos.toX !== targetX || pos.toY !== targetY) {
      pos.fromX = pos.x; pos.fromY = pos.y; pos.toX = targetX; pos.toY = targetY; pos.changedAt = time;
      // Fresh rounds and network reconnection can relocate a player several tiles.
      if (Math.abs(pos.x - targetX) + Math.abs(pos.y - targetY) > 125) { pos.fromX = targetX; pos.fromY = targetY; }
    }
    const progress = Math.min(1, Math.max(0, (time - pos.changedAt) / Math.max(75, 120 - (player.speed - 1) * 12)));
    const eased = progress * progress * (3 - 2 * progress);
    pos.x = pos.fromX + (pos.toX - pos.fromX) * eased; pos.y = pos.fromY + (pos.toY - pos.fromY) * eased;
    const x = pos.x, y = pos.y;
    objects.push({ depth: y + 20, draw: () => {
      const local = player.id === opts.localId;
      if (local) {
        ctx.save(); ctx.globalAlpha = .45 + Math.sin(time * .003) * .08; ellipse(ctx, x, y + 20, 24, 8, '#ffffffcc', '#4da8a0', 1.3); ctx.restore();
      } else ellipse(ctx, x + 1, y + 21, 21, 6.5, 'rgba(43,99,65,.19)');
      if (player.shield > 0) { ctx.save(); ctx.globalAlpha = .6; ellipse(ctx, x, y + 18, 25, 10, '#d3ffef40', '#e1ffed', 2); ctx.restore(); }
      ctx.save(); if (!opts.preview && player.invulnerable > 0 && Math.floor(time / 110) % 2 === 0) ctx.globalAlpha = .58;
      drawAvatar(ctx, player.character, x, y - 3, 54, time + player.x * 73); ctx.restore();
      if (player.trapped > 0) drawTrap(ctx, x, y - 6, time);
      if (!opts.preview) {
        const text = player.name.length > 7 ? player.name.slice(0, 6) + '…' : player.name;
        ctx.font = '600 11px "Microsoft YaHei",sans-serif'; const w = ctx.measureText(text).width + 14;
        const labelY = y + 32; round(ctx, x - w / 2, labelY - 9, w, 17, 7); ctx.fillStyle = local ? '#467e86dc' : '#527968ae'; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, labelY - .5);
        if (local) { path(ctx, [x - 4, y - 52, x + 4, y - 52, x, y - 46], '#fff', '#4d9e9a', .8); }
      }
    } });
  }
  objects.sort((a, b) => a.depth - b.depth); for (const object of objects) object.draw();
  if (map === 'snow') {
    ctx.save(); ctx.globalAlpha = .8;
    for (let k = 0; k < 30; k++) { const x = (k * 131 + Math.sin(time * .0004 + k) * 10) % 900; const y = (k * 83 + time * .012) % 660; ellipse(ctx, x, y, k % 3 ? 1.5 : 2.5, k % 3 ? 1.5 : 2.5, '#fff'); } ctx.restore();
  }
  const shade = ctx.createLinearGradient(0, 0, 0, 660); shade.addColorStop(0, '#164b4012'); shade.addColorStop(.12, '#164b4000'); shade.addColorStop(.88, '#164b4000'); shade.addColorStop(1, '#164b4012'); ctx.fillStyle = shade; ctx.fillRect(0, 0, 900, 660);
  ctx.restore();
}

/** Miniature map card art, also useful before a game exists. */
export function drawMapPreview(ctx: CanvasRenderingContext2D, map: string, width: number, height: number): void {
  const name: MapName = map === 'forest' || map === 'snow' ? map : 'candy'; const p = palettes[name];
  ctx.save(); ctx.clearRect(0, 0, width, height); ctx.fillStyle = p.ground[0]; ctx.fillRect(0, 0, width, height);
  const scale = Math.max(width / 300, height / 180); ctx.translate((width - 300 * scale) / 2, (height - 180 * scale) / 2); ctx.scale(scale, scale);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) { ctx.fillStyle = p.ground[(x + y) % 2]; ctx.fillRect(x * T, y * T, T, T); }
  drawBush(ctx, 0, 2, name, 6); drawBush(ctx, 120, 2, name, 4); drawBush(ctx, 240, 2, name, 6); drawCrate(ctx, 60, 4, name, 1); drawCrate(ctx, 180, 64, name, 0); drawBush(ctx, 0, 122, name, 4); drawBush(ctx, 240, 122, name, 2); drawCrate(ctx, 60, 124, name, 2);
  ellipse(ctx, 145, 120, 19, 5, '#35664c33'); drawAvatar(ctx, name === 'snow' ? 'blue' : name === 'forest' ? 'mint' : 'pink', 145, 96, 57, 0); drawBomb(ctx, 240, 96, 2100, 0);
  ctx.restore();
}
