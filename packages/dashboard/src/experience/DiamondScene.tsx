import { useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clamp01, type WorldState } from './worldState';

/**
 * DiamondScene — the Diamond Core as a real, procedural 3D object (brief §8/§20):
 * an emissive octahedron heart inside a translucent shell, thin orbital rings,
 * an additive volumetric glow sprite, and a ~700-point particle field. The same
 * object persists across the whole experience and *evolves*:
 *
 *   dormant → power-on (hero) · detecting pulse rings (break) · investigating
 *   orbitals → fixing streams (engine) · verifying calm (data/movie) · the
 *   day-shift split (buddy) · constellation anchor (proof) · recovered (finale)
 *
 * Rendering is DRIVEN, not looped: `SceneDriver.setWorld()` mutates the graph
 * and calls `gl.render()` synchronously, so every scroll event paints a frame
 * even where requestAnimationFrame is frozen (hidden previews). A rAF ambient
 * loop adds slow rotation/drift only while the document is visible.
 */

const ORANGE = new THREE.Color('#F16524');
const ORANGE_2 = new THREE.Color('#FF8233');

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = (t: number): number => t * t * (3 - 2 * t);

interface Pose {
  x: number; // world units, viewport-relative (-1..1 maps to edges)
  y: number;
  s: number; // scale of the core group
  spin: number; // extra rotation offset
  power: number; // 0 dormant → 1 fully lit
  rings: number; // orbital-ring visibility
  pulse: number; // expanding detection pulse strength
  streams: number; // directional fixing streams
  split: number; // 0..1 twin separation (buddy act)
  particleMode: number; // 0 ambient drift · 1 converge · 2 orbit · 3 settle
}

/** Per-act keyframes for the protagonist (mirrors the DOM acts' timelines). */
function poseFor(w: WorldState): Pose {
  const ap = w.ap;
  const P: Pose = {
    x: 0, y: 0.1, s: 1, spin: 0, power: 0.7, rings: 0, pulse: 0,
    streams: 0, split: 0, particleMode: 0,
  };
  switch (w.act) {
    case 0: // HERO — dormant point → powers on and approaches
      P.s = lerp(0.06, 0.9, ease(clamp01(ap * 1.5 - 0.35)));
      P.power = lerp(0.06, 1, ease(clamp01(ap * 1.8 - 0.5)));
      P.y = 0.12;
      P.rings = clamp01(ap * 2.4 - 1.5);
      break;
    case 1: // BREAK — enters from the right once the human is "asleep"; detecting
      P.x = lerp(2.6, 0.85, ease(clamp01(ap * 1.7 - 0.55)));
      P.y = -0.1;
      P.s = 0.55;
      P.power = clamp01(ap * 1.6 - 0.4);
      P.pulse = clamp01(ap * 2 - 1);
      P.particleMode = 1;
      break;
    case 2: // ENGINE — travels the machine left→right; orbitals then streams
      P.x = lerp(-2.4, 2.4, ease(ap));
      P.y = -0.25;
      P.s = 0.5;
      P.power = 1;
      P.rings = clamp01(1.4 - Math.abs(ap - 0.35) * 4);
      P.streams = clamp01(1.2 - Math.abs(ap - 0.62) * 5);
      P.particleMode = 2;
      P.spin = ap * 4;
      break;
    case 3: // PIPELINE — small escort above the traveling log line
      P.x = lerp(-2.2, 2.2, ap);
      P.y = 1.05;
      P.s = 0.3;
      P.power = 0.85;
      P.particleMode = 2;
      break;
    case 4: // DATA — behind the graph; urgent pulse at the spike
      P.y = 0.55;
      P.s = 0.42;
      P.power = ap > 0.45 && ap < 0.78 ? 1 : 0.7;
      P.pulse = ap > 0.45 && ap < 0.78 ? 1 : 0;
      P.particleMode = 0;
      break;
    case 5: // MOVIE — quiet witness top of frame; verifying calm
      P.x = lerp(-1.6, 1.6, ap);
      P.y = 1.25;
      P.s = 0.26;
      P.power = 0.7;
      P.rings = 0.8;
      break;
    case 6: // BUDDY — the day-shift split
      P.y = 0.75;
      P.s = 0.45;
      P.power = 0.9;
      P.split = ease(clamp01(ap * 2));
      P.rings = 0.5;
      break;
    case 7: // PROOF — constellation anchor, slow confident orbit
      P.y = 0;
      P.s = 0.55;
      P.power = 0.85;
      P.rings = 1;
      P.spin = ap * 2;
      P.particleMode = 2;
      break;
    case 8: // FINALE — recovered: small, calm, breathing
      P.y = 0.35;
      P.s = lerp(0.55, 0.3, ease(ap));
      P.power = lerp(0.85, 0.5, ap);
      P.rings = clamp01(1 - ap * 1.6);
      P.particleMode = 3;
      break;
  }
  return P;
}

