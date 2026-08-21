import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useCursor } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { Learning } from '../../../api/learnings';

/**
 * NeuralCore — the self-learning brain, rendered as an actual BRAIN: two
 * cortical hemispheres split by a longitudinal fissure plus a cerebellum,
 * built from ~3000 neurons joined by a synapse web. It always reads as a
 * brain — real learnings light up as bright orange MEMORY neurons on the
 * cortex (red when the lesson was a correction), wired together per error
 * class. Interactive: drag to rotate (auto-rotates when idle), scroll to
 * zoom, hover a memory for its lesson, click to open it (onSelect).
 */

export interface NeuralCoreProps {
  learnings: Learning[];
  level: number;
  onSelect?: (l: Learning | null) => void;
  className?: string;
}

const AMBIENT_COUNT = 3000;
const MAX_MEMORIES = 64;
const PULSE_COUNT = 10;

/* ── deterministic brain-shaped point cloud ─────────────────────────────── */

function makeRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Sinuous gyri/sulci field over the cortex — drives both relief and shade. */
function wrinkle(px: number, py: number, pz: number): number {
  return (
    Math.sin(px * 5.1 + 2.2 * Math.sin(py * 3.3 + pz * 1.7)) *
    Math.cos(pz * 4.6 + 1.8 * Math.sin(px * 2.4 + py * 1.3))
  );
}

/**
 * One point ON the cortex surface: ellipsoid + gyri relief + fissure + flat
 * base. Returns the fold value (-1..1) so callers can shade ridges bright and
 * sulci dark — that shading is what makes the folds READ.
 */
function corticalPoint(
  rand: () => number,
  out: THREE.Vector3,
): { p: THREE.Vector3; band: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  let l = 0;
  do {
    x = rand() * 2 - 1;
    y = rand() * 2 - 1;
    z = rand() * 2 - 1;
    l = x * x + y * y + z * z;
  } while (l > 1 || l < 0.05);
  l = Math.sqrt(l);
  x /= l;
  y /= l;
  z /= l;
  // ellipsoid radii: wider than tall, longest front-back
  let px = x * 1.15;
  let py = y * 0.92;
  let pz = z * 1.45;
  const band = wrinkle(px, py, pz); // -1..1 across sinuous fold bands
  const relief = 1 + 0.075 * band + 0.015 * (rand() - 0.5);
  const shell = 0.985 + rand() * 0.035; // SURFACE only — no interior fuzz
  px *= relief * shell;
  py *= relief * shell;
  pz *= relief * shell;
  // longitudinal fissure between hemispheres
  const side = px >= 0 ? 1 : -1;
  px = side * (Math.abs(px) * 0.93 + 0.09);
  // flatten the underside
  if (py < -0.48) py = -0.48 - (py + 0.48) * 0.3;
  // frontal + temporal taper
  if (pz > 0.85) px *= 0.88;
  return { p: out.set(px, py, pz), band };
}

/** Cerebellum: small paired lobes tucked under the back. */
function cerebellumPoint(rand: () => number, out: THREE.Vector3): THREE.Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let l = 0;
  do {
    x = rand() * 2 - 1;
    y = rand() * 2 - 1;
    z = rand() * 2 - 1;
    l = x * x + y * y + z * z;
  } while (l > 1 || l === 0);
  const folds = 1 + 0.09 * Math.sin(y * 14 + x * 6);
  const side = x >= 0 ? 1 : -1;
  return out.set(
    side * (Math.abs(x * 0.52 * folds) + 0.03),
    y * 0.3 * folds - 0.58,
    z * 0.42 * folds - 0.95,
  );
}

interface BrainGraph {
  ambient: THREE.BufferGeometry;
  synapses: THREE.BufferGeometry;
  walks: THREE.Vector3[][]; // pulse paths
  memorySlots: THREE.Vector3[];
  baseColors: Float32Array; // pristine neuron colors (cursor boost restores from here)
  basePositions: Float32Array; // pristine neuron positions (cursor ripple restores)
}

