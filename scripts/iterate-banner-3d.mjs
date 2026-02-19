import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

function runWithTimeout({ cmd, args, opts = {}, timeoutMs = 0, inherit = false }) {
  return new Promise((resolve, reject) => {
    const stdio = inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'];
    const p = spawn(cmd, args, { ...opts, stdio });

    let out = '';
    let err = '';
    if (!inherit) {
      p.stdout.on('data', (d) => (out += d.toString('utf8')));
      p.stderr.on('data', (d) => (err += d.toString('utf8')));
    }

    let to = null;
    if (timeoutMs > 0) {
      to = setTimeout(() => {
        try {
          p.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      to.unref?.();
    }

    p.on('error', (e) => {
      if (to) clearTimeout(to);
      reject(e);
    });
    p.on('close', (code) => {
      if (to) clearTimeout(to);
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} exited with code ${code}${err ? `\n${err}` : ''}`));
    });
  });
}

function runCapture(cmd, args, opts = {}) {
  return runWithTimeout({ cmd, args, opts, timeoutMs: opts.timeoutMs ?? 0, inherit: false });
}

function runInherit(cmd, args, opts = {}) {
  return runWithTimeout({ cmd, args, opts, timeoutMs: opts.timeoutMs ?? 0, inherit: true }).then(() => {});
}

function variant(preset, name, patch) {
  return {
    slug: `${preset}-${name}`,
    params: {
      preset,
      ...patch,
    },
  };
}

async function signalScore(pngPath) {
  // signalstats writes frame metadata; metadata=print emits key/value lines we can parse.
  // We score a cropped "title zone" (left/middle) so brightness is measured where the name lives.
  const { out, err } = await runCapture('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', pngPath,
    '-vf', 'crop=iw*0.78:ih*0.62:iw*0.10:ih*0.18,signalstats,metadata=print:file=-',
    '-f', 'null',
    '-',
  ], { timeoutMs: 30000 });

  const text = `${out}\n${err}`;
  const yMinM = text.match(/lavfi\.signalstats\.YMIN=(\d+(?:\.\d+)?)/);
  const yMaxM = text.match(/lavfi\.signalstats\.YMAX=(\d+(?:\.\d+)?)/);
  const yAvgM = text.match(/lavfi\.signalstats\.YAVG=(\d+(?:\.\d+)?)/);
  if (!yMinM || !yMaxM || !yAvgM) return { score: -999, stats: null };

  const yMin = Number(yMinM[1]) / 255;
  const yMax = Number(yMaxM[1]) / 255;
  const yAvg = Number(yAvgM[1]) / 255;

  // Heuristic: avoid blown highlights/too dark; aim for readable midtone banner.
  const target = 0.42;
  let score = 0;
  score -= Math.abs(yAvg - target) * 3.0;
  if (yMax > 0.985) score -= (yMax - 0.985) * 18;
  if (yMin < 0.02) score -= (0.02 - yMin) * 10;
  // Prefer a bit of dynamic range.
  score += Math.min(0.35, Math.max(0, yMax - yMin)) * 2.0;

  return { score, stats: { yMin, yMax, yAvg } };
}

function makeHtml({ title, items }) {
  const cards = items
    .map((it) => {
      const stats = it.stats
        ? `Yavg ${(it.stats.yAvg * 100).toFixed(1)}% | Ymin ${(it.stats.yMin * 100).toFixed(1)}% | Ymax ${(it.stats.yMax * 100).toFixed(1)}% | score ${it.score.toFixed(3)}`
        : `score ${it.score.toFixed(3)}`;
      return `
        <article class="card">
          <header>
            <div class="slug">${it.slug}</div>
            <div class="meta">${stats}</div>
          </header>
          <img loading="lazy" src="./previews/${it.slug}.gif" alt="${it.slug} animation" />
          <details>
            <summary>still + params</summary>
            <img loading="lazy" src="./previews/${it.slug}.still.png" alt="${it.slug} still" />
            <pre>${escapeHtml(JSON.stringify(it.params, null, 2))}</pre>
          </details>
        </article>
      `;
    })
    .join('\n');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #070a12; color: #e5e7eb; }
      header.top { padding: 18px 22px; position: sticky; top: 0; background: rgba(7,10,18,0.85); backdrop-filter: blur(10px); border-bottom: 1px solid rgba(255,255,255,0.08); }
      header.top h1 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: 0.2px; }
      header.top .hint { margin-top: 6px; font-size: 13px; color: rgba(229,231,235,0.72); }
      main { padding: 18px 22px 50px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 18px; align-items: start; }
      .card { border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; background: rgba(255,255,255,0.03); overflow: hidden; }
      .card header { padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      .slug { font-weight: 800; font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; }
      .meta { margin-top: 6px; font-size: 12px; color: rgba(229,231,235,0.70); }
      img { display:block; width: 100%; height: auto; background: #05070d; }
      details { padding: 10px 14px 14px; }
      summary { cursor: pointer; font-size: 12px; color: rgba(229,231,235,0.78); }
      details img { margin-top: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); }
      pre { margin: 10px 0 0; font-size: 12px; white-space: pre-wrap; word-break: break-word; color: rgba(229,231,235,0.88); }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .best { outline: 2px solid rgba(125, 211, 252, 0.75); box-shadow: 0 0 0 6px rgba(125, 211, 252, 0.08); }
    </style>
  </head>
  <body>
    <header class="top">
      <h1>${escapeHtml(title)}</h1>
      <div class="hint">Each preview is a short animated GIF loop. Open a card for a still + the exact params used. Best-scored variant is highlighted.</div>
    </header>
    <main>
      <section class="grid">
        ${cards}
      </section>
    </main>
    <script>
      const best = ${JSON.stringify(items.reduce((a, b) => (b.score > a.score ? b : a), items[0])?.slug ?? '')};
      if (best) {
        const el = Array.from(document.querySelectorAll('.card')).find((c) => c.querySelector('.slug')?.textContent?.trim() === best);
        if (el) el.classList.add('best');
      }
    </script>
  </body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function main() {
  const repoRoot = process.cwd();
  const outRoot = path.join(repoRoot, 'tmp', `banner-iterate-${Date.now()}`);
  const previewsDir = path.join(outRoot, 'previews');
  await mkdir(previewsDir, { recursive: true });

  // 3 styles (greco/military/hybrid) + small "halo flight" variations.
  // Keep changes within the current scene schema (cam/halo/target/text/core/hud/ship).
  const variants = [
    variant('greco', 'tight', { cam: { r: 6.0, sweep: 0.62, lift: 0.58, bob: 0.06, roll: 0.012 }, halo: { x: -0.38, y: 0.20, rx: 1.00, ry: 0.20, spin: 0.09, wobble: 0.018 }, text: { pull: 1.45, lift: 0.12, faceBias: 0.05, size: 0.50, depth: 0.105 }, core: { x: 3.2, y: 0.86, z: -2.6, size: 0.56 } }),
    variant('greco', 'wide',  { cam: { r: 6.6, sweep: 0.74, lift: 0.62, bob: 0.07, roll: 0.014 }, halo: { x: -0.30, y: 0.18, rx: 0.96, ry: 0.24, spin: 0.10, wobble: 0.020 }, text: { pull: 1.55, lift: 0.12, faceBias: 0.05, size: 0.50, depth: 0.105 }, core: { x: 3.4, y: 0.92, z: -2.8, size: 0.54 } }),

    variant('military', 'tight', { cam: { r: 6.1, sweep: 0.58, lift: 0.56, bob: 0.06, roll: 0.012 }, halo: { x: -0.34, y: 0.19, rx: 1.05, ry: 0.12, spin: 0.12, wobble: 0.018 }, text: { pull: 1.50, lift: 0.12, faceBias: 0.06, size: 0.48, depth: 0.110 }, core: { x: 3.6, y: 0.98, z: -3.1, size: 0.50 } }),
    variant('military', 'wide',  { cam: { r: 6.8, sweep: 0.70, lift: 0.62, bob: 0.07, roll: 0.014 }, halo: { x: -0.26, y: 0.17, rx: 1.02, ry: 0.10, spin: 0.12, wobble: 0.020 }, text: { pull: 1.60, lift: 0.12, faceBias: 0.06, size: 0.48, depth: 0.110 }, core: { x: 3.7, y: 1.00, z: -3.2, size: 0.48 } }),

    variant('hybrid', 'tight', { cam: { r: 6.2, sweep: 0.62, lift: 0.58, bob: 0.06, roll: 0.012 }, halo: { x: -0.34, y: 0.19, rx: 1.02, ry: 0.16, spin: 0.10, wobble: 0.018 }, text: { pull: 1.52, lift: 0.12, faceBias: 0.05, size: 0.49, depth: 0.108 }, core: { x: 3.5, y: 0.95, z: -3.0, size: 0.52 } }),
    variant('hybrid', 'wide',  { cam: { r: 6.7, sweep: 0.72, lift: 0.62, bob: 0.07, roll: 0.014 }, halo: { x: -0.28, y: 0.18, rx: 0.98, ry: 0.18, spin: 0.11, wobble: 0.020 }, text: { pull: 1.62, lift: 0.12, faceBias: 0.05, size: 0.49, depth: 0.108 }, core: { x: 3.6, y: 0.98, z: -3.1, size: 0.50 } }),
  ];

  const items = [];
  for (const v of variants) {
    const outStill = path.join(previewsDir, `${v.slug}.still.png`);
    const outGif = path.join(previewsDir, `${v.slug}.gif`);

    await runInherit('node', [
      path.join(repoRoot, 'scripts', 'render-banner-3d.mjs'),
      '--mode', 'still',
      '--quality', 'preview',
      '--t', '0.22',
      '--out', outStill,
      '--params', JSON.stringify(v.params),
    ], { cwd: repoRoot, timeoutMs: 180000 });

    await runInherit('node', [
      path.join(repoRoot, 'scripts', 'render-banner-3d.mjs'),
      '--mode', 'gif',
      '--quality', 'preview',
      '--width', '800',
      '--height', '200',
      '--scale', '1',
      '--out', outGif,
      '--params', JSON.stringify(v.params),
    ], { cwd: repoRoot, timeoutMs: 300000 });

    const { score, stats } = await signalScore(outStill);
    items.push({ slug: v.slug, params: v.params, score, stats });
  }

  items.sort((a, b) => b.score - a.score);
  const best = items[0];

  // Emit a local gallery for quick comparison.
  const htmlPath = path.join(outRoot, 'index.html');
  await writeFile(htmlPath, makeHtml({ title: 'Banner Iteration Gallery', items }), 'utf8');

  // Render the best candidate to the real banner.gif.
  await runInherit('node', [
    path.join(repoRoot, 'scripts', 'render-banner-3d.mjs'),
    '--mode', 'gif',
    '--out', path.join(repoRoot, 'assets', 'banner.gif'),
    '--params', JSON.stringify(best.params),
  ], { cwd: repoRoot, timeoutMs: 300000 });

  // Persist the chosen params (so `npm run banner:render` is stable).
  await writeFile(path.join(repoRoot, 'assets', 'banner.params.json'), JSON.stringify(best.params, null, 2) + '\n', 'utf8');

  // Print paths for humans running this directly.
  process.stdout.write(`\nGallery: ${htmlPath}\nBest: ${best.slug}\n\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