/** Procedural radial-gradient sprite texture — the volumetric-looking glow. */
function makeGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,140,60,0.85)');
  grad.addColorStop(0.35, 'rgba(241,101,36,0.32)');
  grad.addColorStop(1, 'rgba(241,101,36,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const PARTICLE_COUNT = 700;

/** Seeded particle home positions (stable across renders). */
function makeParticles(): { home: Float32Array; positions: Float32Array; sizes: Float32Array } {
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const home = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    home[i * 3] = (rand() - 0.5) * 14;
    home[i * 3 + 1] = (rand() - 0.5) * 9;
    home[i * 3 + 2] = (rand() - 0.5) * 6 - 1;
    sizes[i] = 0.5 + rand() * 1.5;
  }
  return { home, positions: home.slice(), sizes };
}

/**
 * Owns the scene graph nodes and renders frames on demand. The React layer
 * builds the objects; this class animates and paints them.
 */
export class SceneDriver {
  world: WorldState | null = null;
  private t = 0;
  private raf = 0;
  private last = 0;
  private renderFn: ((w: WorldState, t: number) => void) | null = null;

  /** Called by the bridge once the scene graph exists. */
  bind(renderFn: (w: WorldState, t: number) => void): void {
    this.renderFn = renderFn;
    if (this.world) this.renderFn(this.world, this.t);
  }

  unbind(): void {
    this.renderFn = null;
    cancelAnimationFrame(this.raf);
  }

  /** Scroll engine entry point — synchronous frame, rAF-independent. */
  setWorld(w: WorldState): void {
    this.world = w;
    this.renderFn?.(w, this.t);
  }