function buildBrain(level: number): BrainGraph {
  const rand = makeRand(20260821);
  const pts: THREE.Vector3[] = [];
  const bands: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < AMBIENT_COUNT; i++) {
    if (i % 8 === 7) {
      cerebellumPoint(rand, v);
      bands.push(Math.sin(v.y * 26) * 0.6); // fine cerebellar striations
    } else {
      bands.push(corticalPoint(rand, v).band);
    }
    pts.push(v.clone());
  }

  // colors: silver base, violet minority, faint ember sprinkle — brighter with level
  const positions = new Float32Array(AMBIENT_COUNT * 3);
  const colors = new Float32Array(AMBIENT_COUNT * 3);
  const silver = new THREE.Color('#9aa0b8');
  const violet = new THREE.Color('#8B5CF6');
  const ember = new THREE.Color('#F16524');
  const tmp = new THREE.Color();
  const levelBoost = 0.8 + Math.min(level, 5) * 0.05;
  for (let i = 0; i < AMBIENT_COUNT; i++) {
    positions.set([pts[i].x, pts[i].y, pts[i].z], i * 3);
    const roll = rand();
    tmp.copy(roll < 0.1 ? violet : roll < 0.15 ? ember : silver);
    // gyri catch the light, sulci fall into shadow — this sells the folds
    const shade = 0.28 + 0.72 * Math.max(0, (bands[i] + 1) / 2) ** 1.2;
    // the midline fissure stays dark
    const fissure = Math.abs(pts[i].x) < 0.17 ? 0.35 : 1;
    tmp.multiplyScalar(shade * fissure * levelBoost * (0.75 + rand() * 0.35));
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const ambient = new THREE.BufferGeometry();
  ambient.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  ambient.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // synapse web: each neuron links to its nearest same-hemisphere neighbour
  // (spatial hash for speed)
  const cell = 0.34;
  const hash = new Map<string, number[]>();
  const key = (p: THREE.Vector3): string =>
    `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
  pts.forEach((p, i) => {
    const k = key(p);
    const arr = hash.get(k);
    if (arr) arr.push(i);
    else hash.set(k, [i]);
  });
  const neighbourOf = (i: number): number => {
    const p = pts[i];
    let best = -1;
    let bd = Infinity;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    const cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const arr = hash.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j === i || pts[j].x * p.x < 0) continue; // stay in hemisphere
            const d = p.distanceToSquared(pts[j]);
            if (d < bd) {
              bd = d;
              best = j;
            }
          }
        }
    return best;
  };
  const segs: number[] = [];
  const neighbours: number[] = [];
  for (let i = 0; i < AMBIENT_COUNT; i++) {
    const j = neighbourOf(i);
    neighbours.push(j);
    if (j >= 0 && j > i) {
      segs.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z);
    }
  }
  const synapses = new THREE.BufferGeometry();
  synapses.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));

  // pulse walks: random neighbour-graph strolls across the cortex
  const walks: THREE.Vector3[][] = [];
  for (let w = 0; w < PULSE_COUNT; w++) {
    let i = Math.floor(rand() * AMBIENT_COUNT);
    const path: THREE.Vector3[] = [pts[i]];
    for (let h = 0; h < 14; h++) {
      const j = neighbours[i];
      if (j < 0) break;
      path.push(pts[j]);
      i = (j + Math.floor(rand() * 7)) % AMBIENT_COUNT;
    }
    if (path.length > 3) walks.push(path);
  }

  // memory slots: well-spread surface points for real learnings to occupy
  const memorySlots: THREE.Vector3[] = [];
  for (let i = 0; i < MAX_MEMORIES; i++) {
    corticalPoint(rand, v);
    memorySlots.push(v.clone().multiplyScalar(1.05));
  }

  return { ambient, synapses, walks, memorySlots, baseColors: colors.slice(), basePositions: positions.slice() };
}

/* ── scene ──────────────────────────────────────────────────────────────── */

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.32)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function BrainScene({
  learnings,
  level,
  onSelect,
  reduced,
}: {
  learnings: Learning[];
  level: number;
  onSelect?: (l: Learning | null) => void;
  reduced: boolean;
}) {
  const { raycaster } = useThree();
  const graph = useMemo(() => buildBrain(level), [level]);
  const tex = useMemo(glowTexture, []);
  const group = useRef<THREE.Group>(null);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const pulseRefs = useRef<THREE.Sprite[]>([]);
  const pulseState = useRef(
    Array.from({ length: PULSE_COUNT }, (_, i) => ({ u: (i * 0.31) % 1, speed: 0.05 + (i % 3) * 0.02 })),
  );
  const [hovered, setHovered] = useState<number | null>(null);
  useCursor(hovered != null);
  const touchLocal = useRef<THREE.Vector3 | null>(null);
  const touchGlow = useRef<THREE.Sprite | null>(null);
  const boosted = useRef<number[]>([]);
  const tmpV = useRef(new THREE.Vector3());

  useEffect(() => {
    raycaster.params.Points = { threshold: 0.09 };
  }, [raycaster]);

  const memories = useMemo(
    () => learnings.slice(0, MAX_MEMORIES),
    [learnings],
  );
  const memoryGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(Math.max(memories.length, 1) * 3);
    const col = new Float32Array(Math.max(memories.length, 1) * 3);
    const good = new THREE.Color('#FF8233');
    const bad = new THREE.Color('#FF3B30');
    memories.forEach((m, i) => {
      const p = graph.memorySlots[i % graph.memorySlots.length];
      pos.set([p.x, p.y, p.z], i * 3);
      const c = m.rating < 0 ? bad : good;
      col.set([c.r, c.g, c.b], i * 3);
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setDrawRange(0, memories.length);
    return g;
  }, [memories, graph]);

  // memory-to-memory wiring per error class
  const memoryLinks = useMemo(() => {
    const byClass = new Map<string, number[]>();
    memories.forEach((m, i) => {
      const k = m.errorClass.toLowerCase();
      const arr = byClass.get(k);
      if (arr) arr.push(i);
      else byClass.set(k, [i]);
    });
    const segs: number[] = [];
    byClass.forEach((idxs) => {
      for (let k = 1; k < idxs.length; k++) {
        const a = graph.memorySlots[idxs[k - 1] % graph.memorySlots.length];
        const b = graph.memorySlots[idxs[k] % graph.memorySlots.length];
        segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    return g;
  }, [memories, graph]);

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    if (group.current) {
      const breathe = 1 + Math.sin(t * 0.9) * 0.012;
      group.current.scale.setScalar(breathe);
      // the brain leans subtly toward the cursor
      group.current.rotation.y += (0.55 + state.pointer.x * 0.16 - group.current.rotation.y) * 0.06;
      group.current.rotation.x += (0.14 - state.pointer.y * 0.1 - group.current.rotation.x) * 0.06;
    }

    // ── cursor touch: nearby neurons flare, then relax ──
    const colAttr = graph.ambient.getAttribute('color') as THREE.BufferAttribute;
    const posAttr = graph.ambient.getAttribute('position') as THREE.BufferAttribute;
    const colArr = colAttr.array as Float32Array;
    const posArr = posAttr.array as Float32Array;
    if (boosted.current.length) {
      for (const i of boosted.current) {
        colArr[i * 3] = graph.baseColors[i * 3];
        colArr[i * 3 + 1] = graph.baseColors[i * 3 + 1];
        colArr[i * 3 + 2] = graph.baseColors[i * 3 + 2];
        posArr[i * 3] = graph.basePositions[i * 3];
        posArr[i * 3 + 1] = graph.basePositions[i * 3 + 1];
        posArr[i * 3 + 2] = graph.basePositions[i * 3 + 2];
      }
      boosted.current = [];
      colAttr.needsUpdate = true;
      posAttr.needsUpdate = true;
    }
    const touch = touchLocal.current;
    if (touch) {
      const R2 = 0.55 * 0.55;
      for (let i = 0; i < posAttr.count; i++) {
        const dx = posAttr.getX(i) - touch.x;
        const dy = posAttr.getY(i) - touch.y;
        const dz = posAttr.getZ(i) - touch.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < R2) {
          const fall = 1 - Math.sqrt(d2) / 0.55;
          const k = 1 + 2.4 * fall;
          colArr[i * 3] = Math.min(1, graph.baseColors[i * 3] * k);
          colArr[i * 3 + 1] = Math.min(1, graph.baseColors[i * 3 + 1] * k);
          colArr[i * 3 + 2] = Math.min(1, graph.baseColors[i * 3 + 2] * k);
          // physical reaction: the dots bulge outward and shiver under the cursor
          const bx = graph.basePositions[i * 3];
          const by = graph.basePositions[i * 3 + 1];
          const bz = graph.basePositions[i * 3 + 2];
          const len = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
          const lift = 0.16 * fall * fall;
          const jig = 0.02 * fall;
          posArr[i * 3] = bx + (bx / len) * lift + Math.sin(t * 31 + i) * jig;
          posArr[i * 3 + 1] = by + (by / len) * lift + Math.cos(t * 27 + i * 1.3) * jig;
          posArr[i * 3 + 2] = bz + (bz / len) * lift;
          boosted.current.push(i);
        }
      }
      colAttr.needsUpdate = true;
      posAttr.needsUpdate = true;
      if (touchGlow.current) {
        touchGlow.current.visible = true;
        touchGlow.current.position.copy(touch);
        touchGlow.current.scale.setScalar(0.5 + Math.sin(t * 6) * 0.06);
        (touchGlow.current.material as THREE.SpriteMaterial).opacity = 0.5;
      }
    } else if (touchGlow.current) {
      touchGlow.current.visible = false;
    }
    pulseState.current.forEach((p, i) => {
      const sp = pulseRefs.current[i];
      const walk = graph.walks[i % graph.walks.length];
      if (!sp || !walk) return;
      p.u = (p.u + p.speed * (touchLocal.current ? 1.8 : 1) * (1 / 60)) % 1;
      const ft = p.u * (walk.length - 1);
      const fi = Math.min(walk.length - 2, Math.floor(ft));
      const fr = ft - fi;
      sp.position.lerpVectors(walk[fi], walk[fi + 1], fr);
      (sp.material as THREE.SpriteMaterial).opacity = 0.55 + Math.sin(p.u * Math.PI) * 0.35;
    });
  });

  const hoveredLearning = hovered != null ? memories[hovered] : null;
  const hoveredPos =
    hovered != null ? graph.memorySlots[hovered % graph.memorySlots.length] : null;

  return (
    <>
      <group ref={group} rotation={[0.14, 0.55, 0]}>
        {/* synapse web */}
        <lineSegments geometry={graph.synapses}>
          <lineBasicMaterial
            color="#8f95ad"
            transparent
            opacity={0.1}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
        {/* neurons */}
        <points geometry={graph.ambient}>
          <pointsMaterial
            vertexColors
            size={0.032}
            sizeAttenuation
            transparent
            opacity={0.95}
            depthWrite={false}
          />
        </points>
        {/* memory wiring */}
        <lineSegments geometry={memoryLinks}>
          <lineBasicMaterial
            color="#F16524"
            transparent
            opacity={0.3}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
        {/* memory neurons — the real learnings */}
        {memories.length > 0 && (
          <points
            geometry={memoryGeom}
            onPointerMove={(e) => {
              e.stopPropagation();
              if (e.index != null) setHovered(e.index);
            }}
            onPointerOut={() => setHovered(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (e.index != null && memories[e.index]) onSelect?.(memories[e.index]);
            }}
          >
            <pointsMaterial
              vertexColors
              size={0.085}
              sizeAttenuation
              transparent
              opacity={1}
              depthWrite={false}
            />
          </points>
        )}
        {/* invisible touch surface: raycast target for cursor-on-cortex */}
        <mesh
          visible={false}
          scale={[1.18, 0.96, 1.48]}
          onPointerMove={(e) => {
            if (group.current) {
              touchLocal.current = group.current.worldToLocal(tmpV.current.copy(e.point));
            }
          }}
          onPointerOut={() => {
            touchLocal.current = null;
          }}
        >
          <sphereGeometry args={[1, 24, 24]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {/* cursor touch glow riding the cortex */}
        <sprite ref={touchGlow} visible={false} scale={0.5}>
          <spriteMaterial
            map={tex}
            color="#FF8233"
            transparent
            opacity={0.5}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
        {/* faint inner life — small, so the cortex silhouette stays crisp */}
        <sprite scale={1.1}>
          <spriteMaterial
            map={tex}
            color="#7a4be0"
            transparent
            opacity={0.08}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
        {/* thought pulses travelling the web */}
        {!reduced &&
          pulseState.current.map((_, i) => (
            <sprite
              key={i}
              scale={0.09}
              ref={(s) => {
                if (s) pulseRefs.current[i] = s;
              }}
            >
              <spriteMaterial
                map={tex}
                color={i % 3 === 0 ? '#ffffff' : '#FF8233'}
                transparent
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </sprite>
          ))}
        {/* hovered memory: tooltip + halo */}
        {hoveredLearning && hoveredPos && (
          <>
            <sprite position={hoveredPos} scale={0.32}>
              <spriteMaterial
                map={tex}
                color={hoveredLearning.rating < 0 ? '#FF3B30' : '#FF8233'}
                transparent
                opacity={0.85}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </sprite>
            <Html position={hoveredPos} center distanceFactor={5.5} zIndexRange={[30, 0]}>
              <div
                className="pointer-events-none w-max max-w-[260px] -translate-y-10 rounded-lg border border-white/15 bg-black/85 px-3 py-2 backdrop-blur-sm"
                style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
              >
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#FF8233]">
                  {hoveredLearning.errorClass} · confirmed {hoveredLearning.confirmations}×
                </p>
                <p className="mt-1 text-[11px] leading-snug text-white/80">
                  {hoveredLearning.rootCause.length > 90
                    ? `${hoveredLearning.rootCause.slice(0, 90)}…`
                    : hoveredLearning.rootCause}
                </p>
              </div>
            </Html>
          </>
        )}
      </group>
      <OrbitControls
        ref={controls}
        enablePan={false}
        minDistance={3.2}
        maxDistance={8.5}
        autoRotate={!reduced}
        autoRotateSpeed={0.7}
        onStart={() => {
          if (controls.current) controls.current.autoRotate = false;
        }}
        onEnd={() => {
          window.setTimeout(() => {
            if (controls.current && !reduced) controls.current.autoRotate = true;
          }, 2200);
        }}
      />
    </>
  );
}

/* ── shell ──────────────────────────────────────────────────────────────── */

export function NeuralCore({ learnings, level, onSelect, className }: NeuralCoreProps) {
  const [reduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return (
    <div className={className}>
      <Canvas
        dpr={[1, 1.75]}
        frameloop={reduced ? 'demand' : 'always'}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 40, position: [0, 0.4, 5.1] }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        onPointerMissed={() => onSelect?.(null)}
      >
        <BrainScene
          learnings={learnings}
          level={level}
          onSelect={onSelect}
          reduced={reduced}
        />
      </Canvas>
    </div>
  );
}

/** Soft heartbeat blip (~0.9Hz) while enabled; lazy AudioContext. */
export function useNeuralPing(enabled: boolean): void {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    const ctx = ctxRef.current;
    void ctx.resume();
    const id = window.setInterval(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }, 1100);
    return () => {
      window.clearInterval(id);
      void ctxRef.current?.suspend();
    };
  }, [enabled]);
}
