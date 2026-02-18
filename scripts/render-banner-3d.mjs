import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const W = 1200;
const H = 300;
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
  // Scene is intentionally minimal and premium: marble pedestal + gold laurel + HUD plane.
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

      const W = ${W}, H = ${H};

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
      renderer.toneMappingExposure = 1.05;
      document.body.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog('#070a12', 8, 18);

      // Subtle gradient background via big plane.
      const bgGeo = new THREE.PlaneGeometry(30, 10);
      const bgMat = new THREE.ShaderMaterial({
        uniforms: { t: { value: 0 } },
        vertexShader: \`
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        \`,
        fragmentShader: \`
          varying vec2 vUv;
          uniform float t;
          vec3 c0 = vec3(0.03,0.04,0.08);
          vec3 c1 = vec3(0.05,0.14,0.18);
          vec3 c2 = vec3(0.10,0.07,0.18);
          float n(vec2 p){ return sin(p.x*12.0 + t*1.7)*cos(p.y*9.0 - t*1.2); }
          void main(){
            float v = vUv.y;
            vec3 col = mix(c0,c1,smoothstep(0.0,0.65,v));
            col = mix(col,c2,smoothstep(0.55,1.0,v));
            col += 0.03*n(vUv*vec2(1.0,1.0));
            gl_FragColor = vec4(col,1.0);
          }
        \`
      });
      const bg = new THREE.Mesh(bgGeo, bgMat);
      bg.position.set(0, 0, -12);
      scene.add(bg);

      const camera = new THREE.PerspectiveCamera(38, W/H, 0.1, 100);
      camera.position.set(0.0, 0.55, 9.6);

      // Lights
      const key = new THREE.DirectionalLight('#ffffff', 2.3);
      key.position.set(3, 4, 4);
      scene.add(key);
      const fill = new THREE.DirectionalLight('#a7f3d0', 0.55);
      fill.position.set(-4, 1, 2);
      scene.add(fill);
      const rim = new THREE.DirectionalLight('#93c5fd', 0.85);
      rim.position.set(-1, 3, -4);
      scene.add(rim);
      scene.add(new THREE.AmbientLight('#ffffff', 0.22));

      // Marble material (procedural) for pedestal.
      const marbleMat = new THREE.ShaderMaterial({
        uniforms: { t: { value: 0 } },
        vertexShader: \`
          varying vec3 vPos;
          varying vec3 vN;
          void main(){
            vPos = position;
            vN = normalMatrix * normal;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          }
        \`,
        fragmentShader: \`
          varying vec3 vPos;
          varying vec3 vN;
          uniform float t;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float noise(vec2 p){
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0,0.0));
            float c = hash(i + vec2(0.0,1.0));
            float d = hash(i + vec2(1.0,1.0));
            vec2 u = f*f*(3.0-2.0*f);
            return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
          }
          void main(){
            vec3 n = normalize(vN);
            float ndl = clamp(dot(n, normalize(vec3(0.6,0.8,0.5))), 0.0, 1.0);
            vec2 p = vPos.xz * 2.2 + vec2(t*0.08, -t*0.04);
            float v = sin((p.x*2.0 + noise(p*1.3)*1.7) * 3.14159);
            float veins = smoothstep(0.62, 0.88, abs(v));
            vec3 base = vec3(0.86,0.87,0.89);
            vec3 vein = vec3(0.30,0.33,0.38);
            vec3 col = mix(base, vein, veins*0.35);
            col *= 0.75 + 0.55*ndl;
            gl_FragColor = vec4(col, 1.0);
          }
        \`
      });

      const pedestal = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(7.8, 1.6, 2.4), marbleMat);
      slab.position.set(0, -0.15, 0);
      pedestal.add(slab);

      const bevel = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.22, 2.65), new THREE.MeshStandardMaterial({
        color: '#d8dbe0', metalness: 0.05, roughness: 0.55
      }));
      bevel.position.set(0, 0.72, 0);
      pedestal.add(bevel);

      // Gold trim line.
      const trim = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.035, 16, 120), new THREE.MeshStandardMaterial({
        color: '#d6b86b', metalness: 1.0, roughness: 0.25, emissive: '#221300', emissiveIntensity: 0.3
      }));
      trim.scale.set(3.0, 1.0, 0.45);
      trim.position.set(0, 0.60, 0.64);
      pedestal.add(trim);
      pedestal.position.set(0, -0.05, 0);
      scene.add(pedestal);

      // Laurel ring emblem (gold) floating behind text area.
      const laurel = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 16, 140), new THREE.MeshStandardMaterial({
        color: '#f5e2a8', metalness: 1.0, roughness: 0.22, emissive: '#2a1b00', emissiveIntensity: 0.18
      }));
      laurel.add(ring);
      for (let i=0;i<22;i++){
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 10), new THREE.MeshStandardMaterial({
          color:'#e8cf87', metalness:1.0, roughness:0.26
        }));
        const a = (i/22)*Math.PI*2;
        leaf.position.set(Math.cos(a)*1.1, Math.sin(a)*1.1, 0);
        leaf.rotation.z = a + Math.PI/2;
        leaf.rotation.x = 0.35;
        laurel.add(leaf);
      }
      laurel.position.set(0.0, 0.55, -0.2);
      laurel.rotation.x = 0.2;
      scene.add(laurel);

      // Tactical HUD plane (subtle).
      const hudTex = document.createElement('canvas');
      hudTex.width = 1024; hudTex.height = 256;
      const ctx = hudTex.getContext('2d');
      const hudCanvasTex = new THREE.CanvasTexture(hudTex);
      hudCanvasTex.colorSpace = THREE.SRGBColorSpace;
      const hudMat = new THREE.MeshBasicMaterial({ map: hudCanvasTex, transparent: true, opacity: 0.65, depthWrite: false });
      const hud = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 2.2), hudMat);
      hud.position.set(0, -0.05, 1.05);
      scene.add(hud);

      function drawHUD(time){
        ctx.clearRect(0,0,hudTex.width,hudTex.height);
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#2ee67b';
        ctx.lineWidth = 2;
        // reticle
        const rx = 820, ry = 110;
        ctx.beginPath(); ctx.arc(rx, ry, 38, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rx-62, ry); ctx.lineTo(rx-22, ry); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rx+22, ry); ctx.lineTo(rx+62, ry); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rx, ry-62); ctx.lineTo(rx, ry-22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rx, ry+22); ctx.lineTo(rx, ry+62); ctx.stroke();
        // scanline
        const sx = (time*1.1 % 1) * hudTex.width;
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = '#7dd3fc';
        ctx.fillRect(sx-18, 0, 10, hudTex.height);
        ctx.globalAlpha = 0.22;
        ctx.fillRect(sx-6, 0, 3, hudTex.height);

        // small label chips
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(48, 32, 240, 40);
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
        ctx.strokeRect(48, 32, 240, 40);
        ctx.fillStyle = 'rgba(255,255,255,0.70)';
        ctx.font = '20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.fillText('AI  •  PRODUCT  •  PROTOTYPING', 62, 58);

        hudCanvasTex.needsUpdate = true;
      }

      // Ownership text: render on a transparent 2D canvas and map it.
      const textTex = document.createElement('canvas');
      textTex.width = 2048; textTex.height = 512;
      const tctx = textTex.getContext('2d');
      const textTexture = new THREE.CanvasTexture(textTex);
      textTexture.colorSpace = THREE.SRGBColorSpace;
      const textMat = new THREE.MeshBasicMaterial({ map: textTexture, transparent: true, depthWrite:false });
      const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 2.15), textMat);
      textPlane.position.set(0, 0.35, 0.96);
      scene.add(textPlane);

      function drawText(){
        tctx.clearRect(0,0,textTex.width,textTex.height);
        // soft shadow
        tctx.fillStyle = 'rgba(0,0,0,0.35)';
        tctx.font = 'bold 110px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        tctx.fillText('Calvin Kennedy', 134, 250);
        tctx.fillStyle = 'rgba(255,255,255,0.96)';
        tctx.fillText('Calvin Kennedy', 128, 244);

        tctx.font = '600 48px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        tctx.fillStyle = 'rgba(255,255,255,0.78)';
        tctx.fillText('@45ck  •  Full-stack AI / Product Engineer', 132, 330);

        tctx.font = '600 38px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        tctx.fillStyle = 'rgba(245,226,168,0.55)';
        tctx.fillText('vibecord.dev', 1550, 440);

        textTexture.needsUpdate = true;
      }
      drawText();

      function renderAt(time){
        bgMat.uniforms.t.value = time;
        marbleMat.uniforms.t.value = time;
        const ang = time * Math.PI * 2;
        camera.position.x = Math.sin(ang*0.25) * 0.6;
        camera.position.y = 0.55 + Math.sin(ang*0.12) * 0.08;
        camera.lookAt(0, 0.35, 0);
        laurel.rotation.y = ang * 0.12;
        laurel.rotation.z = Math.sin(ang*0.08) * 0.02;
        pedestal.rotation.y = Math.sin(ang*0.18) * 0.02;
        drawHUD(time);
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
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
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
      `fps=${FPS},scale=${W}:${H}:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
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
