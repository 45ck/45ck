import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const W = 1200;
const H = 300;
const FPS = 15;
const SECONDS = 3;
const FRAMES = FPS * SECONDS;

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
        const a = dist === 0 ? 1 : dist === 1 ? 0.7 : dist === 2 ? 0.35 : 0.15;
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

function background(buf, t) {
  const c0 = rgb(11, 16, 32);
  const c1 = rgb(15, 42, 58);
  const c2 = rgb(26, 17, 51);

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const a = v < 0.5 ? v / 0.5 : (v - 0.5) / 0.5;
    const top = lerpColor(c0, c1, a);
    const bot = lerpColor(c1, c2, a);
    const mix = v < 0.5 ? top : bot;
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // Cheap animated dithering/noise pattern (stable, no RNG).
      const n = Math.sin((u * 12 + t * 2.0) * Math.PI) * Math.cos((v * 8 - t * 1.4) * Math.PI);
      const nn = Math.round(n * 8); // [-8..8]
      const r = Math.max(0, Math.min(255, mix.r + nn));
      const g = Math.max(0, Math.min(255, mix.g + nn));
      const b = Math.max(0, Math.min(255, mix.b + nn));
      setPixel(buf, x, y, r, g, b);
    }
  }

  // Accent scanline.
  const y0 = Math.round(H * 0.70);
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1);
    const col = lerpColor(rgb(34, 197, 94), rgb(167, 139, 250), u);
    for (let dy = -2; dy <= 2; dy++) {
      blendPixel(buf, x, y0 + dy, col.r, col.g, col.b, dy === 0 ? 0.8 : 0.25);
    }
  }
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
    // Color by depth: closer = more accent.
    const depth = clamp01(1 - (va.z + vb.z) * 0.10);
    const col = lerpColor(colorA, colorB, depth);
    drawLine(buf, va.x, va.y, vb.x, vb.y, col, 2);
  }
}

async function main() {
  const repoRoot = process.cwd();
  const outGif = path.join(repoRoot, 'assets', 'banner.gif');

  const tmpDir = path.join(os.tmpdir(), `45ck-banner-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  const cubeVerts = [
    { x: -1, y: -1, z: -1 },
    { x: 1, y: -1, z: -1 },
    { x: 1, y: 1, z: -1 },
    { x: -1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 },
    { x: 1, y: -1, z: 1 },
    { x: 1, y: 1, z: 1 },
    { x: -1, y: 1, z: 1 },
  ];

  const cubeEdges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  const octVerts = [
    { x: 0, y: 0, z: 1.6 },
    { x: 0, y: 0, z: -1.6 },
    { x: 1.6, y: 0, z: 0 },
    { x: -1.6, y: 0, z: 0 },
    { x: 0, y: 1.6, z: 0 },
    { x: 0, y: -1.6, z: 0 },
  ];

  const octEdges = [
    [0, 2], [0, 3], [0, 4], [0, 5],
    [1, 2], [1, 3], [1, 4], [1, 5],
    [2, 4], [4, 3], [3, 5], [5, 2],
  ];

  for (let f = 0; f < FRAMES; f++) {
    const t = f / FRAMES;
    const buf = Buffer.alloc(W * H * 3);

    background(buf, t);

    const baseRot = {
      x: t * Math.PI * 2 * 0.6,
      y: t * Math.PI * 2 * 1.0,
      z: t * Math.PI * 2 * 0.25,
    };

    drawWireObject(buf, cubeVerts, cubeEdges, {
      centerX: W * 0.32,
      centerY: H * 0.42,
      scale: 460,
      zBias: 4.2,
      rot: baseRot,
      colorA: rgb(6, 182, 212),
      colorB: rgb(167, 139, 250),
    });

    drawWireObject(buf, octVerts, octEdges, {
      centerX: W * 0.72,
      centerY: H * 0.46,
      scale: 420,
      zBias: 4.0,
      rot: { x: -baseRot.y * 0.7, y: baseRot.x * 1.1, z: baseRot.z * 0.4 },
      colorA: rgb(34, 197, 94),
      colorB: rgb(6, 182, 212),
    });

    // Write PPM (P6).
    const header = Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii');
    const out = Buffer.concat([header, buf]);
    const fname = path.join(tmpDir, `frame${String(f).padStart(3, '0')}.ppm`);
    await writeFile(fname, out);
  }

  // Encode GIF (palette optimized).
  await mkdir(path.join(repoRoot, 'assets'), { recursive: true });

  await run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-framerate', String(FPS),
    '-i', path.join(tmpDir, 'frame%03d.ppm'),
    '-vf',
    `fps=${FPS},scale=1200:300:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
    outGif,
  ]);

  await rm(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
