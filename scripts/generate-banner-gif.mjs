import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// Animated banner generator for GitHub profile README.
// Output: assets/banner.gif (1200x300)
//
// Theme aggregate:
// - Greco-Roman: marble slab + laurel ring + gold accents
// - Tactical: subtle HUD grid + reticle lock
// - Mythic/forge: sparks + specular sweep
// - Ownership: embedded text "Calvin Kennedy (@45ck)"

const W = 1200;
const H = 300;
const FPS = 15;
const SECONDS = 3;
const FRAMES = FPS * SECONDS;

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rgb(r, g, b) {
  return { r, g, b };
}

function lerpColor(a, b, t) {
  return rgb(
    Math.round(lerp(a.r, b.r, t)),
    Math.round(lerp(a.g, b.g, t)),
    Math.round(lerp(a.b, b.b, t))
  );
}

function setPixel(buf, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

function blendPixel(buf, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  const ia = clamp01(a);
  buf[i] = Math.round(buf[i] * (1 - ia) + r * ia);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - ia) + g * ia);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - ia) + b * ia);
}

function drawLine(buf, x0, y0, x1, y1, color, thickness = 2) {
  // Bresenham + simple thickness.
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    for (let oy = -thickness; oy <= thickness; oy++) {
      for (let ox = -thickness; ox <= thickness; ox++) {
        const dist = Math.abs(ox) + Math.abs(oy);
        const a = dist === 0 ? 1 : dist === 1 ? 0.65 : dist === 2 ? 0.28 : 0.12;
        blendPixel(buf, x0 + ox, y0 + oy, color.r, color.g, color.b, a);
      }
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function drawRect(buf, x, y, w, h, color, a = 1) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W - 1, Math.ceil(x + w));
  const y1 = Math.min(H - 1, Math.ceil(y + h));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      blendPixel(buf, xx, yy, color.r, color.g, color.b, a);
    }
  }
}

function drawCircle(buf, cx, cy, r, color, thickness = 2) {
  const steps = Math.max(72, Math.round(r * 0.9));
  let px = cx + r;
  let py = cy;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    drawLine(buf, px, py, x, y, color, thickness);
    px = x;
    py = y;
  }
}

