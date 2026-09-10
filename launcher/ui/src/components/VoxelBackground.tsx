import { useEffect, useRef } from "react";
import * as THREE from "three";
import atlasUrl from "../assets/block-atlas.png";
import atlasMetaJson from "../assets/block-atlas.json";

/**
 * Voxel-фон на three.js: левитирующий остров из настоящих Minecraft-блоков
 * (текстуры client jar -> атлас), вокруг — аметистовые кубы и звёзды.
 * Затенение граней запечено в вершинные цвета, MeshBasicMaterial — один
 * draw call. Рендер 0.75x, пауза при скрытом окне, статичный кадр при
 * prefers-reduced-motion.
 */

interface AtlasMeta {
  cols: number;
  rows: number;
  tile: number;
  count: number;
  blocks: Record<string, number>;
}
const meta = atlasMetaJson as unknown as AtlasMeta;
const T = meta.blocks;

const U_TILE = 1 / meta.cols;
const V_TILE = 1 / meta.rows;
const EPS = 0.0015;

// индексы тайлов в атласе
const GRASS = T.grass_block_top;
const GRASS_SIDE = T.grass_block_side;
const DIRT = T.dirt;
const STONE = T.stone;
const DEEPSLATE = T.deepslate;
const AMETHYST = T.amethyst_block;
const GLOWSTONE = T.glowstone;
const MOSSY = T.mossy_cobblestone;

// профиль острова: x,z в [-6..6], y в [-4..3]
function density(x: number, y: number, z: number): number {
  const rad = 5.6 - (y + 4) * 0.42;
  if (rad <= 1.2) return 0;
  const r2 = x * x + z * z;
  const edge = 1 - r2 / (rad * rad);
  if (edge <= 0) return 0;
  const n =
    Math.sin(x * 0.9 + z * 1.3) * Math.cos(z * 0.8 - x * 0.6) +
    Math.sin((x + z) * 0.55) * 0.7;
  return edge + n * 0.26 - (y < -1 ? (-y - 1) * 0.24 : 0);
}

const hash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

type Voxel = { x: number; y: number; z: number; t: number };

function islandVoxels(): Voxel[] {
  const vox: Voxel[] = [];
  for (let x = -6; x <= 6; x++)
    for (let z = -6; z <= 6; z++)
      for (let y = -4; y <= 3; y++) {
        if (density(x, y, z) <= 0.02) continue;
        const above = density(x, y + 1, z) > 0.02;
        const twoAbove = density(x, y + 2, z) > 0.02;
        let t: number;
        if (!above) t = GRASS;
        else if (!twoAbove) t = DIRT;
        else t = y < -2 ? DEEPSLATE : STONE;
        const h = hash(x, y, z);
        if (h > 0.975) t = AMETHYST;
        else if (h > 0.955) t = GLOWSTONE;
        else if (!above && h > 0.88) t = MOSSY;
        vox.push({ x, y, z, t });
      }
  return vox;
}

// грани куба: смещение, 4 угла (CCW снаружи), яркость (как в Minecraft)
const FACES: { d: [number, number, number]; c: [number, number, number][]; b: number }[] = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], b: 0.6 },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], b: 0.6 },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], b: 1.0 },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], b: 0.5 },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], b: 0.8 },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], b: 0.8 },
];

function tileUV(t: number): { u0: number; v0: number; u1: number; v1: number } {
  const col = t % meta.cols;
  const row = Math.floor(t / meta.cols);
  return {
    u0: col * U_TILE + EPS,
    v0: 1 - (row + 1) * V_TILE + EPS,
    u1: (col + 1) * U_TILE - EPS,
    v1: 1 - row * V_TILE - EPS,
  };
}

// tint блока с учётом грани (трава сверху зелёная, светокамень светится)
function tint(t: number, face: number): [number, number, number] {
  if (t === GRASS && face === 2) return [0.55, 0.82, 0.38];
  if (t === GRASS && face !== 2 && face !== 3) return [1, 1, 1]; // grass_side как есть
  if (t === GLOWSTONE) return [1.15, 1.08, 0.9];
  if (t === AMETHYST) return [1.0, 0.94, 1.06];
  return [1, 1, 1];
}

function faceTile(t: number, face: number): number {
  if (t === GRASS) {
    if (face === 2) return GRASS; // top
    if (face === 3) return DIRT; // bottom
    return GRASS_SIDE;
  }
  return t;
}

