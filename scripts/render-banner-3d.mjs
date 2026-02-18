import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const W = 1200;
const H = 300;
const INTERNAL_SCALE = 2;
const IW = W * INTERNAL_SCALE;
const IH = H * INTERNAL_SCALE;
const FPS = 24;
const SECONDS = 3;
const FRAMES = FPS * SECONDS;

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

function html() {
  // Uses ES module imports from CDN so we only need puppeteer locally.
  // Renders at 2x and downsamples to reduce aliasing and make it feel more "premium".
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>banner</title>
    <style>
      html, body { margin:0; padding:0; background:#070a12; overflow:hidden; }
      canvas { display:block; }
    </style>
  </head>
  <body>
    <script type="module">
      import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

      const W = ${IW}, H = ${IH};

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true
      });
      renderer.setSize(W, H, false);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.autoClear = false;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      document.body.appendChild(renderer.domElement);

      // Simple environment to make metals/glass look like real materials (no external HDR needed).
      const envCanvas = document.createElement('canvas');
      envCanvas.width = 512;
      envCanvas.height = 256;
      const ectx = envCanvas.getContext('2d');
      const grad = ectx.createLinearGradient(0, 0, 0, envCanvas.height);
      grad.addColorStop(0.0, '#0b1020');
      grad.addColorStop(0.45, '#0f2a3a');
      grad.addColorStop(1.0, '#1a1133');
      ectx.fillStyle = grad;
      ectx.fillRect(0, 0, envCanvas.width, envCanvas.height);
      // A bright "studio strip" to produce a nice spec highlight.
      ectx.globalAlpha = 0.55;
      ectx.fillStyle = '#c7f9ff';
      ectx.fillRect(0, 28, envCanvas.width, 18);
      ectx.globalAlpha = 0.35;
      ectx.fillRect(0, 62, envCanvas.width, 10);
      ectx.globalAlpha = 1;

      const envTex = new THREE.CanvasTexture(envCanvas);
      envTex.colorSpace = THREE.SRGBColorSpace;
      envTex.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envRT = pmrem.fromEquirectangular(envTex);
      pmrem.dispose();
      envTex.dispose();

      // Fullscreen background pass (prevents "letterboxed" look).
      const bgScene = new THREE.Scene();
      const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const bgMat = new THREE.ShaderMaterial({
        uniforms: { t: { value: 0 } },
        vertexShader: \`
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
        \`,
        fragmentShader: \`
          varying vec2 vUv;
          uniform float t;
          vec3 c0 = vec3(0.03,0.04,0.075);
          vec3 c1 = vec3(0.05,0.13,0.17);
          vec3 c2 = vec3(0.10,0.07,0.18);
          void main(){
            float v = vUv.y;
            vec3 col = mix(c0,c1,smoothstep(0.0,0.70,v));
            col = mix(col,c2,smoothstep(0.58,1.0,v));
            // vignette
            vec2 d = vUv - 0.5;
            col *= 1.0 - 0.28*dot(d,d);
            // very subtle moving highlight (kept low-frequency to avoid GIF dithering artifacts)
            float sweep = smoothstep(0.0, 1.0, 1.0 - abs((vUv.x + t*0.22) - 0.65) * 3.2);
            col += sweep * 0.02;
            gl_FragColor = vec4(col, 1.0);
          }
        \`
      });
      bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), bgMat));

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog('#070a12', 11, 26);
      scene.environment = envRT.texture;

      const camera = new THREE.PerspectiveCamera(32, W/H, 0.1, 100);
      camera.position.set(0.0, 0.72, 7.6);

      // Lights
      const key = new THREE.DirectionalLight('#ffffff', 2.0);
      key.position.set(3, 4, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 20;
      key.shadow.camera.left = -6;
      key.shadow.camera.right = 6;
      key.shadow.camera.top = 4;
      key.shadow.camera.bottom = -4;
      scene.add(key);
      const fill = new THREE.DirectionalLight('#a7f3d0', 0.48);
      fill.position.set(-4, 1, 3);
      scene.add(fill);
      const rim = new THREE.DirectionalLight('#93c5fd', 0.72);
      rim.position.set(-1, 3, -5);
      scene.add(rim);
      scene.add(new THREE.AmbientLight('#ffffff', 0.20));

      // Contact shadow plane.
      const shadowPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 8),
        new THREE.ShadowMaterial({ opacity: 0.22 })
      );
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.position.set(0, -1.25, 0);
      shadowPlane.receiveShadow = true;
      scene.add(shadowPlane);

      // Marble texture (canvas). We draw veins as curves for a more realistic look
      // and fewer GIF-hostile high-frequency patterns.
      function prng(seed) {
        let s = seed >>> 0;
        return () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 4294967296;
        };
      }

      function makeMarbleCanvas(size) {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');

        // Base.
        ctx.fillStyle = '#eff1f4';
        ctx.fillRect(0, 0, size, size);

        // Soft cloudy variation.
        const img = ctx.getImageData(0, 0, size, size);
        const rnd = prng(1234);
        for (let i = 0; i < img.data.length; i += 4) {
          const n = (rnd() - 0.5) * 10; // [-5..5]
          img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
          img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
          img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
        }
        ctx.putImageData(img, 0, 0);

        // Primary veins.
        ctx.globalCompositeOperation = 'multiply';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.filter = 'blur(0.6px)';

        const veinRnd = prng(98765);
        for (let v = 0; v < 14; v++) {
          const x0 = veinRnd() * size;
          const y0 = veinRnd() * size;
          const dx = (veinRnd() * 2 - 1) * size * 0.9;
          const dy = (veinRnd() * 2 - 1) * size * 0.5;

          ctx.beginPath();
          ctx.moveTo(x0, y0);
          const steps = 6 + Math.floor(veinRnd() * 6);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = x0 + dx * t + Math.sin((t + v) * 6.0) * size * 0.02;
            const y = y0 + dy * t + Math.cos((t + v) * 5.0) * size * 0.02;
            ctx.quadraticCurveTo(
              x + Math.sin(t * 12.0) * size * 0.01,
              y + Math.cos(t * 11.0) * size * 0.01,
              x,
              y
            );
          }

          const alpha = 0.10 + veinRnd() * 0.10;
          ctx.strokeStyle = 'rgba(120, 130, 150, ' + alpha + ')';
          ctx.lineWidth = 1.0 + veinRnd() * 2.8;
          ctx.stroke();
        }

        // Fine secondary veins.
        ctx.filter = 'blur(0.35px)';
        for (let v = 0; v < 22; v++) {
          const x0 = veinRnd() * size;
          const y0 = veinRnd() * size;
          const dx = (veinRnd() * 2 - 1) * size * 0.55;
          const dy = (veinRnd() * 2 - 1) * size * 0.35;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.bezierCurveTo(
            x0 + dx * 0.35,
            y0 + dy * 0.15,
            x0 + dx * 0.65,
            y0 + dy * 0.85,
            x0 + dx,
            y0 + dy
          );
          ctx.strokeStyle = 'rgba(160, 168, 182, ' + (0.10 + veinRnd() * 0.08) + ')';
          ctx.lineWidth = 0.7 + veinRnd() * 1.6;
          ctx.stroke();
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'blur(1.1px)';
        ctx.globalAlpha = 0.85;
        ctx.drawImage(c, 0, 0);
        ctx.globalAlpha = 1;
        ctx.filter = 'none';

        return c;
      }

      const marbleCanvas = makeMarbleCanvas(1024);
      const marbleTex = new THREE.CanvasTexture(marbleCanvas);
      marbleTex.colorSpace = THREE.SRGBColorSpace;
      marbleTex.wrapS = THREE.RepeatWrapping;
      marbleTex.wrapT = THREE.RepeatWrapping;
      marbleTex.repeat.set(1.2, 1.0);
      marbleTex.anisotropy = 16;

      const marbleMat = new THREE.MeshStandardMaterial({
        map: marbleTex,
        color: '#ffffff',
        metalness: 0.0,
        roughness: 0.55,
      });

      const pedestal = new THREE.Group();
      // Main plaque (smaller, more negative space around it).
      const slab = new THREE.Mesh(new THREE.BoxGeometry(6.9, 1.40, 2.25), marbleMat);
      slab.position.set(0.25, -0.20, -0.15);
      slab.castShadow = true;
      slab.receiveShadow = true;
      pedestal.add(slab);

      const bevel = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.16, 2.35), new THREE.MeshStandardMaterial({
        color: '#d8dbe0', metalness: 0.05, roughness: 0.55
      }));
      bevel.position.set(0.25, 0.56, -0.15);
      bevel.castShadow = true;
      bevel.receiveShadow = true;
      pedestal.add(bevel);

      // Gold trim (subtle, not a giant arc).
      const gold = new THREE.MeshStandardMaterial({ color: '#d6b86b', metalness: 1.0, roughness: 0.22 });
      const trim = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.03, 0.03), gold);
      trim.position.set(0.25, -0.92, 0.78);
      trim.castShadow = true;
      pedestal.add(trim);
      pedestal.position.set(0, -0.05, 0.05);
      scene.add(pedestal);

      // Laurel ring emblem (gold) floating behind text area.
      const laurel = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 16, 140), new THREE.MeshStandardMaterial({
        color: '#f5e2a8', metalness: 1.0, roughness: 0.22, emissive: '#2a1b00', emissiveIntensity: 0.18
      }));
      laurel.add(ring);
      // Keep it as a subtle crest behind the name, not a dominant element.
      laurel.position.set(-1.10, 0.92, -0.10);
      laurel.rotation.x = 0.2;
      laurel.scale.set(0.62, 0.62, 0.62);
      laurel.castShadow = true;
      laurel.receiveShadow = true;
      scene.add(laurel);

      // "Core" object (AI/prototype vibe): glassy icosahedron + wireframe.
      const core = new THREE.Group();
      const coreMat = new THREE.MeshPhysicalMaterial({
        color: '#0b1220',
        metalness: 0.15,
        roughness: 0.22,
        clearcoat: 1.0,
        clearcoatRoughness: 0.15,
        transmission: 0.15,
        thickness: 0.8,
        ior: 1.35,
        emissive: new THREE.Color('#001018'),
        emissiveIntensity: 0.6,
      });
      const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), coreMat);
      coreMesh.castShadow = true;
      coreMesh.receiveShadow = true;
      core.add(coreMesh);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(coreMesh.geometry, 18),
        new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.55 })
      );
      core.add(edges);

      const coreLight = new THREE.PointLight('#7dd3fc', 0.6, 6, 2);
      coreLight.position.set(0.9, 0.6, 0.9);
      core.add(coreLight);

      core.position.set(3.10, 0.98, 0.10);
      scene.add(core);

      // Ownership text: render on a transparent 2D canvas and map it.
      const textTex = document.createElement('canvas');
      textTex.width = 2048; textTex.height = 512;
      const tctx = textTex.getContext('2d');
      const textTexture = new THREE.CanvasTexture(textTex);
      textTexture.colorSpace = THREE.SRGBColorSpace;
      textTexture.minFilter = THREE.LinearFilter;
      textTexture.magFilter = THREE.LinearFilter;
      const textMat = new THREE.MeshBasicMaterial({ map: textTexture, transparent: true, depthWrite:false, depthTest:false });
      const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 2.15), textMat);
      textPlane.position.set(-0.35, 0.65, 1.35);
      scene.add(textPlane);

      function drawText(){
        tctx.clearRect(0,0,textTex.width,textTex.height);
        // premium "engraved" feel: dark stroke + soft shadow
        tctx.font = 'bold 110px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        tctx.lineWidth = 10;
        tctx.strokeStyle = 'rgba(0,0,0,0.35)';
        tctx.strokeText('Calvin Kennedy', 128, 244);
        tctx.fillStyle = 'rgba(255,255,255,0.96)';
        tctx.fillText('Calvin Kennedy', 128, 244);

        tctx.font = '700 48px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        tctx.lineWidth = 7;
        tctx.strokeStyle = 'rgba(0,0,0,0.28)';
        tctx.strokeText('@45ck  •  Full-stack AI / Product Engineer', 132, 330);
        tctx.fillStyle = 'rgba(255,255,255,0.82)';
        tctx.fillText('@45ck  •  Full-stack AI / Product Engineer', 132, 330);

        tctx.font = '700 36px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        tctx.fillStyle = 'rgba(245,226,168,0.68)';
        tctx.fillText('vibecord.dev', 1560, 446);

        // Subtle tactical reticle (2D overlay, small, low-alpha).
        tctx.globalAlpha = 0.16;
        tctx.strokeStyle = 'rgba(52, 211, 153, 0.9)';
        tctx.lineWidth = 4;
        const rx = 1780, ry = 170, rr = 46;
        tctx.beginPath(); tctx.arc(rx, ry, rr, 0, Math.PI * 2); tctx.stroke();
        tctx.beginPath(); tctx.moveTo(rx - 82, ry); tctx.lineTo(rx - 30, ry); tctx.stroke();
        tctx.beginPath(); tctx.moveTo(rx + 30, ry); tctx.lineTo(rx + 82, ry); tctx.stroke();
        tctx.beginPath(); tctx.moveTo(rx, ry - 82); tctx.lineTo(rx, ry - 30); tctx.stroke();
        tctx.beginPath(); tctx.moveTo(rx, ry + 30); tctx.lineTo(rx, ry + 82); tctx.stroke();
        tctx.globalAlpha = 1;

        textTexture.needsUpdate = true;
      }
      drawText();

      function renderAt(time){
        bgMat.uniforms.t.value = time;
        const ang = time * Math.PI * 2;
        camera.position.x = Math.sin(ang*0.25) * 0.45;
        camera.position.y = 0.72 + Math.sin(ang*0.12) * 0.06;
        camera.lookAt(0, 0.42, 0);
        laurel.rotation.y = ang * 0.12;
        laurel.rotation.z = Math.sin(ang*0.08) * 0.02;
        pedestal.rotation.y = Math.sin(ang*0.18) * 0.02;
        core.rotation.y = ang * 0.25;
        core.rotation.x = Math.sin(ang * 0.35) * 0.10;
        renderer.clear();
        renderer.render(bgScene, bgCam);
        renderer.clearDepth();
        renderer.render(scene, camera);
      }

      window.__renderAt = (t)=>renderAt(t);
      renderAt(0);
    </script>
  </body>
</html>`;
}

async function main() {
  const repoRoot = process.cwd();
  const outGif = path.join(repoRoot, 'assets', 'banner.gif');

  const tmpDir = path.join(os.tmpdir(), `45ck-banner-3d-${Date.now()}`);
  const framesDir = path.join(tmpDir, 'frames');
  await mkdir(framesDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
      '--enable-unsafe-swiftshader',
      '--font-render-hinting=none'
    ],
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => console.error('[pageerror]', err));
    page.on('console', (msg) => console.error('[console]', msg.type(), msg.text()));
    await page.setViewport({ width: IW, height: IH, deviceScaleFactor: 1 });
    await page.setContent(html(), { waitUntil: 'networkidle0' });

    // Ensure the hook exists.
    await page.waitForFunction(() => typeof window.__renderAt === 'function', { timeout: 60000 });

    for (let i = 0; i < FRAMES; i++) {
      const t = i / FRAMES;
      await page.evaluate((tt) => window.__renderAt(tt), t);
      const out = path.join(framesDir, `frame${String(i).padStart(4, '0')}.png`);
      await page.screenshot({ path: out, type: 'png' });
    }

    await mkdir(path.join(repoRoot, 'assets'), { recursive: true });
    await run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-framerate', String(FPS),
      '-i', path.join(framesDir, 'frame%04d.png'),
      '-vf',
      `fps=${FPS},scale=${W}:${H}:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full:max_colors=256[p];[s1][p]paletteuse=dither=sierra2_4a`,
      outGif,
    ]);
  } finally {
    await browser.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