  /** Ambient drift while the tab is actually visible (rAF alive). */
  startAmbient(): void {
    const loop = (now: number): void => {
      if (this.last) this.t += Math.min(now - this.last, 64) / 1000;
      this.last = now;
      if (this.world) this.renderFn?.(this.world, this.t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}

/** Builds the Diamond Core + world, binds the driver, renders on demand. */
function SceneBridge({ driver }: { driver: SceneDriver }) {
  const { gl, scene, camera, size } = useThree();
  const group = useRef<THREE.Group>(null!);
  const twin = useRef<THREE.Group>(null!);
  const core = useRef<THREE.Mesh>(null!);
  const heart = useRef<THREE.Mesh>(null!);
  const shell = useRef<THREE.Mesh>(null!);
  const glow = useRef<THREE.Sprite>(null!);
  const ring1 = useRef<THREE.Mesh>(null!);
  const ring2 = useRef<THREE.Mesh>(null!);
  const pulseRing = useRef<THREE.Mesh>(null!);
  const streams = useRef<THREE.Group>(null!);
  const points = useRef<THREE.Points>(null!);
  const particles = useRef(makeParticles());
  const glowTex = useRef<THREE.Texture>();
  if (!glowTex.current) glowTex.current = makeGlowTexture();

  useEffect(() => {
    const p = particles.current;
    const render = (w: WorldState, t: number): void => {
      const pose = poseFor(w);
      const vw = size.width / size.height >= 1 ? 4.6 : 3;

      const placeDiamond = (g: THREE.Group, dx: number, mirror: number): void => {
        g.position.set(pose.x * vw * 0.38 + dx, pose.y * 1.6, 0);
        g.scale.setScalar(Math.max(pose.s, 0.001));
        g.rotation.y = (t * 0.35 + pose.spin) * mirror;
        g.rotation.z = 0.12 * mirror;
        g.visible = true;
      };
      const off = pose.split * vw * 0.42;
      placeDiamond(group.current, -off, 1);
      if (pose.split > 0.01) placeDiamond(twin.current, off, -1);
      else twin.current.visible = false;

      const heartMat = heart.current.material as THREE.MeshBasicMaterial;
      heartMat.color.copy(ORANGE_2).multiplyScalar(0.4 + pose.power * 1.1);
      const coreMat = core.current.material as THREE.MeshStandardMaterial;
      coreMat.emissiveIntensity = 0.15 + pose.power * 1.6;
      coreMat.opacity = 0.5 + pose.power * 0.5;
      const shellMat = shell.current.material as THREE.MeshBasicMaterial;
      shellMat.opacity = 0.05 + pose.power * 0.1;
      glow.current.scale.setScalar(2.6 + pose.power * 2.2 + Math.sin(t * 1.4) * 0.12);
      (glow.current.material as THREE.SpriteMaterial).opacity = 0.25 + pose.power * 0.55;

      ring1.current.visible = ring2.current.visible = pose.rings > 0.02;
      const ringMat1 = ring1.current.material as THREE.MeshBasicMaterial;
      const ringMat2 = ring2.current.material as THREE.MeshBasicMaterial;
      ringMat1.opacity = 0.5 * pose.rings;
      ringMat2.opacity = 0.3 * pose.rings;
      ring1.current.rotation.set(1.2, t * 0.5 + pose.spin * 0.5, 0);
      ring2.current.rotation.set(-0.9, -t * 0.32, 0.4);

      pulseRing.current.visible = pose.pulse > 0.02;
      if (pose.pulse > 0.02) {
        const u = (t * 0.8 + w.ap * 5) % 1;
        pulseRing.current.scale.setScalar(1 + u * 3.4);
        (pulseRing.current.material as THREE.MeshBasicMaterial).opacity =
          0.55 * pose.pulse * (1 - u);
        pulseRing.current.rotation.x = Math.PI / 2 - 0.4;
      }

      streams.current.visible = pose.streams > 0.02;
      if (pose.streams > 0.02) {
        streams.current.children.forEach((line, i) => {
          const u = (t * 0.6 + w.ap * 4 + i / 7) % 1;
          line.position.set(-4.5 + u * 3.6, Math.sin(i * 2.4) * 0.9, -0.4);
          ((line as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity =
            0.5 * pose.streams * u;
        });
        streams.current.position.copy(group.current.position);
      }

      // particle field — mode blends toward converge / orbit / settle
      const pos = (points.current.geometry.getAttribute('position') as THREE.BufferAttribute)
        .array as Float32Array;
      const cx = group.current.position.x;
      const cy = group.current.position.y;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const hx = p.home[i * 3];
        const hy = p.home[i * 3 + 1];
        const hz = p.home[i * 3 + 2];
        let x = hx + Math.sin(t * 0.12 + i) * 0.08;
        let y = hy + Math.cos(t * 0.1 + i * 1.7) * 0.06;
        if (pose.particleMode === 1) {
          const k = 0.35;
          x = lerp(x, cx + (hx - cx) * 0.55, k);
          y = lerp(y, cy + (hy - cy) * 0.55, k);
        } else if (pose.particleMode === 2) {
          const ang = Math.atan2(hy - cy, hx - cx) + t * 0.1 + 0.4;
          const rad = Math.max(Math.hypot(hx - cx, hy - cy) * 0.75, 1.4);
          x = cx + Math.cos(ang) * rad;
          y = cy + Math.sin(ang) * rad * 0.7;
        } else if (pose.particleMode === 3) {
          y = hy - (t % 4) * 0.02;
        }
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = hz;
      }
      (points.current.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
        true;
      (points.current.material as THREE.PointsMaterial).opacity =
        w.act === 8 ? 0.5 * (1 - w.ap) + 0.1 : 0.55;

      gl.render(scene, camera);
    };
    driver.bind(render);
    driver.startAmbient();
    return () => {
      driver.stop();
      driver.unbind();
    };
  }, [driver, gl, scene, camera, size]);

  const diamondBody = (
    <>
      {/* translucent outer shell */}
      <mesh ref={shell} scale={1.25}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color={ORANGE} transparent opacity={0.1} wireframe />
      </mesh>
      {/* main crystal */}
      <mesh ref={core} scale={[0.72, 1, 0.72]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color="#1a0d06"
          emissive={ORANGE}
          emissiveIntensity={1}
          roughness={0.25}
          metalness={0.1}
          transparent
          flatShading
        />
      </mesh>
      {/* emissive heart */}
      <mesh ref={heart} scale={[0.3, 0.44, 0.3]}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color={ORANGE_2} />
      </mesh>
      <sprite ref={glow}>
        <spriteMaterial
          map={glowTex.current}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.6}
        />
      </sprite>
      <mesh ref={ring1} scale={1.9}>
        <torusGeometry args={[1, 0.008, 8, 96]} />
        <meshBasicMaterial color={ORANGE} transparent opacity={0.5} />
      </mesh>
      <mesh ref={ring2} scale={2.5}>
        <torusGeometry args={[1, 0.006, 8, 96]} />
        <meshBasicMaterial color={ORANGE_2} transparent opacity={0.3} />
      </mesh>
      <mesh ref={pulseRing} visible={false}>
        <torusGeometry args={[1.4, 0.012, 8, 96]} />
        <meshBasicMaterial color={ORANGE} transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[3, 4, 5]} intensity={26} color="#ffffff" />
      <pointLight position={[0, 0, 2.2]} intensity={9} color={ORANGE} />
      <group ref={group}>{diamondBody}</group>
      <group ref={twin} visible={false}>
        {/* the day-shift twin: same body, mirrored spin (set in render) */}
        <mesh scale={1.25}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={ORANGE} transparent opacity={0.1} wireframe />
        </mesh>
        <mesh scale={[0.72, 1, 0.72]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color="#1a0d06"
            emissive={ORANGE}
            emissiveIntensity={1.4}
            roughness={0.25}
            metalness={0.1}
            flatShading
          />
        </mesh>
        <sprite scale={3.4}>
          <spriteMaterial
            map={glowTex.current}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            opacity={0.5}
          />
        </sprite>
      </group>
      <group ref={streams} visible={false}>
        {Array.from({ length: 7 }, (_, i) => (
          <mesh key={i}>
            <boxGeometry args={[0.5, 0.01, 0.01]} />
            <meshBasicMaterial color={ORANGE} transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[particles.current.positions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.035}
          color="#c9c2ba"
          transparent
          opacity={0.55}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </>
  );
}

export function DiamondCanvas({ driver }: { driver: SceneDriver }) {
  return (
    <div className="fixed inset-0 z-0" aria-hidden>
      <Canvas
        frameloop="never"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        camera={{ fov: 40, position: [0, 0, 7] }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__nsGL = gl;
          }
        }}
      >
        <SceneBridge driver={driver} />
      </Canvas>
    </div>
  );
}