function rotX(v, a) {
  const s = Math.sin(a);
  const c = Math.cos(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}
function rotY(v, a) {
  const s = Math.sin(a);
  const c = Math.cos(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}
function rotZ(v, a) {
  const s = Math.sin(a);
  const c = Math.cos(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
}

function project(v, centerX, centerY, scale, zBias) {
  const z = v.z + zBias;
  const p = 1 / z;
  return {
    x: centerX + v.x * scale * p,
    y: centerY + v.y * scale * p,
    z,
  };
}

function drawWireObject(buf, verts, edges, opts) {
  const { centerX, centerY, scale, zBias, rot, colorA, colorB } = opts;

  const transformed = verts.map((v) => {
    let p = v;
    p = rotX(p, rot.x);
    p = rotY(p, rot.y);
    p = rotZ(p, rot.z);
    return project(p, centerX, centerY, scale, zBias);
  });

  for (const [a, b] of edges) {
    const va = transformed[a];
    const vb = transformed[b];
    const depth = clamp01(1 - (va.z + vb.z) * 0.10);
    const col = lerpColor(colorA, colorB, depth);
    drawLine(buf, va.x, va.y, vb.x, vb.y, col, 2);
  }
}

function marbleField(u, v, t) {
  const w1 = Math.sin((u * 6.5 + v * 2.9) * Math.PI + t * 1.2);
  const w2 = Math.sin((u * 12.0 - v * 5.0) * Math.PI + t * 0.8);
  const w3 = Math.cos((u * 4.8 + v * 10.0) * Math.PI - t * 0.7);
  const veins = Math.sin((u * 9.0 + w2 * 0.32 + t * 0.18) * Math.PI);
  return w1 * 0.35 + w2 * 0.22 + w3 * 0.16 + veins * 0.27;
}

function backgroundAggregate(buf, t) {
  // Tactical night base.
  const c0 = rgb(7, 10, 18);
  const c1 = rgb(12, 26, 34);
  const c2 = rgb(18, 14, 30);

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const a = v < 0.5 ? v / 0.5 : (v - 0.5) / 0.5;
    const top = lerpColor(c0, c1, a);
    const bot = lerpColor(c1, c2, a);
    const mix = v < 0.5 ? top : bot;
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const n = Math.sin((u * 10 + t * 2.0) * Math.PI) * Math.cos((v * 7 - t * 1.2) * Math.PI);
      const nn = Math.round(n * 4);
      setPixel(
        buf,
        x,
        y,
        Math.max(0, Math.min(255, mix.r + nn)),
        Math.max(0, Math.min(255, mix.g + nn)),
        Math.max(0, Math.min(255, mix.b + nn))
      );
    }
  }

  // Greco-Roman marble slab panel (nameplate zone).
  const slabX = 70;
  const slabY = 62;
  const slabW = W - 140;
  const slabH = 178;
  drawRect(buf, slabX + 4, slabY + 6, slabW, slabH, rgb(110, 116, 128), 0.22);
  drawRect(buf, slabX, slabY, slabW, slabH, rgb(202, 206, 212), 0.11);

  for (let y = slabY; y < slabY + slabH; y++) {
    const vv = (y - slabY) / (slabH - 1);
    for (let x = slabX; x < slabX + slabW; x++) {
      const uu = (x - slabX) / (slabW - 1);
      const m = marbleField(uu, vv, t);
      const shade = Math.round(m * 18);
      blendPixel(buf, x, y, 220 + shade, 224 + shade, 230 + shade, 0.045);
      const vein = clamp01((Math.abs(m) - 0.58) / 0.42);
      if (vein > 0) blendPixel(buf, x, y, 78, 84, 94, vein * 0.06);
    }
  }

  drawRect(buf, slabX, slabY, slabW, 2, rgb(235, 238, 242), 0.25);
  drawRect(buf, slabX, slabY + slabH - 2, slabW, 2, rgb(90, 96, 108), 0.18);

  // Gold trim line.
  const goldA = rgb(201, 168, 95);
  const goldB = rgb(245, 226, 168);
  const trimY = slabY + slabH - 18;
  for (let x = slabX + 22; x < slabX + slabW - 22; x++) {
    const u = (x - (slabX + 22)) / (slabW - 44);
    const col = lerpColor(goldA, goldB, u);
    blendPixel(buf, x, trimY, col.r, col.g, col.b, 0.52);
    blendPixel(buf, x, trimY + 1, col.r, col.g, col.b, 0.22);
  }

  // Tactical HUD grid.
  const gridCol = rgb(148, 163, 184);
  for (let x = 0; x < W; x += 80) {
    for (let y = 0; y < H; y++) blendPixel(buf, x, y, gridCol.r, gridCol.g, gridCol.b, 0.016);
  }
  for (let y = 0; y < H; y += 60) {
    for (let x = 0; x < W; x++) blendPixel(buf, x, y, gridCol.r, gridCol.g, gridCol.b, 0.016);
  }

  // Reticle lock.
  const rx = Math.round(W * 0.84);
  const ry = Math.round(H * 0.33);
  const retCol = rgb(34, 197, 94);
  drawCircle(buf, rx, ry, 26, retCol, 2);
  drawLine(buf, rx - 40, ry, rx - 12, ry, retCol, 2);
  drawLine(buf, rx + 12, ry, rx + 40, ry, retCol, 2);
  drawLine(buf, rx, ry - 40, rx, ry - 12, retCol, 2);
  drawLine(buf, rx, ry + 12, rx, ry + 40, retCol, 2);

  // Specular sweep across slab.
  const sweepX = slabX + ((t * 1.15) % 1) * (slabW + 220) - 220;
  for (let y = slabY; y < slabY + slabH; y++) {
    const vv = (y - slabY) / (slabH - 1);
    for (let x = Math.max(slabX, Math.floor(sweepX)); x < Math.min(slabX + slabW, Math.floor(sweepX + 160)); x++) {
      const dx = (x - sweepX) / 160;
      const falloff = Math.exp(-Math.pow((dx - 0.5) * 2.2, 2));
      const a = falloff * 0.028 * (0.75 + vv * 0.25);
      blendPixel(buf, x, y, 255, 255, 255, a);
    }
  }

  // Forge sparks.
  const sparkBaseX = slabX + 110;
  const sparkBaseY = slabY + slabH - 26;
  for (let i = 0; i < 26; i++) {
    const ph = (i / 26) * Math.PI * 2;
    const life = (t + i * 0.075) % 1;
    const x = sparkBaseX + Math.sin(ph) * 16 + life * 150;
    const y = sparkBaseY - life * 110 - Math.cos(ph) * 10;
    const a = (1 - life) * 0.20;
    const col = lerpColor(rgb(255, 153, 51), rgb(255, 230, 170), 1 - life);
    blendPixel(buf, Math.round(x), Math.round(y), col.r, col.g, col.b, a);
    blendPixel(buf, Math.round(x) + 1, Math.round(y), col.r, col.g, col.b, a * 0.5);
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function main() {
  const repoRoot = process.cwd();
  const outGif = path.join(repoRoot, 'assets', 'banner.gif');
  const tmpDir = path.join(os.tmpdir(), `45ck-banner-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  // Simple "3D" primitives (wireframe).
  const cubeVerts = [
    { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 },  { x: 1, y: -1, z: 1 },  { x: 1, y: 1, z: 1 },  { x: -1, y: 1, z: 1 },
  ];
  const cubeEdges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  const octVerts = [
    { x: 0, y: 0, z: 1.6 }, { x: 0, y: 0, z: -1.6 }, { x: 1.6, y: 0, z: 0 },
    { x: -1.6, y: 0, z: 0 }, { x: 0, y: 1.6, z: 0 }, { x: 0, y: -1.6, z: 0 },
  ];
  const octEdges = [
    [0, 2], [0, 3], [0, 4], [0, 5],
    [1, 2], [1, 3], [1, 4], [1, 5],
    [2, 4], [4, 3], [3, 5], [5, 2],
  ];

  for (let f = 0; f < FRAMES; f++) {
    const t = f / FRAMES;
    const buf = Buffer.alloc(W * H * 3);

    backgroundAggregate(buf, t);

    const baseRot = {
      x: t * Math.PI * 2 * 0.55,
      y: t * Math.PI * 2 * 1.0,
      z: t * Math.PI * 2 * 0.20,
    };

    // Left wire object: "artifact" (gold->cyan).
    drawWireObject(buf, cubeVerts, cubeEdges, {
      centerX: W * 0.29,
      centerY: H * 0.50,
      scale: 420,
      zBias: 4.2,
      rot: baseRot,
      colorA: rgb(245, 226, 168),
      colorB: rgb(6, 182, 212),
    });

    // Right wire object: "ops core" (green->cyan).
    drawWireObject(buf, octVerts, octEdges, {
      centerX: W * 0.77,
      centerY: H * 0.54,
      scale: 392,
      zBias: 4.0,
      rot: { x: -baseRot.y * 0.7, y: baseRot.x * 1.08, z: baseRot.z * 0.45 },
      colorA: rgb(34, 197, 94),
      colorB: rgb(6, 182, 212),
    });

    // Laurel ring (Greco-Roman).
    const laurelCx = W * 0.52;
    const laurelCy = H * 0.50;
    drawCircle(buf, laurelCx, laurelCy, 74, rgb(201, 168, 95), 2);
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + t * 0.22;
      const r0 = 74;
      const r1 = 82;
      const x0 = laurelCx + Math.cos(ang) * r0;
      const y0 = laurelCy + Math.sin(ang) * r0;
      const x1 = laurelCx + Math.cos(ang) * r1;
      const y1 = laurelCy + Math.sin(ang) * r1;
      drawLine(buf, x0, y0, x1, y1, rgb(245, 226, 168), 2);
    }

    // Write PPM (P6).
    const header = Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii');
    const out = Buffer.concat([header, buf]);
    const fname = path.join(tmpDir, `frame${String(f).padStart(3, '0')}.ppm`);
    await writeFile(fname, out);
  }

  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });

  // Embed ownership in the animation at encode-time and palette-optimize.
  // Note: keep text simple to avoid escaping issues in ffmpeg filters.
  const draw = [
    `drawtext=fontfile=${FONT}:text='Calvin Kennedy':x=120:y=112:fontsize=50:fontcolor=white@0.96:shadowcolor=black@0.35:shadowx=2:shadowy=2`,
    `drawtext=fontfile=${FONT}:text='@45ck  AI  Product Engineering':x=122:y=165:fontsize=22:fontcolor=white@0.75:shadowcolor=black@0.30:shadowx=2:shadowy=2`,
    `drawtext=fontfile=${FONT}:text='vibecord.dev':x=w-250:y=h-40:fontsize=18:fontcolor=0xFFE6AA@0.55:shadowcolor=black@0.25:shadowx=1:shadowy=1`,
  ].join(',');

  await run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-framerate', String(FPS),
    '-i', path.join(tmpDir, 'frame%03d.ppm'),
    '-vf',
    `fps=${FPS},scale=1200:300:flags=lanczos,${draw},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
    outGif,
  ]);

  await rm(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
