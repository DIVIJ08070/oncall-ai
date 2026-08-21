import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useCursor, useGLTF } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MeshSurfaceSampler } from 'three-stdlib';
import * as THREE from 'three';
import type { Learning } from '../../../api/learnings';

/**
 * NeuralCore — a REAL anatomical human brain (HuBMAP / Allen Brain Atlas
 * reference model, CC BY 4.0 — see public/models/ATTRIBUTION.md) suspended in
 * a dark research chamber. The mesh is the hero: dark, wet, organic, with
 * purple/blue rim light. Neural life is built FROM the actual geometry —
 * thousands of neurons sampled on the cortex surface, fibers between
 * neighbours, electrical signals travelling neuron chains, real learnings as
 * bright orange memories (red = corrected) you can hover and click. A slow
 * scanner ring, floor platform and energy column set the lab; density of
 * connections and signals grows with the evolution level.
 */

export interface NeuralCoreProps {
  learnings: Learning[];
  level: number;
  onSelect?: (l: Learning | null) => void;
  className?: string;
}

const BRAIN_URL = '/models/brain.glb';
const NEURONS = 3600;
const MAX_MEMORIES = 64;

const COL_EXISTING = new THREE.Color('#3b82f6'); // blue — existing knowledge
const COL_LEARNED = new THREE.Color('#8B5CF6'); // purple — learned
const COL_ACTIVE = new THREE.Color('#F16524'); // orange — active learning
const COL_OK = new THREE.Color('#52D273'); // green — successful
const COL_BAD = new THREE.Color('#FF3B30'); // red — problem

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

/* ── neural system derived from the real mesh surface ───────────────────── */

interface NeuralSystem {
  brainGeom: THREE.BufferGeometry; // normalized anatomical mesh
  neurons: THREE.BufferGeometry; // sampled surface points (vertex-colored)
  fibers: THREE.BufferGeometry; // thin connections between neighbours
  walks: THREE.Vector3[][]; // signal paths (chains of neighbours)
  memorySlots: Array<{ pos: THREE.Vector3 }>;
}

