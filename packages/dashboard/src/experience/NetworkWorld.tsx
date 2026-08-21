import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import { clamp01, type WorldState } from './worldState';

/**
 * NetworkWorld — the production infrastructure as a living 3D environment
 * (reference brief: "data should exist spatially… actual nodes connected
 * around the 3D environment"). Five named service nodes + minor satellites sit
 * on a dim wireframe ground plane, joined by connection lines with pulses
 * travelling along them. The world REACTS to the story:
 *
 *   hero      — fades in beneath the diamond, calm breathing
 *   break     — the payment node FAILS: turns red, its links jitter and snap
 *   engine    — investigation: the broken region is inspected, then re-links
 *               (fix) and steadies (verify)
 *   data/movie— recedes into the distance, background signal
 *   proof     — quiet constellation backdrop
 *   finale    — returns, whole, faintly green → almost invisible
 *
 * All animation is applied imperatively by `updateNetwork` from the scene's
 * render function (driven by scroll; no rAF dependency).
 */

const FAIL = new THREE.Color('#FF3B30');
const OK = new THREE.Color('#8a857e');
const ORANGE = new THREE.Color('#F16524');
const GREEN = new THREE.Color('#52D273');

export interface ServiceNode {
  name: string;
  pos: THREE.Vector3;
  major: boolean;
}

/** Deterministic node layout — a loose constellation below/around center. */
export function makeNodes(): ServiceNode[] {
  const majors: Array<[string, number, number, number]> = [
    ['payment', 1.9, -1.15, -1.2],
    ['auth', -2.3, -1.0, -1.8],
    ['checkout', 0.4, -1.55, -0.6],
    ['billing', -1.0, -0.75, -2.6],
    ['notifications', 3.1, -0.65, -2.4],
  ];
  const nodes: ServiceNode[] = majors.map(([name, x, y, z]) => ({
    name,
    pos: new THREE.Vector3(x, y, z),
    major: true,
  }));
  let seed = 31;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 11; i++) {
    nodes.push({
      name: '',
      pos: new THREE.Vector3(
        (rand() - 0.5) * 9,
        -0.4 - rand() * 1.6,
        -0.5 - rand() * 4,
      ),
      major: false,
    });
  }
  return nodes;
}

