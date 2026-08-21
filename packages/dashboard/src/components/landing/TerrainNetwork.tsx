import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * TerrainNetwork — the hero's live-infrastructure visualization (master-brief
 * §MAIN 3D VISUALIZATION): a procedurally displaced Three.js mountain terrain
 * (layered FBM noise, irregular, peaks center-right) rendered as near-black
 * ground + faint wireframe + star-dust vertices, with EMISSIVE NETWORK PATHS
 * flowing over the topology (green healthy, orange warning, red critical,
 * purple AI), glowing service nodes, and a FEW slow signal particles drifting
 * along the paths. Every ~16s a subtle incident plays out on the API Gateway
 * path: node warms to red, the path pulses, its particles hurry, then it
 * recovers. Camera drifts almost imperceptibly and parallaxes 1–3% with the
 * mouse. Reduced motion or missing WebGL → static fallback.
 */

const COLORS = {
  healthy: '#22C55E',
  warning: '#F16524',
  critical: '#EF4444',
  ai: '#8B5CF6',
} as const;

/* ── procedural height field (deterministic) ─────────────────────────────── */

const noise2 = (x: number, z: number): number =>
  Math.sin(x * 1.35 + Math.sin(z * 1.05) * 1.7) *
  Math.cos(z * 0.95 + Math.sin(x * 0.75) * 1.35);

/** Layered ridged FBM + mountain mask: tall center-right/back, flat front-left. */
function heightAt(x: number, z: number): number {
  let h = 0;
  let amp = 1;
  let f = 0.42;
  for (let o = 0; o < 4; o++) {
    h += (1 - Math.abs(noise2(x * f + o * 11.3, z * f - o * 7.1))) * amp;
    amp *= 0.52;
    f *= 2.05;
  }
  h /= 1.9;
  const mask = 0.12 + 0.88 * Math.max(0, 1 - Math.hypot((x - 3.2) / 11.5, (z + 4.2) / 8.5));
  return Math.pow(h, 1.7) * mask * 3.1;
}

/** Terrain-following path through XZ waypoints, floated slightly above ground. */
function makePath(points: Array<[number, number]>): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 0.07, z)),
  );
}

interface PathSpec {
  color: string;
  curve: THREE.CatmullRomCurve3;
  motes: number;
}

