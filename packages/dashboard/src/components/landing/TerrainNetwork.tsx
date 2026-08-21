import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * TerrainNetwork — the hero mountain, matched to the user's reference image:
 * a tall, sharp wireframe massif rising diagonally to the upper-right against
 * pure black. A fine silver NET is draped over the ridges with bright dots at
 * every mesh intersection; the glow lives IN the mesh — per-vertex colors
 * paint an ember-orange/crimson flank on the right and two violet pockets —
 * with soft bloom sprites above the hot zones. Life: bloom breathing, a FEW
 * slow signal motes tracing ridge lines, a subtle ~16s incident (the crimson
 * flank flares, motes hurry), and 1–3% mouse parallax. Reduced motion / no
 * WebGL → static fallback.
 */

const SILVER = new THREE.Color('#a7abbd');
const EMBER = new THREE.Color('#ff5a28');
const CRIMSON = new THREE.Color('#ef4444');
const VIOLET = new THREE.Color('#8B5CF6');

const W_SEG = 220;
const H_SEG = 140;
const SIZE_X = 34;
const SIZE_Z = 20;

/* ── height field: sharp ridged massif rising toward upper-right ─────────── */

const noise2 = (x: number, z: number): number =>
  Math.sin(x * 1.31 + Math.sin(z * 1.07) * 1.9) *
  Math.cos(z * 0.93 + Math.sin(x * 0.71) * 1.5);

function heightAt(x: number, z: number): number {
  let h = 0;
  let amp = 1;
  let f = 0.34;
  for (let o = 0; o < 5; o++) {
    h += (1 - Math.abs(noise2(x * f + o * 13.7, z * f - o * 5.3))) * amp;
    amp *= 0.5;
    f *= 2.1;
  }
  h /= 1.94;
  // diagonal mask: flat near lower-left, massive toward upper-right (-z = back)
  const diag = THREE.MathUtils.clamp((x + 10) / 22 + (-z + 8) / 26, 0, 1.15);
  const mask = 0.06 + Math.pow(diag, 2.1) * 1.15;
  return Math.pow(h, 2.05) * mask * 6.4;
}

/** Glow pockets (world XZ): two hot flanks right, two violet accents. */
const POCKETS = [
  { x: 7.0, z: -2.0, r: 4.4, color: EMBER, hot: false },
  { x: 11.5, z: -5.5, r: 3.6, color: CRIMSON, hot: true }, // incident flank
  { x: -0.5, z: 1.0, r: 1.7, color: VIOLET, hot: false },
  { x: 4.8, z: -4.6, r: 1.3, color: VIOLET, hot: false },
];

