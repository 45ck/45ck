import { mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

function withTimeout(label, ms, p) {
  if (!Number.isFinite(ms) || ms <= 0) return p;
  return Promise.race([
    p,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      t.unref?.();
    }),
  ]);
}

function parseArgs(argv) {
  const args = {
    mode: 'gif', // gif | still | preview
    out: null,
    width: 1200,
    height: 300,
    scale: 2,
    fps: 24,
    seconds: 3,
    t: 0.35, // still render time
    previewTimes: [0.08, 0.34, 0.62, 0.88], // 2x2 sheet
    paramsJson: null,
    paramsFile: null,
    quality: 'full', // full | preview
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : null);
    if (a === '--mode') args.mode = next() ?? args.mode;
    else if (a === '--out') args.out = next() ?? args.out;
    else if (a === '--width') args.width = Number(next() ?? args.width);
    else if (a === '--height') args.height = Number(next() ?? args.height);
    else if (a === '--scale') args.scale = Number(next() ?? args.scale);
    else if (a === '--fps') args.fps = Number(next() ?? args.fps);
    else if (a === '--seconds') args.seconds = Number(next() ?? args.seconds);
    else if (a === '--t') args.t = Number(next() ?? args.t);
    else if (a === '--preview-times') {
      const v = next();
      if (v) args.previewTimes = v.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
    } else if (a === '--params') args.paramsJson = next() ?? args.paramsJson;
    else if (a === '--params-file') args.paramsFile = next() ?? args.paramsFile;
    else if (a === '--quality') args.quality = next() ?? args.quality;
  }

  if (!Number.isFinite(args.width) || args.width <= 0) throw new Error('invalid --width');
  if (!Number.isFinite(args.height) || args.height <= 0) throw new Error('invalid --height');

  if (args.quality === 'preview') {
    args.scale = Math.max(1, Math.min(2, Math.floor(args.scale)));
    args.fps = 18;
    args.seconds = 2;
  }

  return args;
}