/* ── scene ───────────────────────────────────────────────────────────────── */

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function Scene({ reduced }: { reduced: boolean }) {
  const { camera } = useThree();

  const terrain = useMemo(() => {
    const geo = new THREE.PlaneGeometry(30, 19, 190, 120);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
    }
    pos.needsUpdate = true;
    return geo;
  }, []);

  const paths = useMemo<PathSpec[]>(
    () => [
      { color: COLORS.healthy, motes: 2, curve: makePath([[-9, 5], [-5.5, 2.5], [-2, 1.5], [1.5, -0.5], [4.5, -2.5]]) },
      { color: COLORS.healthy, motes: 1, curve: makePath([[-7, -2], [-3.5, -3], [0.5, -4.2], [4, -5]]) },
      { color: COLORS.warning, motes: 2, curve: makePath([[8.5, 4.5], [5.5, 2.2], [3, 0], [1.5, -2.6], [2.5, -5]]) },
      { color: COLORS.warning, motes: 1, curve: makePath([[-1, 6], [1.5, 3.5], [3.8, 1.2], [6.5, -1]]) },
      { color: COLORS.critical, motes: 1, curve: makePath([[7.5, -0.5], [6, -2.2], [6.8, -4.2], [8.5, -3]]) },
      { color: COLORS.ai, motes: 2, curve: makePath([[-6, 7], [-2.5, 5], [0.5, 2.2], [2.5, -1], [1, -4]]) },
    ],
    [],
  );

  const nodes = useMemo(
    () => [
      { pos: new THREE.Vector3(-5.5, heightAt(-5.5, 2.5) + 0.1, 2.5), color: COLORS.healthy },
      { pos: new THREE.Vector3(4, heightAt(4, -5) + 0.1, -5), color: COLORS.healthy },
      { pos: new THREE.Vector3(3, heightAt(3, 0) + 0.1, 0), color: COLORS.warning },
      { pos: new THREE.Vector3(6.5, heightAt(6.5, -1) + 0.1, -1), color: COLORS.warning },
      { pos: new THREE.Vector3(6.8, heightAt(6.8, -4.2) + 0.1, -4.2), color: COLORS.critical },
      { pos: new THREE.Vector3(0.5, heightAt(0.5, 2.2) + 0.1, 2.2), color: COLORS.ai },
    ],
    [],
  );

  const tex = useMemo(glowTexture, []);
  const incidentTube = useRef<THREE.Mesh | null>(null);
  const incidentNode = useRef<THREE.Sprite | null>(null);
  const moteRefs = useRef<THREE.Sprite[]>([]);
  const nodeRefs = useRef<THREE.Sprite[]>([]);
  const world = useRef<THREE.Group>(null);
  const moteState = useRef(
    paths.flatMap((p, pi) =>
      Array.from({ length: p.motes }, (_, k) => ({
        path: pi,
        u: (k * 0.47 + pi * 0.19) % 1,
        speed: 0.014 + (pi % 3) * 0.004, // slow — "few and slow"
      })),
    ),
  );

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;

    // near-imperceptible drift + 1-3% mouse parallax
    camera.position.x = state.pointer.x * 0.45 + Math.sin(t * 0.05) * 0.15;
    camera.position.y = 4.6 - state.pointer.y * 0.22;
    camera.lookAt(0.8, 0.4, -1.5);
    if (world.current) world.current.rotation.y = Math.sin(t * 0.03) * 0.012;

    // incident cycle every 16s on the API-Gateway (warning) path
    const cycle = (t % 16) / 16;
    const hot = cycle > 0.45 && cycle < 0.75 ? Math.sin(((cycle - 0.45) / 0.3) * Math.PI) : 0;
    if (incidentTube.current) {
      const m = incidentTube.current.material as THREE.MeshBasicMaterial;
      m.color.set(COLORS.warning).lerp(new THREE.Color(COLORS.critical), hot);
      m.opacity = 0.45 + hot * 0.45 + Math.sin(t * 2.2) * 0.05;
    }
    if (incidentNode.current) {
      incidentNode.current.scale.setScalar(0.55 + hot * 0.5 + Math.sin(t * 3) * 0.04);
      (incidentNode.current.material as THREE.SpriteMaterial).color
        .set(COLORS.warning)
        .lerp(new THREE.Color(COLORS.critical), hot);
    }

    // slow signal motes; the incident path's motes hurry while hot
    moteState.current.forEach((m, i) => {
      const sp = moteRefs.current[i];
      if (!sp) return;
      const rush = m.path === 2 ? 1 + hot * 2.2 : 1;
      m.u = (m.u + m.speed * rush * (1 / 60)) % 1;
      sp.position.copy(paths[m.path].curve.getPointAt(m.u));
      sp.position.y += 0.05;
    });

    // service nodes breathe softly
    nodeRefs.current.forEach((sp, i) => {
      if (sp && i !== 2) sp.scale.setScalar(0.42 + Math.sin(t * 1.1 + i * 1.7) * 0.05);
    });
  });

  return (
    <group ref={world}>
      <fog attach="fog" args={['#050505', 9, 27]} />
      {/* solid near-black ground so the mountain reads as mass, not mesh */}
      <mesh geometry={terrain} position={[0, -0.02, 0]}>
        <meshBasicMaterial color="#0a0a0d" />
      </mesh>
      {/* faint wireframe topology */}
      <mesh geometry={terrain}>
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.065} />
      </mesh>
      {/* star-dust vertices */}
      <points geometry={terrain}>
        <pointsMaterial
          color="#aab0c8"
          size={0.036}
          sizeAttenuation
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </points>
      {/* emissive dependency paths over the terrain */}
      {paths.map((p, i) => (
        <mesh
          key={i}
          ref={i === 2 ? incidentTube : undefined}
          geometry={new THREE.TubeGeometry(p.curve, 110, 0.014, 6, false)}
        >
          <meshBasicMaterial
            color={p.color}
            transparent
            opacity={0.5}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
      {/* glowing service nodes */}
      {nodes.map((n, i) => (
        <sprite
          key={i}
          position={n.pos}
          scale={0.42}
          ref={(s) => {
            if (s) nodeRefs.current[i] = s;
            if (i === 2 && s) incidentNode.current = s;
          }}
        >
          <spriteMaterial
            map={tex}
            color={n.color}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      ))}
      {/* the few slow signal motes */}
      {moteState.current.map((m, i) => (
        <sprite
          key={i}
          scale={0.16}
          ref={(s) => {
            if (s) moteRefs.current[i] = s;
          }}
        >
          <spriteMaterial
            map={tex}
            color={paths[m.path].color}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      ))}
    </group>
  );
}

/* ── shell ───────────────────────────────────────────────────────────────── */

export function TerrainNetwork({ className }: { className?: string }) {
  const [webgl] = useState(() => {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  });
  const [reduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  if (!webgl) {
    // static fallback: layered dark gradient suggesting the ridgeline
    return (
      <div
        aria-hidden
        className={`absolute inset-0 ${className ?? ''}`}
        style={{
          background:
            'radial-gradient(60% 55% at 68% 42%, rgba(139,92,246,0.14), transparent 65%), radial-gradient(45% 45% at 82% 60%, rgba(239,68,68,0.10), transparent 70%), linear-gradient(200deg, #0b0b0f 0%, #050505 60%)',
        }}
      />
    );
  }

  return (
    <div aria-hidden className={`absolute inset-0 ${className ?? ''}`}>
      <Canvas
        dpr={[1, 1.75]}
        frameloop={reduced ? 'demand' : 'always'}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 42, position: [0, 4.6, 9.5], near: 0.1, far: 40 }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x000000, 0);
          camera.lookAt(0.8, 0.4, -1.5);
        }}
      >
        <Scene reduced={reduced} />
      </Canvas>
    </div>
  );
}