function buildNeuralSystem(scene: THREE.Group, level: number): NeuralSystem {
  // collect the largest mesh from the GLB and bake its world transform
  scene.updateMatrixWorld(true);
  let source: THREE.Mesh | null = null;
  let maxVerts = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const n = (m.geometry.getAttribute('position') as THREE.BufferAttribute).count;
      if (n > maxVerts) {
        maxVerts = n;
        source = m;
      }
    }
  });
  if (!source) throw new Error('brain.glb contains no mesh');
  const src = source as THREE.Mesh;
  const brainGeom = (src.geometry as THREE.BufferGeometry).clone();
  brainGeom.applyMatrix4(src.matrixWorld);

  // normalize: center at origin, longest axis → ~3.1 world units
  brainGeom.computeBoundingBox();
  const bb = brainGeom.boundingBox!;
  const center = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  const scale = 3.1 / Math.max(size.x, size.y, size.z);
  brainGeom.translate(-center.x, -center.y, -center.z);
  brainGeom.scale(scale, scale, scale);
  brainGeom.computeVertexNormals();

  // sample neurons ON the anatomical surface
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(brainGeom)).build();
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const pts: THREE.Vector3[] = [];
  const positions = new Float32Array(NEURONS * 3);
  const colors = new Float32Array(NEURONS * 3);
  const tmp = new THREE.Color();
  const learnedFrac = 0.12 + Math.min(level, 5) * 0.07;
  for (let i = 0; i < NEURONS; i++) {
    sampler.sample(pos, nrm);
    pos.addScaledVector(nrm, 0.012); // sit just above the wet surface
    pts.push(pos.clone());
    positions.set([pos.x, pos.y, pos.z], i * 3);
    const roll = Math.random();
    tmp.copy(
      roll < learnedFrac
        ? COL_LEARNED
        : roll < learnedFrac + 0.02
          ? COL_OK
          : roll < learnedFrac + 0.035
            ? COL_ACTIVE
            : COL_EXISTING,
    );
    tmp.multiplyScalar(0.25 + Math.random() * 0.75);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const neurons = new THREE.BufferGeometry();
  neurons.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  neurons.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // neighbour graph via spatial hash (surface-following fibers)
  const cell = 0.22;
  const hash = new Map<string, number[]>();
  const keyOf = (p: THREE.Vector3): string =>
    `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
  pts.forEach((p, i) => {
    const k = keyOf(p);
    const a = hash.get(k);
    if (a) a.push(i);
    else hash.set(k, [i]);
  });
  const nearest = (i: number): number => {
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
            if (j === i) continue;
            const d = p.distanceToSquared(pts[j]);
            if (d < bd) {
              bd = d;
              best = j;
            }
          }
        }
    return best;
  };
  const neighbours: number[] = [];
  const fiberCount = Math.min(NEURONS, 700 + level * 450);
  const segs: number[] = [];
  for (let i = 0; i < NEURONS; i++) {
    const j = nearest(i);
    neighbours.push(j);
    if (j >= 0 && j > i && i < fiberCount && pts[i].distanceTo(pts[j]) < 0.4) {
      segs.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z);
    }
  }
  const fibers = new THREE.BufferGeometry();
  fibers.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));

  // signal walks: chains of neighbours across the cortex
  const walks: THREE.Vector3[][] = [];
  const walkCount = 8 + Math.min(level, 5) * 3;
  for (let w = 0; w < walkCount; w++) {
    let i = Math.floor(Math.random() * NEURONS);
    const path: THREE.Vector3[] = [pts[i]];
    for (let h = 0; h < 18; h++) {
      const j = neighbours[i];
      if (j < 0) break;
      path.push(pts[j]);
      i = (j + 1 + Math.floor(Math.random() * 5)) % NEURONS;
    }
    if (path.length > 5) walks.push(path);
  }

  // memory slots: spread across the samples, lifted slightly further out
  const memorySlots: Array<{ pos: THREE.Vector3 }> = [];
  const stride = Math.floor(NEURONS / MAX_MEMORIES);
  for (let i = 0; i < MAX_MEMORIES; i++) {
    memorySlots.push({ pos: pts[(i * stride + 13) % NEURONS].clone().multiplyScalar(1.02) });
  }

  return { brainGeom, neurons, fibers, walks, memorySlots };
}

/* ── scene ──────────────────────────────────────────────────────────────── */

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
  const gltf = useGLTF(BRAIN_URL);
  const sys = useMemo(
    () => buildNeuralSystem(gltf.scene, level),
    [gltf, level],
  );
  const tex = useMemo(glowTexture, []);
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Group>(null);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const signalRefs = useRef<THREE.Sprite[]>([]);
  const neuronMat = useRef<THREE.PointsMaterial>(null);
  const signalState = useRef(
    Array.from({ length: 23 }, (_, i) => ({
      u: (i * 0.37) % 1,
      speed: 0.04 + (i % 4) * 0.03,
      burst: 1,
    })),
  );
  const [hovered, setHovered] = useState<number | null>(null);
  useCursor(hovered != null);

  useEffect(() => {
    raycaster.params.Points = { threshold: 0.075 };
  }, [raycaster]);

  const memories = useMemo(() => learnings.slice(0, MAX_MEMORIES), [learnings]);
  const memoryGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(Math.max(memories.length, 1) * 3);
    const col = new Float32Array(Math.max(memories.length, 1) * 3);
    memories.forEach((m, i) => {
      const p = sys.memorySlots[i % sys.memorySlots.length].pos;
      pos.set([p.x, p.y, p.z], i * 3);
      const c = m.rating < 0 ? COL_BAD : COL_ACTIVE;
      col.set([c.r, c.g, c.b], i * 3);
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setDrawRange(0, memories.length);
    return g;
  }, [memories, sys]);

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    if (group.current) {
      // biological breathing — barely there
      const breathe = 1 + Math.sin(t * (Math.PI * 2 / 4.2)) * 0.0075;
      group.current.scale.setScalar(breathe);
    }
    if (ring.current) ring.current.rotation.z = t * 0.05;
    if (neuronMat.current) {
      // electrical flicker across the network
      neuronMat.current.opacity = 0.86 + Math.sin(t * 7.3) * 0.05 + Math.sin(t * 2.1) * 0.04;
    }
    signalState.current.forEach((s, i) => {
      const sp = signalRefs.current[i];
      const walk = sys.walks[i % sys.walks.length];
      if (!sp || !walk) return;
      // some signals suddenly accelerate
      if (Math.random() < 0.004) s.burst = 2.6;
      s.burst += (1 - s.burst) * 0.02;
      s.u += s.speed * s.burst * (1 / 60);
      if (s.u >= 1) s.u = 0;
      const ft = s.u * (walk.length - 1);
      const fi = Math.min(walk.length - 2, Math.floor(ft));
      sp.position.lerpVectors(walk[fi], walk[fi + 1], ft - fi);
      (sp.material as THREE.SpriteMaterial).opacity =
        (0.35 + Math.sin(s.u * Math.PI) * 0.55) * (s.burst > 1.3 ? 1 : 0.8);
    });
  });

  const hoveredLearning = hovered != null ? memories[hovered] : null;
  const hoveredPos = hovered != null ? sys.memorySlots[hovered % sys.memorySlots.length].pos : null;

  return (
    <>
      {/* lab lighting: darkness + purple/blue rim, faint key */}
      <ambientLight intensity={0.25} color="#4c4361" />
      <directionalLight position={[4, 3, 2]} intensity={0.5} color="#cfd6ff" />
      <pointLight position={[-4.5, 1, -2]} intensity={22} color="#8B5CF6" />
      <pointLight position={[4.5, -1.5, -2.5]} intensity={14} color="#3b82f6" />
      <pointLight position={[0, -3, 1]} intensity={5} color="#8B5CF6" />
      <fog attach="fog" args={['#030405', 6.5, 16]} />

      <group ref={group}>
        {/* THE BRAIN — real anatomy, dark and wet */}
        <mesh geometry={sys.brainGeom}>
          <meshStandardMaterial
            color="#171221"
            roughness={0.32}
            metalness={0.18}
            envMapIntensity={0.4}
          />
        </mesh>
        {/* neurons sampled on the cortex */}
        <points geometry={sys.neurons}>
          <pointsMaterial
            ref={neuronMat}
            vertexColors
            size={0.022}
            sizeAttenuation
            transparent
            opacity={0.9}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </points>
        {/* neural fibers between neighbours */}
        <lineSegments geometry={sys.fibers}>
          <lineBasicMaterial
            color="#6d5bd0"
            transparent
            opacity={0.14}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
        {/* electrical signals travelling neuron chains */}
        {!reduced &&
          signalState.current.map((_, i) => (
            <sprite
              key={i}
              scale={0.075}
              ref={(s) => {
                if (s) signalRefs.current[i] = s;
              }}
            >
              <spriteMaterial
                map={tex}
                color={i % 5 === 0 ? '#ffffff' : i % 5 === 4 ? '#52D273' : '#F16524'}
                transparent
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </sprite>
          ))}
        {/* real learnings as bright memories on the cortex */}
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
              size={0.09}
              sizeAttenuation
              transparent
              opacity={1}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </points>
        )}
        {hoveredLearning && hoveredPos && (
          <>
            <sprite position={hoveredPos} scale={0.3}>
              <spriteMaterial
                map={tex}
                color={hoveredLearning.rating < 0 ? '#FF3B30' : '#F16524'}
                transparent
                opacity={0.9}
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

      {/* scanner ring behind the chamber, rotating imperceptibly */}
      <group ref={ring} position={[0, 0.1, -2.6]}>
        <mesh>
          <torusGeometry args={[2.7, 0.05, 12, 96]} />
          <meshStandardMaterial color="#141824" roughness={0.4} metalness={0.8} />
        </mesh>
        <mesh>
          <torusGeometry args={[2.45, 0.012, 8, 96]} />
          <meshBasicMaterial
            color="#3b82f6"
            transparent
            opacity={0.35}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        {Array.from({ length: 8 }, (_, k) => (
          <mesh key={k} rotation={[0, 0, (k / 8) * Math.PI * 2]} position={[0, 0, 0]}>
            <boxGeometry args={[0.02, 5.6, 0.02]} />
            <meshStandardMaterial color="#0d1017" roughness={0.6} metalness={0.7} />
          </mesh>
        ))}
      </group>

      {/* containment platform + energy column */}
      <mesh position={[0, -2.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.5, 48]} />
        <meshStandardMaterial color="#0b0d14" roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[0, -2.32, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.1, 1.22, 48]} />
        <meshBasicMaterial
          color="#8B5CF6"
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, -1.9, 0]}>
        <cylinderGeometry args={[0.1, 0.24, 0.9, 20, 1, true]} />
        <meshBasicMaterial
          color="#7a5cf0"
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <OrbitControls
        ref={controls}
        enablePan={false}
        minDistance={4}
        maxDistance={9}
        autoRotate={!reduced}
        autoRotateSpeed={0.5}
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

useGLTF.preload(BRAIN_URL);

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
        camera={{ fov: 38, position: [1.3, 0.6, 6.4] }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x000000, 0);
          camera.lookAt(0, 0, 0);
        }}
        onPointerMissed={() => onSelect?.(null)}
      >
        <Suspense
          fallback={
            <Html center>
              <p
                className="whitespace-nowrap text-[11px] uppercase tracking-[0.3em] text-white/40"
                style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
              >
                loading neural core…
              </p>
            </Html>
          }
        >
          <BrainScene
            learnings={learnings}
            level={level}
            onSelect={onSelect}
            reduced={reduced}
          />
        </Suspense>
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
