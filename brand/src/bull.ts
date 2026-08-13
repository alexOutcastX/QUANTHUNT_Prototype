// The landing hero's 3D bull — ported from the previous TaurEye app's
// BullScene.tsx, which this app replaces.
//
// The model, the materials and the motion are the originals: a 151-vertex
// low-poly bull head (Blender OBJ), flat-shaded chrome-green metal reflecting a
// procedural room environment, with glowing brand-green wireframe edges over
// the top. It sways on a slow sine and tilts toward the pointer.
//
// Differences from the React original, all forced by where it now runs:
//   - No React. The landing is server-rendered HTML from brandsite.py, so this
//     mounts itself into #bull and is loaded as a plain <script>.
//   - The fallback is the pre-rendered PNG that is already in the markup rather
//     than an SVG mark, so a device without WebGL keeps the same silhouette —
//     that PNG is a render of this exact model.
//   - Loading is deferred here rather than by the caller: the bundle is ~150 KB
//     gzipped and must not compete with the landing's first paint.
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import bullObjSrc from './bullhead.obj';

const mount = document.getElementById('bull');

function start(): (() => void) | void {
  if (!mount) return;
  // The loader already declines to fetch this bundle under reduced motion, so
  // this is belt-and-braces: it keeps the scene correct on its own terms rather
  // than relying on a caller three files away to enforce a user preference.
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    // No WebGL context — common on locked-down or low-end Android WebViews.
    // The PNG in the markup is already on screen; leaving it there is the
    // whole fallback.
    console.warn('bull: WebGL unavailable, keeping the static render.', e);
    return;
  }

  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.15, 5.2);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // ---- environment reflections (procedural room) for the metallic sheen ----
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    // ---- lighting: warm key from top-right, brand-green rim from below-left ----
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x18c98c, 1.4);
    rim.position.set(-3, -1.5, 1.5);
    scene.add(rim);

    // ---- chrome-green metal that reflects the environment ----
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0f3a2c,
      flatShading: true,
      metalness: 1.0,
      roughness: 0.22,
      emissive: 0x05140f,
      envMapIntensity: 1.25,
    });
    // glowing brand-green wireframe edges (holographic/tech feel)
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x2be3a6,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // ---- the bull-head OBJ, inlined into this bundle at build time ----
    const disposables: THREE.BufferGeometry[] = [];
    const model = new OBJLoader().parse(bullObjSrc);
    const box = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    const dims = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(dims);
    // centre the GEOMETRY at the origin (so later rotation spins about the head)
    model.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = mat;
        const g = mesh.geometry as THREE.BufferGeometry;
        g.translate(-center.x, -center.y, -center.z);
        disposables.push(g);
        const wf = new THREE.LineSegments(new THREE.WireframeGeometry(g), wireMat);
        disposables.push(wf.geometry as THREE.BufferGeometry);
        mesh.add(wf);
      }
    });
    const maxDim = Math.max(dims.x, dims.y, dims.z) || 1;

    // stand the model upright (it is authored Z-up) and face it to the camera
    model.rotation.set(-1.35 + (270 * Math.PI) / 180, 0, 0);

    const bull = new THREE.Group();
    bull.add(model);
    bull.scale.setScalar((2.7 * 1.3) / maxDim);
    bull.rotation.y = -0.3;
    scene.add(bull);

    // ---- responsive sizing ----
    const resize = () => {
      const w = mount!.clientWidth || 1;
      const h = mount!.clientHeight || 1;
      renderer.setSize(w, h);       // sets the canvas CSS size too, so it never overflows
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    renderer.domElement.style.display = 'block';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    mount.appendChild(renderer.domElement);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // ---- pointer parallax ----
    // On the window rather than the mount: the bull sits in the corner of a
    // wide hero, and one that only reacts when the cursor is directly over it
    // looks broken from anywhere else on the page.
    let targetX = 0;
    let targetY = 0;
    const onMove = (e: PointerEvent) => {
      const r = mount!.getBoundingClientRect();
      targetX = clamp((e.clientX - (r.left + r.width / 2)) / window.innerWidth) * 0.6;
      targetY = clamp((e.clientY - (r.top + r.height / 2)) / window.innerHeight) * 0.4;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    // ---- animation loop ----
    // Time is accumulated by hand rather than read from THREE.Clock because the
    // loop pauses off-screen: a clock that kept running would resume mid-sway
    // and the bull would visibly jump.
    let raf = 0;
    let t = 0;
    let last = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      t += Math.min((now - last) / 1000, 0.1);   // cap the first/stale frame
      last = now;
      if (reduce) {
        bull.rotation.y = -0.3;
        bull.position.y = 0;
      } else {
        bull.rotation.y += (targetX - 0.3 + Math.sin(t * 0.3) * 0.18 - bull.rotation.y) * 0.05;
        bull.rotation.x += (targetY * 0.5 - bull.rotation.x) * 0.05;
        bull.position.y = Math.sin(t * 0.8) * 0.06;
      }
      renderer.render(scene, camera);
    };
    const run = () => {
      if (raf) return;
      last = performance.now();
      animate();
    };
    run();

    // The canvas is up and has drawn a frame — hand over from the PNG. The flag
    // also tells the inline fallback tilt to stop writing transforms.
    mount.dataset.webgl = '1';

    // Pause off-screen. The landing is a long page and there is no reason to
    // keep a GPU loop running for a hero nobody is looking at.
    const io = new IntersectionObserver((entries) => {
      const visible = entries.some((en) => en.isIntersecting);
      if (visible) run();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      disposables.forEach((g) => g.dispose());
      mat.dispose();
      wireMat.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  } catch (e) {
    console.warn('bull: render setup failed, keeping the static render.', e);
    try {
      renderer.dispose();
    } catch {
      /* ignore */
    }
    if (renderer.domElement?.parentNode === mount) mount.removeChild(renderer.domElement);
    delete mount.dataset.webgl;
  }
}

function clamp(n: number): number {
  return Math.max(-1, Math.min(1, n));
}

start();