function run(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 0;
  return new Promise((resolve, reject) => {
    const { timeoutMs: _timeoutMs, ...spawnOpts } = opts;
    const p = spawn(cmd, args, { stdio: 'inherit', ...spawnOpts });
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
    p.on('error', reject);
    p.on('close', (code) => {
      if (to) clearTimeout(to);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function loadParams({ repoRoot, args }) {
  // Priority: --params -> --params-file -> assets/banner.params.json -> {}
  let params = {};
  const defaultFile = path.join(repoRoot, 'assets', 'banner.params.json');
  try {
    params = JSON.parse(await readFile(defaultFile, 'utf8'));
  } catch {
    // ignore
  }

  if (args.paramsFile) {
    params = JSON.parse(await readFile(path.resolve(repoRoot, args.paramsFile), 'utf8'));
  }
  if (args.paramsJson) {
    params = JSON.parse(args.paramsJson);
  }

  const preset = params.preset ?? 'hybrid';
      const presets = {
        greco: {
          preset: 'greco',
          cam: { r: 6.1, y: 1.00, bob: 0.08 },
          halo: { r: 1.95, t: 0.065, x: -0.55, y: 0.20, z: 0.0, rx: 0.98, ry: 0.18, rz: 0.0, spin: 0.10, wobble: 0.02 },
          target: { x: -0.55, y: 0.12, z: 0.0 },
          text: { x: -1.20, y: 0.58, z: 0.58, ry: 0.25, size: 0.54, depth: 0.11 },
          hud: { subtitle: '@45ck  •  Full-stack AI / Product Engineer', product: 'vibecord.dev' },
          core: { x: 3.05, y: 0.72, z: 0.20, size: 0.72 },
        },
        military: {
          preset: 'military',
          cam: { r: 6.4, y: 1.08, bob: 0.10 },
          halo: { r: 2.05, t: 0.060, x: -0.45, y: 0.22, z: 0.0, rx: 1.05, ry: 0.12, rz: 0.0, spin: 0.12, wobble: 0.02 },
          target: { x: -0.45, y: 0.12, z: 0.0 },
          text: { x: -1.10, y: 0.56, z: 0.55, ry: 0.22, size: 0.52, depth: 0.11 },
          hud: { subtitle: '@45ck  •  Full-stack AI / Product Engineer', product: 'vibecord.dev' },
          core: { x: 3.12, y: 0.75, z: 0.25, size: 0.74 },
        },
        hybrid: {
          preset: 'hybrid',
          cam: { r: 6.25, y: 1.03, bob: 0.09 },
          halo: { r: 2.00, t: 0.062, x: -0.50, y: 0.21, z: 0.0, rx: 1.00, ry: 0.16, rz: 0.0, spin: 0.11, wobble: 0.02 },
          target: { x: -0.50, y: 0.12, z: 0.0 },
          text: { x: -1.15, y: 0.57, z: 0.56, ry: 0.24, size: 0.53, depth: 0.11 },
          hud: { subtitle: '@45ck  •  Full-stack AI / Product Engineer', product: 'vibecord.dev' },
          core: { x: 3.08, y: 0.74, z: 0.23, size: 0.73 },
        },
      };

  const base = presets[preset] ?? presets.hybrid;

  // Merge nested objects explicitly so we don't lose defaults.
  const merged = {
    ...base,
    ...params,
    cam: { ...base.cam, ...(params.cam ?? {}) },
    halo: { ...(base.halo ?? {}), ...(params.halo ?? {}) },
    target: { ...(base.target ?? {}), ...(params.target ?? {}) },
    text: { ...(base.text ?? {}), ...(params.text ?? {}) },
    hud: { ...(base.hud ?? {}), ...(params.hud ?? {}) },
    core: { ...(base.core ?? {}), ...(params.core ?? {}) },
  };

  return merged;
}

function html({ iw, ih, params }) {
  // "Halo flight" banner: 3D text + orbiting camera + space/military vibe.
  // Uses ES module imports from CDN so we only need puppeteer locally.
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
    <script type="importmap">
      {
        "imports": {
          "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"
        }
      }
    </script>
  </head>
  <body>
    <script type="module">
      import * as THREE from 'three';
      import { FontLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/FontLoader.js';
      import { TextGeometry } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/geometries/TextGeometry.js';

      const W = ${iw}, H = ${ih};
      const PARAMS = ${JSON.stringify(params ?? {})};

      function g(path, fallback) {
        const parts = String(path).split('.');
        let cur = PARAMS;
        for (const p of parts) {
          if (!cur || typeof cur !== 'object' || !(p in cur)) return fallback;
          cur = cur[p];
        }
        return cur ?? fallback;
      }

      function prng(seed) {
        let s = seed >>> 0;
        return () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 4294967296;
        };
      }

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
      renderer.toneMappingExposure = 1.18;
      renderer.autoClear = false;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      document.body.appendChild(renderer.domElement);

      // Environment (cheap but effective).
      const envCanvas = document.createElement('canvas');
      envCanvas.width = 512;
      envCanvas.height = 256;
      const ectx = envCanvas.getContext('2d');
      const grad = ectx.createLinearGradient(0, 0, 0, envCanvas.height);
      grad.addColorStop(0.0, '#070a12');
      grad.addColorStop(0.55, '#0b2634');
      grad.addColorStop(1.0, '#1a1133');
      ectx.fillStyle = grad;
      ectx.fillRect(0, 0, envCanvas.width, envCanvas.height);
      ectx.globalAlpha = 0.55;
      ectx.fillStyle = '#c7f9ff';
      ectx.fillRect(0, 22, envCanvas.width, 18);
      ectx.globalAlpha = 0.35;
      ectx.fillRect(0, 58, envCanvas.width, 10);
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
          vec3 c0 = vec3(0.02,0.03,0.06);
          vec3 c1 = vec3(0.05,0.12,0.16);
          vec3 c2 = vec3(0.10,0.07,0.18);
          float hash(vec2 p){
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          void main(){
            float v = vUv.y;
            vec3 col = mix(c0,c1,smoothstep(0.0,0.70,v));
            col = mix(col,c2,smoothstep(0.55,1.0,v));
            vec2 d = vUv - 0.5;
            col *= 1.0 - 0.30*dot(d,d);
            float sweep = smoothstep(0.0, 1.0, 1.0 - abs((vUv.x + t*0.14) - 0.65) * 3.2);
            col += sweep * 0.02;
            float grain = hash(floor(vUv * vec2(900.0, 220.0)));
            col += (grain - 0.5) * 0.007;
            gl_FragColor = vec4(col, 1.0);
          }
        \`
      });
      bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), bgMat));

      const scene = new THREE.Scene();
      scene.environment = envRT.texture;
      scene.fog = new THREE.Fog('#070a12', 18, 70);

      const camera = new THREE.PerspectiveCamera(40, W/H, 0.1, 140);
      scene.add(camera);

      // Lights.
      const key = new THREE.DirectionalLight('#ffffff', 2.3);
      key.position.set(4, 6, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 40;
      key.shadow.camera.left = -10;
      key.shadow.camera.right = 10;
      key.shadow.camera.top = 7;
      key.shadow.camera.bottom = -7;
      scene.add(key);

      const fill = new THREE.DirectionalLight('#7dd3fc', 0.55);
      fill.position.set(-6, 2, 3);
      scene.add(fill);

      const rim = new THREE.DirectionalLight('#34d399', 0.55);
      rim.position.set(-2, 4, -8);
      scene.add(rim);

      scene.add(new THREE.AmbientLight('#ffffff', 0.18));

      // Camera-mounted light so the title stays readable during the fly-by.
      const camLight = new THREE.SpotLight('#ffffff', 3.2, 26, Math.PI / 6, 0.45, 1.2);
      camLight.position.set(0, 0, 0);
      camLight.castShadow = false;
      const camLightTarget = new THREE.Object3D();
      camLightTarget.position.set(0, 0, -1);
      camera.add(camLightTarget);
      camLight.target = camLightTarget;
      camera.add(camLight);

      // Stars (stable positions, no flicker).
      const stars = new THREE.Group();
      const starRnd = prng(1337);
      const starCount = 900;
      const starPos = new Float32Array(starCount * 3);
      for (let i = 0; i < starCount; i++) {
        const r = 30 + starRnd() * 40;
        const th = starRnd() * Math.PI * 2;
        const ph = (starRnd() * 2 - 1) * 0.9;
        starPos[i * 3 + 0] = Math.cos(th) * r;
        starPos[i * 3 + 1] = ph * 18;
        starPos[i * 3 + 2] = Math.sin(th) * r;
      }
      const starGeom = new THREE.BufferGeometry();
      starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
      const starMat = new THREE.PointsMaterial({
        color: '#e5f3ff',
        size: 0.065,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      });
      const starPts = new THREE.Points(starGeom, starMat);
      stars.add(starPts);
      scene.add(stars);

      // Halo ring + title.

      const gold = new THREE.MeshStandardMaterial({
        color: '#e7c978',
        metalness: 1.0,
        roughness: 0.22,
        emissive: '#241200',
        emissiveIntensity: 0.14,
      });
      // Keep the halo from occluding the title while still looking like a real object.
      gold.transparent = true;
      gold.opacity = 0.88;
      gold.depthWrite = false;

      const halo = new THREE.Group();
      const haloR = g('halo.r', 2.0);
      const haloT = g('halo.t', 0.062);
      const haloMesh = new THREE.Mesh(new THREE.TorusGeometry(haloR, haloT, 18, 220), gold);
      haloMesh.renderOrder = 1;
      haloMesh.castShadow = true;
      haloMesh.receiveShadow = true;
      halo.add(haloMesh);
      halo.position.set(g('halo.x', -0.50), g('halo.y', 0.21), g('halo.z', 0.0));
      halo.rotation.set(g('halo.rx', 1.0), g('halo.ry', 0.16), g('halo.rz', 0.0));
      scene.add(halo);
      const haloBaseRot = halo.rotation.clone();

      // Camera anchor is the "center of action" (defaults to the halo).
      const anchor = new THREE.Vector3(
        g('target.x', halo.position.x),
        g('target.y', halo.position.y - 0.10),
        g('target.z', halo.position.z)
      );

      // Tactical arc segments (military vibe, kept subtle for GIF).
      const arcMat = new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.12, side: THREE.DoubleSide });
      const arc = new THREE.Mesh(new THREE.RingGeometry(haloR * 1.18, haloR * 1.195, 140, 1, 0.3, 1.1), arcMat);
      arc.renderOrder = 0;
      arc.rotation.copy(halo.rotation);
      arc.position.copy(halo.position);
      scene.add(arc);

      // Core object (floating "AI core").
      const core = new THREE.Group();
      const coreMat = new THREE.MeshPhysicalMaterial({
        color: '#0b1220',
        metalness: 0.2,
        roughness: 0.18,
        clearcoat: 1.0,
        clearcoatRoughness: 0.12,
        transmission: 0.10,
        thickness: 0.8,
        ior: 1.35,
        emissive: new THREE.Color('#001018'),
        emissiveIntensity: 0.6,
      });
      const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(g('core.size', 0.73), 0), coreMat);
      coreMesh.castShadow = true;
      coreMesh.receiveShadow = true;
      core.add(coreMesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(coreMesh.geometry, 18),
        new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.60 })
      );
      edges.renderOrder = 0;
      core.add(edges);
      const coreLight = new THREE.PointLight('#7dd3fc', 0.7, 9, 2);
      coreLight.position.set(0.9, 0.6, 0.9);
      core.add(coreLight);
      // Push the "AI core" into the background so it doesn't dominate the title.
      core.position.set(g('core.x', 3.40), g('core.y', 0.92), g('core.z', -2.20));
      scene.add(core);

      // Reticle ring around the core.
      const reticle = new THREE.Group();
      const reticleMat = new THREE.MeshBasicMaterial({ color: '#34d399', transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite:false });
      const reticleRing = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.0, 96), reticleMat);
      reticle.add(reticleRing);
      const tickMat = new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite:false });
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.02), tickMat);
      tick.position.set(0.0, 1.0, 0.0);
      reticle.add(tick);
      for (let k = 1; k < 4; k++) {
        const t = tick.clone();
        t.rotation.z = k * Math.PI / 2;
        t.position.set(Math.cos(k * Math.PI / 2) * 1.0, Math.sin(k * Math.PI / 2) * 1.0, 0.0);
        reticle.add(t);
      }
      reticle.position.copy(core.position);
      reticle.rotation.x = 0.7;
      scene.add(reticle);

      // 3D text (name) near the halo.
      const fontUrl = g('text.font', 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/fonts/helvetiker_bold.typeface.json');
      const font = await new FontLoader().loadAsync(fontUrl);

      const name = g('text.name', 'Calvin Kennedy');
      const nameSize = g('text.size', 0.48);
      const nameGeo = new TextGeometry(name, {
        font,
        size: nameSize,
        depth: g('text.depth', 0.105),
        curveSegments: 10,
        bevelEnabled: true,
        bevelThickness: 0.015,
        bevelSize: 0.010,
        bevelSegments: 3,
      });
      nameGeo.computeBoundingBox();
      const bb = nameGeo.boundingBox;
      const nameW = bb.max.x - bb.min.x;
      const nameH = bb.max.y - bb.min.y;
      nameGeo.translate(-nameW / 2, -nameH / 2, 0);

      const nameMat = new THREE.MeshStandardMaterial({
        color: '#f7f7f8',
        metalness: 0.22,
        roughness: 0.28,
        emissive: '#0a1222',
        emissiveIntensity: 0.12,
      });
      nameMat.envMapIntensity = 1.55;
      nameMat.emissiveIntensity = 0.36;
      nameMat.side = THREE.DoubleSide;
      // Keep this as a "real" 3D object: allow depth so the halo never draws over the title.
      // We keep other objects intentionally behind the action instead of brute-forcing renderOrder.
      nameMat.depthTest = true;
      nameMat.depthWrite = true;

      const nameGroup = new THREE.Group();
      const nameMesh = new THREE.Mesh(nameGeo, nameMat);
      nameMesh.renderOrder = 20;
      nameMesh.castShadow = true;
      nameMesh.receiveShadow = true;
      nameGroup.add(nameMesh);

      // Soft shadow/outline (helps in GIF compression + readability).
      const shadowMesh = new THREE.Mesh(
        nameGeo,
        new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22, depthTest: true, depthWrite: false, side: THREE.DoubleSide })
      );
      shadowMesh.position.set(0.03, -0.03, -0.08);
      shadowMesh.renderOrder = 19;
      nameGroup.add(shadowMesh);

      nameGroup.position.set(
        g('text.x', anchor.x - 0.55),
        g('text.y', anchor.y + 0.55),
        g('text.z', anchor.z + 0.75)
      );
      nameGroup.rotation.set(g('text.rx', 0.0), g('text.ry', 0.24), g('text.rz', 0.0));
      scene.add(nameGroup);

      // Subtitle + watermark (2D canvas in 3D space for crispness).
      const hudCanvas = document.createElement('canvas');
      hudCanvas.width = 2048; hudCanvas.height = 512;
      const hctx = hudCanvas.getContext('2d');
      const hudTex = new THREE.CanvasTexture(hudCanvas);
      hudTex.colorSpace = THREE.SRGBColorSpace;
      hudTex.minFilter = THREE.LinearFilter;
      hudTex.magFilter = THREE.LinearFilter;

      function drawHud() {
        hctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
        hctx.fillStyle = 'rgba(0,0,0,0.22)';
        hctx.fillRect(88, 142, 1260, 190);

        hctx.font = '700 56px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        hctx.fillStyle = 'rgba(255,255,255,0.88)';
        hctx.fillText(g('hud.subtitle', '@45ck  •  Full-stack AI / Product Engineer'), 130, 240);

        hctx.font = '700 34px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        hctx.fillStyle = 'rgba(231,201,120,0.66)';
        hctx.fillText(g('hud.product', 'vibecord.dev'), 1410, 420);

        // Ownership microtext (hard to crop out cleanly).
        hctx.font = '700 26px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace';
        hctx.fillStyle = 'rgba(125,211,252,0.22)';
        hctx.fillText('CALVIN KENNEDY', 130, 416);

        hudTex.needsUpdate = true;
      }
      drawHud();

      const hudMat = new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthWrite:false, depthTest:false });
      const hudPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 0.92), hudMat);
      hudPlane.renderOrder = 21;
      hudPlane.position.set(0.00, -0.52, 0.38);
      nameGroup.add(hudPlane);

      // Orbiters (cool objects).
      const orbiters = [];
      const orbMatA = new THREE.MeshStandardMaterial({ color: '#0a0f18', metalness: 0.9, roughness: 0.25, emissive: '#001018', emissiveIntensity: 0.25 });
      const orbMatB = new THREE.MeshStandardMaterial({ color: '#0b1220', metalness: 0.6, roughness: 0.35, emissive: '#06241b', emissiveIntensity: 0.25 });
      const orbGeoA = new THREE.OctahedronGeometry(0.16, 0);
      const orbGeoB = new THREE.TorusKnotGeometry(0.10, 0.035, 90, 12);
      for (let i = 0; i < 3; i++) {
        const m = i % 2 === 0 ? orbMatA : orbMatB;
        const g0 = i === 2 ? orbGeoB : orbGeoA;
        const mesh = new THREE.Mesh(g0, m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        orbiters.push(mesh);
      }

      // "Aircraft back" silhouette: a small ship attached to the camera (subtle).
      const ship = new THREE.Group();
      ship.visible = !!g('ship.enabled', false);
      const shipMat = new THREE.MeshStandardMaterial({ color: '#080c12', metalness: 0.25, roughness: 0.8 });
      const shipBody = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.10, 0.90), shipMat);
      shipBody.position.set(0.0, -0.02, -0.25);
      ship.add(shipBody);
      const shipNose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 18), shipMat);
      shipNose.rotation.x = Math.PI / 2;
      shipNose.position.set(0.0, 0.00, -0.85);
      ship.add(shipNose);

      const glowCanvas = document.createElement('canvas');
      glowCanvas.width = 128; glowCanvas.height = 128;
      const gctx = glowCanvas.getContext('2d');
      const rad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      rad.addColorStop(0.0, 'rgba(125,211,252,0.75)');
      rad.addColorStop(0.35, 'rgba(52,211,153,0.22)');
      rad.addColorStop(1.0, 'rgba(0,0,0,0)');
      gctx.fillStyle = rad;
      gctx.fillRect(0, 0, 128, 128);
      const glowTex = new THREE.CanvasTexture(glowCanvas);
      glowTex.colorSpace = THREE.SRGBColorSpace;
      const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.65, depthWrite:false, blending: THREE.AdditiveBlending });
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), glowMat);
      glow.position.set(0.0, -0.04, 0.08);
      ship.add(glow);

      camera.add(ship);
      // Keep the ship subtle and mostly out-of-frame; it's more "vibe" than focal point.
      ship.position.set(0.0, -1.12, -2.35);

      const tmpU = new THREE.Vector3();
      const tmpV = new THREE.Vector3();
      const tmpN = new THREE.Vector3();
      const tmpDir = new THREE.Vector3();
      const tmpPos = new THREE.Vector3();
      const rollQ = new THREE.Quaternion();
      const rollAxis = new THREE.Vector3(0, 0, 1);

      function renderAt(time) {
        bgMat.uniforms.t.value = time;
        const a = time * Math.PI * 2;

        // Animate halo first so the camera orbit plane matches the current frame.
        const haloSpin = g('halo.spin', 0.11);
        const haloWobble = g('halo.wobble', 0.02);
        halo.rotation.set(
          haloBaseRot.x,
          haloBaseRot.y + haloSpin * a,
          haloBaseRot.z + haloWobble * Math.sin(a * 0.7)
        );

        // Orbit camera around the halo IN the halo's plane (feels like a fly-by).
        // We intentionally keep it as an oscillating sweep (not a full 360) so the name stays readable.
        const camR = g('cam.r', 6.25);
        const camLift = g('cam.lift', 0.58);
        const camBob = g('cam.bob', 0.09);
        const camSweep = g('cam.sweep', 0.78); // radians

        tmpU.set(1, 0, 0).applyEuler(halo.rotation).normalize();
        tmpV.set(0, 0, 1).applyEuler(halo.rotation).normalize();
        tmpN.crossVectors(tmpU, tmpV).normalize();

        const theta = Math.sin(a) * camSweep;
        const c1 = Math.cos(theta);
        const s1 = Math.sin(theta);
        const bob = Math.sin(a * 1.7) * camBob;

        tmpPos
          .copy(anchor)
          .addScaledVector(tmpU, c1 * camR)
          .addScaledVector(tmpV, s1 * camR)
          .addScaledVector(tmpN, camLift + bob);

        camera.position.copy(tmpPos);
        camera.lookAt(anchor.x, anchor.y + 0.18, anchor.z);

        // Apply roll without accumulation (lookAt resets quaternion).
        const roll = g('cam.roll', 0.018) * Math.sin(a);
        rollQ.setFromAxisAngle(rollAxis, roll);
        camera.quaternion.multiply(rollQ);

        // Keep name readable: float it slightly toward the camera and face it back.
        tmpDir.subVectors(camera.position, anchor).normalize();
        nameGroup.position
          .copy(anchor)
          .addScaledVector(tmpDir, g('text.pull', 1.15))
          .addScaledVector(tmpN, g('text.lift', 0.14));
        nameGroup.lookAt(camera.position);
        nameGroup.rotateY(g('text.faceBias', 0.06));

        // Motion layers.
        stars.rotation.y = a * 0.02;

        core.rotation.y = a * 0.55;
        core.rotation.x = Math.sin(a * 1.1) * 0.10;
        reticle.rotation.z = a * 0.65;
        reticle.position.copy(core.position);

        for (let i = 0; i < orbiters.length; i++) {
          const m = orbiters[i];
          const r = 2.2 + i * 0.55;
          const aa = a * (0.75 + i * 0.22) + i * 1.2;
          // Keep orbiters behind the action to avoid covering the name.
          m.position.set(
            anchor.x + Math.cos(aa) * r - tmpDir.x * 2.8,
            anchor.y + 0.25 + Math.sin(aa * 1.3) * 0.25 + tmpN.y * 0.15,
            anchor.z + Math.sin(aa) * r - tmpDir.z * 2.8
          );
          m.rotation.x = aa * 0.6;
          m.rotation.y = aa * 0.7;
        }

        // Ship subtle vibration.
        ship.rotation.z = Math.sin(a * 2.0) * 0.01;
        ship.rotation.x = Math.sin(a * 1.3) * 0.008;

        renderer.clear();
        renderer.render(bgScene, bgCam);
        renderer.clearDepth();
        renderer.render(scene, camera);
      }

      window.__renderAt = (t) => renderAt(t);
      renderAt(0);
    </script>
  </body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = process.cwd();
  const outDefault = path.join(repoRoot, 'assets', args.mode === 'gif' ? 'banner.gif' : 'banner-preview.png');
  const outPath = args.out ? path.resolve(repoRoot, args.out) : outDefault;

  const params = await loadParams({ repoRoot, args });

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
    page.setDefaultTimeout(90000);
    page.setDefaultNavigationTimeout(90000);
    page.on('pageerror', (err) => console.error('[pageerror]', err));
    page.on('console', (msg) => {
      // Chromium/SwiftShader is noisy here; these warnings are expected and don't indicate a broken render.
      const t = msg.text();
      if (t.includes('GL Driver Message') && t.includes('GPU stall due to ReadPixels')) return;
      console.error('[console]', msg.type(), t);
    });

    const iw = Math.round(args.width * args.scale);
    const ih = Math.round(args.height * args.scale);
    await page.setViewport({ width: iw, height: ih, deviceScaleFactor: 1 });
    await withTimeout(
      'page.setContent',
      90000,
      page.setContent(html({ iw, ih, params }), { waitUntil: 'domcontentloaded' })
    );

    // Best-effort wait for fonts.
    try {
      await withTimeout('document.fonts.ready', 20000, page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())));
    } catch {
      // ignore
    }

    await page.waitForFunction(() => typeof window.__renderAt === 'function', { timeout: 90000 });
    await mkdir(path.dirname(outPath), { recursive: true });

    if (args.mode === 'still') {
      await withTimeout('render(still)', 15000, page.evaluate((tt) => window.__renderAt(tt), args.t));
      await withTimeout('screenshot(still)', 15000, page.screenshot({ path: outPath, type: 'png' }));
      return;
    }

    if (args.mode === 'preview') {
      const times = (args.previewTimes?.length ? args.previewTimes : [args.t]).slice(0, 4);
      while (times.length < 4) times.push(times[times.length - 1] ?? 0.35);
      for (let i = 0; i < times.length; i++) {
        const t = times[i];
        await withTimeout(`render(preview:${i})`, 15000, page.evaluate((tt) => window.__renderAt(tt), t));
        const out = path.join(framesDir, `frame${String(i).padStart(2, '0')}.png`);
        await withTimeout(`screenshot(preview:${i})`, 15000, page.screenshot({ path: out, type: 'png' }));
      }
      await run('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-framerate', '1',
        '-i', path.join(framesDir, 'frame%02d.png'),
        '-vf',
        `scale=${args.width}:${args.height}:flags=lanczos,tile=2x2:margin=18:padding=18:color=0x070a12`,
        outPath,
      ], { timeoutMs: 60000 });
      return;
    }

    // GIF.
    const frames = Math.max(1, Math.floor(args.fps * args.seconds));
    for (let i = 0; i < frames; i++) {
      const t = i / frames;
      await withTimeout(`render(frame:${i})`, 15000, page.evaluate((tt) => window.__renderAt(tt), t));
      const out = path.join(framesDir, `frame${String(i).padStart(4, '0')}.png`);
      await withTimeout(`screenshot(frame:${i})`, 15000, page.screenshot({ path: out, type: 'png' }));
    }

    await run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-framerate', String(args.fps),
      '-i', path.join(framesDir, 'frame%04d.png'),
      '-vf',
      `fps=${args.fps},scale=${args.width}:${args.height}:flags=lanczos,split[s0][s1];` +
        `[s0]palettegen=stats_mode=full:max_colors=256[p];` +
        `[s1][p]paletteuse=dither=sierra2_4a`,
      outPath,
    ], { timeoutMs: 120000 });
  } finally {
    await browser.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