function pocketStrength(x: number, z: number, p: (typeof POCKETS)[number]): number {
  return Math.max(0, 1 - Math.hypot((x - p.x) / p.r, (z - p.z) / p.r));
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ── scene ───────────────────────────────────────────────────────────────── */

function Scene({ reduced }: { reduced: boolean }) {
  const { camera } = useThree();

  /** Displaced, vertex-colored net: silver shaded by height, blended toward
   *  the pocket hues so the glow follows the mesh exactly like the image. */
  const terrain = useMemo(() => {
    const geo = new THREE.PlaneGeometry(SIZE_X, SIZE_Z, W_SEG, H_SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    let hMax = 0.001;
    for (let i = 0; i < pos.count; i++) hMax = Math.max(hMax, heightAt(pos.getX(i), pos.getZ(i)));
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      const shade = 0.28 + 0.72 * Math.pow(h / hMax, 0.85);
      tmp.copy(SILVER).multiplyScalar(shade);
      for (const p of POCKETS) {
        const s = Math.pow(pocketStrength(x, z, p), 1.5);
        if (s > 0.02) tmp.lerp(p.color, Math.min(0.92, s * 1.05));
      }
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, []);

  /** A handful of crest polylines for the motes to travel. */
  const crestCurves = useMemo(() => {
    const curves: THREE.CatmullRomCurve3[] = [];
    for (const z of [-6.5, -4.5, -2.5, -0.5]) {
      const pts: THREE.Vector3[] = [];
      for (let x = -12; x <= 16; x += 1.4) {
        pts.push(new THREE.Vector3(x, heightAt(x, z) + 0.06, z));
      }
      curves.push(new THREE.CatmullRomCurve3(pts));
    }
    return curves;
  }, []);

  const tex = useMemo(glowTexture, []);
  const world = useRef<THREE.Group>(null);
  const bloomRefs = useRef<THREE.Sprite[]>([]);
  const moteRefs = useRef<THREE.Sprite[]>([]);
  const motes = useRef(
    Array.from({ length: 8 }, (_, i) => ({
      curve: i % 4,
      u: (i * 0.37) % 1,
      speed: 0.011 + (i % 3) * 0.004, // few and slow
      hue: i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#ff8a5a' : '#b07bff',
    })),
  );

  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;

    // 1-3% parallax + near-imperceptible drift
    camera.position.x = -6.2 + state.pointer.x * 0.5 + Math.sin(t * 0.05) * 0.16;
    camera.position.y = 4.0 - state.pointer.y * 0.25 + Math.sin(t * 0.07) * 0.08;
    camera.lookAt(4.5, 2.8, -3);
    if (world.current) world.current.rotation.y = Math.sin(t * 0.028) * 0.01;

    // blooms breathe; the crimson flank plays a subtle ~16s incident
    const cycle = (t % 16) / 16;
    const hot = cycle > 0.45 && cycle < 0.75 ? Math.sin(((cycle - 0.45) / 0.3) * Math.PI) : 0;
    bloomRefs.current.forEach((sp, i) => {
      if (!sp) return;
      const p = POCKETS[i];
      const breathe = 0.85 + Math.sin(t * 0.5 + i * 2.1) * 0.15;
      const mat = sp.material as THREE.SpriteMaterial;
      mat.opacity = (p.hot ? 0.16 + hot * 0.3 : 0.14) * breathe;
      sp.scale.setScalar(p.r * (1.6 + (p.hot ? hot * 0.5 : 0)));
    });

    // few slow motes along the ridges; they hurry a little during the flare
    motes.current.forEach((m, i) => {
      const sp = moteRefs.current[i];
      if (!sp) return;
      m.u = (m.u + m.speed * (1 + hot * 1.6) * (1 / 60)) % 1;
      sp.position.copy(crestCurves[m.curve].getPointAt(m.u));
    });
  });

  return (
    <group ref={world} position={[0, -1.1, 0]}>
      <fog attach="fog" args={['#030304', 11, 36]} />
      {/* solid black mass under the net (occludes far side → reads as rock) */}
      <mesh geometry={terrain} position={[0, -0.03, 0]}>
        <meshBasicMaterial color="#060608" />
      </mesh>
      {/* the draped net */}
      <mesh geometry={terrain}>
        <meshBasicMaterial vertexColors wireframe transparent opacity={0.34} />
      </mesh>
      {/* bright dots at every mesh intersection */}
      <points geometry={terrain}>
        <pointsMaterial
          vertexColors
          size={0.05}
          sizeAttenuation
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </points>
      {/* soft blooms above the hot zones */}
      {POCKETS.map((p, i) => (
        <sprite
          key={i}
          position={[p.x, heightAt(p.x, p.z) + 0.5, p.z]}
          ref={(s) => {
            if (s) bloomRefs.current[i] = s;
          }}
        >
          <spriteMaterial
            map={tex}
            color={p.color}
            transparent
            opacity={0.15}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      ))}
      {/* the few slow signal motes */}
      {motes.current.map((m, i) => (
        <sprite
          key={i}
          scale={0.14}
          ref={(s) => {
            if (s) moteRefs.current[i] = s;
          }}
        >
          <spriteMaterial
            map={tex}
            color={m.hue}
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
    return (
      <div
        aria-hidden
        className={`absolute inset-0 ${className ?? ''}`}
        style={{
          background:
            'radial-gradient(55% 50% at 72% 45%, rgba(239,68,68,0.12), transparent 65%), radial-gradient(35% 35% at 45% 55%, rgba(139,92,246,0.10), transparent 70%), linear-gradient(210deg, #0a0a0d 0%, #030304 60%)',
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
        camera={{ fov: 40, position: [-6.2, 4.0, 11.5], near: 0.1, far: 50 }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x000000, 0);
          camera.lookAt(4.5, 2.8, -3);
        }}
      >
        <Scene reduced={reduced} />
      </Canvas>
    </div>
  );
}