/** Edges: each node links to its 2 nearest neighbours (deduplicated). */
export function makeEdges(nodes: ServiceNode[]): Array<[number, number]> {
  const edges = new Set<string>();
  const out: Array<[number, number]> = [];
  nodes.forEach((n, i) => {
    const near = nodes
      .map((m, j) => ({ j, d: n.pos.distanceTo(m.pos) }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const e of near) {
      const key = [Math.min(i, e.j), Math.max(i, e.j)].join('-');
      if (!edges.has(key)) {
        edges.add(key);
        out.push([Math.min(i, e.j), Math.max(i, e.j)]);
      }
    }
  });
  return out;
}

export interface NetworkRefs {
  root: THREE.Group;
  halo: THREE.Sprite;
  nodeMeshes: THREE.Mesh[];
  lines: THREE.LineSegments;
  pulses: THREE.Points;
  grid: THREE.LineSegments;
  nodes: ServiceNode[];
  edges: Array<[number, number]>;
}

/** Per-frame world reaction. `t` is ambient time, failing node index 0 (payment). */
export function updateNetwork(net: NetworkRefs, w: WorldState, t: number): void {
  const { act, ap } = w;

  // -- global presence -------------------------------------------------------
  let presence = 0; // 0 hidden → 1 fully present
  let recede = 0; // pushes the world away/down
  if (act === 0) presence = clamp01(ap * 2 - 0.7);
  else if (act === 1 || act === 2) presence = 1;
  else if (act === 3) { presence = 0.55; recede = 0.5; }
  else if (act === 4 || act === 5) { presence = 0.35; recede = 1; }
  else if (act === 6) { presence = 0.2; recede = 1; }
  else if (act === 7) presence = 0.45;
  else if (act === 8) presence = clamp01(0.6 - ap * 0.6);
  net.root.visible = presence > 0.02;
  if (!net.root.visible) return;
  net.root.position.y = -recede * 1.4;
  net.root.position.z = -recede * 2.2;

  // -- incident state --------------------------------------------------------
  // break act: payment (node 0) fails from ap~0.25; engine act: investigate →
  // fix at ap~0.55 → verified by ap~0.9; elsewhere healthy.
  let fail = 0; // 0 healthy → 1 fully failed
  let heal = 0; // 0 → 1 repaired (green)
  if (act === 1) fail = clamp01(ap * 3 - 0.75);
  else if (act === 2) {
    fail = clamp01(1 - Math.max(0, ap - 0.35) * 3.2);
    heal = clamp01((ap - 0.45) * 4);
  } else if (act > 2 && act < 8) heal = 0.6;
  else if (act === 8) heal = 1;

  const flicker = fail > 0.02 ? 0.75 + Math.abs(Math.sin(t * 9 + 1)) * 0.25 : 1;

  // -- nodes -----------------------------------------------------------------
  net.nodeMeshes.forEach((mesh, i) => {
    const node = net.nodes[i];
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const isFailing = i === 0 && fail > 0.02;
    if (isFailing) {
      mat.color.copy(FAIL).multiplyScalar(flicker);
      // the failing node shakes
      mesh.position.set(
        node.pos.x + Math.sin(t * 31) * 0.05 * fail,
        node.pos.y + Math.cos(t * 27) * 0.05 * fail,
        node.pos.z,
      );
    } else {
      mat.color.copy(OK).lerp(GREEN, heal * (i === 0 ? 1 : 0.45));
      const breathe = 1 + Math.sin(t * 0.9 + i * 1.3) * 0.12;
      mesh.position.copy(node.pos);
      mesh.scale.setScalar(
        (node.major ? 0.07 : 0.04) * breathe * (i === 0 && heal > 0.3 ? 1.9 : 1),
      );
    }
    if (isFailing) mesh.scale.setScalar(0.2 * flicker);
    mat.opacity = presence * (node.major ? 0.95 : 0.55);
  });

  // -- edges -----------------------------------------------------------------
  const lpos = (net.lines.geometry.getAttribute('position') as THREE.BufferAttribute)
    .array as Float32Array;
  const lcol = (net.lines.geometry.getAttribute('color') as THREE.BufferAttribute)
    .array as Float32Array;
  net.edges.forEach(([a, b], e) => {
    const A = net.nodeMeshes[a].position;
    const B = net.nodeMeshes[b].position;
    const touchesFail = (a === 0 || b === 0) && fail > 0.02;
    // snapped links: the failing node's edges tear apart (gap in the middle)
    const gap = touchesFail ? 0.25 * fail : 0;
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    const mz = (A.z + B.z) / 2;
    lpos[e * 6] = A.x + (mx - A.x) * (touchesFail ? 1 - gap : 0) * 0 + 0; // start stays
    lpos[e * 6] = A.x;
    lpos[e * 6 + 1] = A.y;
    lpos[e * 6 + 2] = A.z;
    lpos[e * 6 + 3] = touchesFail ? mx + (Math.sin(t * 23 + e) * 0.1 * fail) : B.x;
    lpos[e * 6 + 4] = touchesFail ? my + (Math.cos(t * 19 + e) * 0.1 * fail) : B.y;
    lpos[e * 6 + 5] = touchesFail ? mz : B.z;
    const c = touchesFail
      ? FAIL
      : heal > 0 && (a === 0 || b === 0)
        ? GREEN
        : OK;
    const alpha = touchesFail ? flicker : 0.75;
    for (const k of [0, 1]) {
      lcol[e * 6 + k * 3] = c.r * alpha;
      lcol[e * 6 + k * 3 + 1] = c.g * alpha;
      lcol[e * 6 + k * 3 + 2] = c.b * alpha;
    }
  });
  (net.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  (net.lines.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  (net.lines.material as THREE.LineBasicMaterial).opacity =
    presence * (fail > 0.02 ? 0.85 : 0.35);

  // -- pulses travelling along edges ----------------------------------------
  const ppos = (net.pulses.geometry.getAttribute('position') as THREE.BufferAttribute)
    .array as Float32Array;
  net.edges.forEach(([a, b], e) => {
    const A = net.nodeMeshes[a].position;
    const B = net.nodeMeshes[b].position;
    const u = (t * 0.22 + e * 0.37 + w.wp * 2) % 1;
    ppos[e * 3] = A.x + (B.x - A.x) * u;
    ppos[e * 3 + 1] = A.y + (B.y - A.y) * u;
    ppos[e * 3 + 2] = A.z + (B.z - A.z) * u;
  });
  (net.pulses.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  const pmat = net.pulses.material as THREE.PointsMaterial;
  pmat.opacity = presence * (fail > 0.3 ? 0.15 : 0.8);
  pmat.color.copy(fail > 0.3 ? FAIL : heal > 0.5 ? GREEN : ORANGE);

  // status halo hugging the payment node — the failure/recovery focal point
  net.halo.position.copy(net.nodeMeshes[0].position);
  const haloMat = net.halo.material as THREE.SpriteMaterial;
  if (fail > 0.02) {
    net.halo.visible = true;
    net.halo.scale.setScalar(1.1 + Math.sin(t * 7) * 0.15);
    haloMat.color.copy(FAIL);
    haloMat.opacity = 0.75 * fail * flicker * presence;
  } else if (heal > 0.15) {
    net.halo.visible = true;
    net.halo.scale.setScalar(0.9);
    haloMat.color.copy(GREEN);
    haloMat.opacity = 0.5 * heal * presence;
  } else {
    net.halo.visible = false;
  }

  net.grid.visible = presence > 0.05;
  (net.grid.material as THREE.LineBasicMaterial).opacity = presence * 0.07;
}

/** Dim wireframe ground plane (the "floor" of the world). */
function makeGridGeometry(): THREE.BufferGeometry {
  const size = 16;
  const div = 20;
  const pts: number[] = [];
  const step = size / div;
  for (let i = 0; i <= div; i++) {
    const p = -size / 2 + i * step;
    pts.push(p, 0, -size / 2, p, 0, size / 2);
    pts.push(-size / 2, 0, p, size / 2, 0, p);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

/** Soft radial sprite texture for the status halo. */
function makeHaloTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function NetworkWorldGroup({ onReady }: { onReady: (refs: NetworkRefs) => void }) {
  const nodes = useMemo(makeNodes, []);
  const haloTex = useMemo(makeHaloTexture, []);
  const edges = useMemo(() => makeEdges(nodes), [nodes]);
  const gridGeom = useMemo(makeGridGeometry, []);
  const built = useRef(false);

  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(edges.length * 6, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(edges.length * 6, 3));
    return g;
  }, [edges]);
  const pulseGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(edges.length * 3, 3));
    return g;
  }, [edges]);

  const rootRef = useRef<THREE.Group | null>(null);
  const linesRef = useRef<THREE.LineSegments | null>(null);
  const pulsesRef = useRef<THREE.Points | null>(null);
  const gridRef = useRef<THREE.LineSegments | null>(null);
  const haloRef = useRef<THREE.Sprite | null>(null);
  const meshRefs = useRef<THREE.Mesh[]>([]);

  const tryReady = (): void => {
    if (built.current) return;
    if (
      rootRef.current &&
      linesRef.current &&
      pulsesRef.current &&
      gridRef.current &&
      haloRef.current &&
      meshRefs.current.filter(Boolean).length === nodes.length
    ) {
      built.current = true;
      onReady({
        root: rootRef.current,
        halo: haloRef.current,
        nodeMeshes: meshRefs.current,
        lines: linesRef.current,
        pulses: pulsesRef.current,
        grid: gridRef.current,
        nodes,
        edges,
      });
    }
  };

  return (
    <group ref={(r) => { rootRef.current = r; tryReady(); }} visible={false}>
      <lineSegments
        ref={(r) => { gridRef.current = r as THREE.LineSegments; tryReady(); }}
        geometry={gridGeom}
        position={[0, -2.1, -2]}
      >
        <lineBasicMaterial color="#ffffff" transparent opacity={0.07} depthWrite={false} />
      </lineSegments>
      {nodes.map((n, i) => (
        <mesh
          key={i}
          position={n.pos}
          ref={(r) => { if (r) meshRefs.current[i] = r; tryReady(); }}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial color="#8a857e" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      ))}
      {nodes
        .filter((n) => n.major)
        .map((n) => (
          <Text
            key={n.name}
            position={[n.pos.x, n.pos.y - 0.22, n.pos.z]}
            fontSize={0.11}
            color="#8a857e"
            fillOpacity={0.75}
            anchorX="center"
            anchorY="top"
            letterSpacing={0.2}
          >
            {n.name.toUpperCase()}
          </Text>
        ))}
      <lineSegments
        ref={(r) => { linesRef.current = r as THREE.LineSegments; tryReady(); }}
        geometry={lineGeom}
      >
        <lineBasicMaterial vertexColors transparent opacity={0.35} depthWrite={false} />
      </lineSegments>
      <sprite
        ref={(r) => { haloRef.current = r as THREE.Sprite; tryReady(); }}
        visible={false}
      >
        <spriteMaterial
          map={haloTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0}
        />
      </sprite>
      <points
        ref={(r) => { pulsesRef.current = r as THREE.Points; tryReady(); }}
        geometry={pulseGeom}
      >
        <pointsMaterial
          color="#F16524"
          size={0.06}
          transparent
          opacity={0.8}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </group>
  );
}
