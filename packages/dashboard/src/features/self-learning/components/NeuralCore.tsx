import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useCursor } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { Learning } from '../../../api/learnings';

/**
 * NeuralCore — the self-learning brain, rendered as an actual BRAIN: two
 * cortical hemispheres split by a longitudinal fissure plus a cerebellum,
 * built from ~1500 neurons joined by a synapse web. It always reads as a
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

/** Sinuous gyri/sulci field — streamlines follow its iso-contours. */
function wrinkle(px: number, py: number, pz: number): number {
  return (
    Math.sin(px * 5.4 + 2.3 * Math.sin(py * 3.4 + pz * 1.8)) *
    Math.cos(pz * 4.8 + 1.9 * Math.sin(px * 2.5 + py * 1.4)) +
    0.45 * Math.sin(px * 9.5 + py * 7.2 + pz * 5.1)
  );
}

/** Anatomical radius shaping in unit-direction space. */
const RADII = new THREE.Vector3(1.12, 0.95, 1.42);

function surfacePoint(dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const u = dir;
  // temporal lobe bulges (sides, low, slightly forward)
  const tl =
    0.2 *
    Math.exp(
      -(
        ((Math.abs(u.x) - 0.85) * (Math.abs(u.x) - 0.85)) / 0.06 +
        ((u.y + 0.38) * (u.y + 0.38)) / 0.09 +
        ((u.z - 0.18) * (u.z - 0.18)) / 0.35
      ),
    );
  // frontal taper, occipital slight squash
  const taper = u.z > 0.6 ? 1 - (u.z - 0.6) * 0.12 : 1;
  let px = u.x * RADII.x * (1 + tl) * taper;
  let py = u.y * RADII.y * (1 + tl * 0.25);
  let pz = u.z * RADII.z;
  // longitudinal fissure
  const side = px >= 0 ? 1 : -1;
  px = side * (Math.abs(px) * 0.94 + 0.06);
  // flat underside
  if (py < -0.5) py = -0.5 - (py + 0.5) * 0.25;
  return out.set(px, py, pz);
}

/** Numeric gradient of the wrinkle field. */
function wrinkleGrad(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.02;
  return out.set(
    wrinkle(p.x + e, p.y, p.z) - wrinkle(p.x - e, p.y, p.z),
    wrinkle(p.x, p.y + e, p.z) - wrinkle(p.x, p.y - e, p.z),
    wrinkle(p.x, p.y, p.z + e) - wrinkle(p.x, p.y, p.z - e),
  );
}

interface BrainGraph {
  ambient: THREE.BufferGeometry; // sparkle nodes on the fold lines
  synapses: THREE.BufferGeometry; // the fold streamlines (as segments)
  walks: THREE.Vector3[][];
  memorySlots: THREE.Vector3[];
}

/**
 * The brain is DRAWN, hologram-style: ~230 serpentine streamlines march along
 * iso-contours of the fold field across an anatomically shaped surface
 * (hemispheres + fissure + temporal lobes), the cerebellum gets its classic
 * parallel striations, and a small brainstem drops from the base. Sparkle
 * nodes + memories + pulses ride the same lines.
 */