function buildVoxelGeometry(voxels: Voxel[], solid: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const v of voxels) {
    for (let f = 0; f < 6; f++) {
      const { d, c, b } = FACES[f];
      if (solid(v.x + d[0], v.y + d[1], v.z + d[2])) continue;
      const t = faceTile(v.t, f);
      const r = tileUV(t);
      const [tr, tg, tb] = tint(v.t, f);
      const jit = 0.94 + hash(v.x + f * 7, v.y, v.z) * 0.12;
      const base = pos.length / 3;
      const uvs = [
        [r.u0, r.v0],
        [r.u1, r.v0],
        [r.u1, r.v1],
        [r.u0, r.v1],
      ];
      for (let i = 0; i < 4; i++) {
        pos.push(v.x + c[i][0] - 0.5, v.y + c[i][1] - 0.5, v.z + c[i][2] - 0.5);
        uv.push(uvs[i][0], uvs[i][1]);
        col.push(b * jit * tr, b * jit * tg, b * jit * tb);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export default function VoxelBackground() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5) * 0.75);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0912, 16, 46);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
    const camBase = new THREE.Vector3(10.5, 3.6, 11.5);
    const lookBase = new THREE.Vector3(0, -0.4, 0);
    camera.position.copy(camBase);
    camera.lookAt(lookBase);
    // остров уходит влево от кнопок: смотрим правее центра
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    lookBase.addScaledVector(right, 1.9);
    camera.lookAt(lookBase);

    const atlas = new THREE.TextureLoader().load(atlasUrl);
    atlas.magFilter = THREE.NearestFilter;
    atlas.minFilter = THREE.NearestFilter;
    atlas.generateMipmaps = false;
    atlas.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true });

    const islandGroup = new THREE.Group();
    scene.add(islandGroup);

    const solid = (x: number, y: number, z: number) => density(x, y, z) > 0.02;
    const voxels = islandVoxels();
    const geo = buildVoxelGeometry(voxels, solid);
    const island = new THREE.Mesh(geo, material);
    islandGroup.add(island);

    // парящие кубы вокруг острова
    const floaters: { mesh: THREE.Mesh; r: number; y: number; a: number; s: number; spin: number }[] = [];
    const floatTiles = [AMETHYST, AMETHYST, GLOWSTONE, AMETHYST, GRASS, AMETHYST, MOSSY];
    floatTiles.forEach((t, i) => {
      const g = buildVoxelGeometry([{ x: 0, y: 0, z: 0, t }], () => false);
      const m = new THREE.Mesh(g, material);
      const a = (i / floatTiles.length) * Math.PI * 2 + hash(i, 1, 2) * 1.2;
      const f = {
        mesh: m,
        r: 7.2 + hash(i, 3, 1) * 2.4,
        y: -1.2 + hash(i, 2, 5) * 3.6,
        a,
        s: 0.55 + hash(i, 7, 3) * 0.5,
        spin: 0.15 + hash(i, 4, 4) * 0.25,
      };
      m.scale.setScalar(f.s);
      islandGroup.add(m);
      floaters.push(f);
    });

    // звёздное поле
    const starGeo = new THREE.BufferGeometry();
    const starPos: number[] = [];
    const starCol: number[] = [];
    for (let i = 0; i < 420; i++) {
      const v = new THREE.Vector3(hash(i, 1, 1), hash(i, 2, 2), hash(i, 3, 3))
        .normalize()
        .multiplyScalar(34 + hash(i, 4, 4) * 26);
      starPos.push(v.x, v.y, v.z);
      const w = 0.55 + hash(i, 5, 5) * 0.45;
      const violet = hash(i, 6, 6) > 0.7;
      starCol.push(w, w * (violet ? 0.85 : 1), w * (violet ? 1.15 : 1));
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    starGeo.setAttribute("color", new THREE.Float32BufferAttribute(starCol, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ size: 0.09, sizeAttenuation: true, vertexColors: true, fog: false, transparent: true, opacity: 0.9 }),
    );
    const starGroup = new THREE.Group();
    starGroup.add(stars);
    scene.add(starGroup);

    const clock = new THREE.Clock();
    let raf = 0;
    let disposed = false;
    let frozen = false;
    let time = 0;

    // параллакс мыши
    const mouse = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    function render() {
      const px = camBase.x + mouse.x * 0.55;
      const py = camBase.y - mouse.y * 0.35;
      camera.position.set(px, py, camBase.z);
      camera.lookAt(lookBase);
      renderer.render(scene, camera);
    }

    function animate() {
      if (disposed) return;
      if (!frozen && !document.hidden) {
        const dt = Math.min(clock.getDelta(), 0.05);
        time += reduced ? 0 : dt;
        islandGroup.rotation.y = time * 0.055;
        islandGroup.position.y = Math.sin(time * 0.45) * 0.16;
        islandGroup.rotation.z = Math.sin(time * 0.22) * 0.03;
        for (const f of floaters) {
          const a = f.a + time * 0.06;
          f.mesh.position.set(Math.cos(a) * f.r, f.y + Math.sin(time * 0.6 + f.a) * 0.22, Math.sin(a) * f.r);
          f.mesh.rotation.y = time * f.spin;
          f.mesh.rotation.x = time * f.spin * 0.6;
        }
        starGroup.rotation.y = time * 0.008;
        render();
        if (reduced) frozen = true;
      }
      raf = requestAnimationFrame(animate);
    }

    function resize() {
      const w = host!.clientWidth || 1;
      const h = host!.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      if (reduced) render();
    }
    resize();
    raf = requestAnimationFrame(animate);

    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      ro.disconnect();
      geo.dispose();
      starGeo.dispose();
      material.dispose();
      atlas.dispose();
      for (const f of floaters) f.mesh.geometry.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} className="absolute inset-0 pointer-events-none" aria-hidden="true" />;
}