function buildBrain(level: number): BrainGraph {
  const rand = makeRand(20260821);
  const silver = new THREE.Color('#c9cde0');
  const violet = new THREE.Color('#a78bfa');
  const ember = new THREE.Color('#F16524');
  const tmp = new THREE.Color();
  const levelBoost = 0.78 + Math.min(level, 5) * 0.05;

  const segPos: number[] = [];
  const segCol: number[] = [];
  const nodePos: number[] = [];
  const nodeCol: number[] = [];
  const walks: THREE.Vector3[][] = [];

  const dir = new THREE.Vector3();
  const p = new THREE.Vector3();
  const g = new THREE.Vector3();
  const n = new THREE.Vector3();
  const t = new THREE.Vector3();

  const pushStream = (path: THREE.Vector3[], color: THREE.Color, bright: number): void => {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      segPos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      for (const q of [a, b]) {
        const fissure = Math.abs(q.x) < 0.14 ? 0.4 : 1;
        tmp.copy(color).multiplyScalar(bright * fissure * levelBoost);
        segCol.push(tmp.r, tmp.g, tmp.b);
      }
      if (i % 4 === 0 && rand() < 0.65) {
        nodePos.push(b.x, b.y, b.z);
        tmp.copy(color).multiplyScalar(Math.min(1.5, bright * 1.7));
        nodeCol.push(tmp.r, tmp.g, tmp.b);
      }
    }
  };

  // ── cortical streamlines: march along fold iso-contours ────────────────
  const STREAMS = 230;
  for (let sIdx = 0; sIdx < STREAMS; sIdx++) {
    // stratified seed direction, biased to upper cortex
    dir
      .set(rand() * 2 - 1, rand() * 1.7 - 0.55, rand() * 2 - 1)
      .normalize();
    surfacePoint(dir, p);
    const path: THREE.Vector3[] = [p.clone()];
    const flip = rand() < 0.5 ? -1 : 1;
    for (let step = 0; step < 64; step++) {
      wrinkleGrad(p, g);
      n.set(p.x / (RADII.x * RADII.x), p.y / (RADII.y * RADII.y), p.z / (RADII.z * RADII.z)).normalize();
      t.crossVectors(n, g);
      if (t.lengthSq() < 1e-6) break;
      t.normalize().multiplyScalar(0.045 * flip);
      // wiggle so lines stay organic
      t.addScaledVector(n, 0);
      p.add(t);
      // re-project to the anatomical surface
      dir.set(p.x / RADII.x, p.y / RADII.y, p.z / RADII.z).normalize();
      surfacePoint(dir, p);
      if (p.y < -0.62) break; // stop at the base
      path.push(p.clone());
    }
    if (path.length < 8) continue;
    const w = wrinkle(path[0].x, path[0].y, path[0].z);
    const ridge = Math.max(0, (w + 1.45) / 2.9); // ridge streams brighter
    const roll = rand();
    const col = roll < 0.12 ? violet : roll < 0.16 ? ember : silver;
    pushStream(path, col, 0.22 + 0.7 * ridge ** 1.3);
    if (walks.length < PULSE_COUNT && path.length > 20 && rand() < 0.5) walks.push(path);
  }

  // ── cerebellum: classic parallel striations ────────────────────────────
  const CB = { x: 0, y: -0.52, z: -0.98, rx: 0.52, ry: 0.3, rz: 0.4 };
  for (let row = 0; row < 14; row++) {
    const v = -1 + (2 * (row + 0.5)) / 14;
    const path: THREE.Vector3[] = [];
    for (let a = -1; a <= 1.001; a += 0.08) {
      const ang = a * Math.PI * 0.5;
      const rr = Math.sqrt(Math.max(0.03, 1 - v * v));
      const wob = 1 + 0.06 * Math.sin(a * 9 + row);
      path.push(
        new THREE.Vector3(
          CB.x + Math.sin(ang) * CB.rx * rr * wob,
          CB.y + v * CB.ry,
          CB.z + Math.cos(ang) * CB.rz * rr * wob * -1,
        ),
      );
    }
    pushStream(path, silver, 0.3 + 0.25 * Math.abs(Math.sin(row * 2.1)));
  }

  // ── brainstem: short tapered stalk ─────────────────────────────────────
  for (let k = 0; k < 7; k++) {
    const ang = (k / 7) * Math.PI * 2;
    const path: THREE.Vector3[] = [];
    for (let u = 0; u <= 1.001; u += 0.14) {
      const r = 0.14 * (1 - u * 0.45);
      path.push(
        new THREE.Vector3(
          Math.cos(ang) * r,
          -0.52 - u * 0.42,
          -0.55 + Math.sin(ang) * r - u * 0.12,
        ),
      );
    }
    pushStream(path, silver, 0.28);
  }

  const synapses = new THREE.BufferGeometry();
  synapses.setAttribute('position', new THREE.Float32BufferAttribute(segPos, 3));
  synapses.setAttribute('color', new THREE.Float32BufferAttribute(segCol, 3));
  const ambient = new THREE.BufferGeometry();
  ambient.setAttribute('position', new THREE.Float32BufferAttribute(nodePos, 3));
  ambient.setAttribute('color', new THREE.Float32BufferAttribute(nodeCol, 3));

  // memory slots on the upper cortex, well spread
  const memorySlots: THREE.Vector3[] = [];
  const mv = new THREE.Vector3();
  for (let i = 0; i < MAX_MEMORIES; i++) {
    mv.set(rand() * 2 - 1, rand() * 1.4 - 0.25, rand() * 2 - 1).normalize();
    const out = new THREE.Vector3();
    surfacePoint(mv, out);
    memorySlots.push(out.multiplyScalar(1.03));
  }

  return { ambient, synapses, walks, memorySlots };
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
    }
    pulseState.current.forEach((p, i) => {
      const sp = pulseRefs.current[i];
      const walk = graph.walks[i % graph.walks.length];
      if (!sp || !walk) return;
      p.u = (p.u + p.speed * (1 / 60)) % 1;
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
            vertexColors
            transparent
            opacity={0.85}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
        {/* neurons */}
        <points geometry={graph.ambient}>
          <pointsMaterial
            vertexColors
            size={0.026}
            sizeAttenuation
            transparent
            opacity={0.9}
            blending={THREE.AdditiveBlending}
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
