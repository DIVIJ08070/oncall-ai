import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useCursor } from '@react-three/drei';
import { useReducedMotion } from 'motion/react';
import type { Learning } from '../../../api/learnings';

/**
 * NeuralCore — the self-learning "living brain" (SPEC: per-repo learnings).
 * Every learning is a neuron floating in a black void; synapses wire neurons
 * that share an error_class (plus a few cross-links), light pulses travel the
 * wiring, and the whole web breathes with a slow heartbeat. Level drives the
 * anatomy: low levels are a sparse scatter, higher levels cluster neurons into
 * per-error-class lobes, and VETERAN/ORACLE grow slow orbital rings.
 *
 * Pure props-in: `learnings` + `level` (level index 0..5) draw the brain,
 * hover shows a tooltip, click reports through `onSelect`. Honors
 * prefers-reduced-motion (static layout, still interactive) and caps the
 * render at MAX_NEURONS with a "+N more" overlay.
 */

export interface NeuralCoreProps {
  learnings: Learning[];
  level: number;
  onSelect?: (l: Learning | null) => void;
  className?: string;
}

const MAX_NEURONS = 150;
const HEARTBEAT_HZ = 0.9;
const TAU = Math.PI * 2;
const DRIFT_AMP = 0.035;

/* ------------------------------------------------------------------ */
/* deterministic layout helpers                                        */
/* ------------------------------------------------------------------ */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tiny seeded PRNG so the layout is stable across renders. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Double-thump (lub-dub) envelope in [0,1] at HEARTBEAT_HZ. */
function heartbeat(t: number): number {
  const p = t * HEARTBEAT_HZ * TAU;
  const lub = Math.pow(Math.max(0, Math.sin(p)), 3);
  const dub = 0.5 * Math.pow(Math.max(0, Math.sin(p - 1.15)), 6);
  return Math.min(1, lub + dub);
}

function neuronPalette(l: Learning | null): { core: string; glow: string } {
  if (!l) return { core: '#6b3116', glow: '#8a3f1c' }; // newborn ember, dim
  if (l.rating < 0) return { core: '#FF3B30', glow: '#FF5A45' }; // ember red
  const c = l.confirmations;
  if (c >= 5) return { core: '#FFB37A', glow: '#FFA45C' }; // white-hot veteran
  if (c >= 3) return { core: '#FF8233', glow: '#FF8233' };
  return { core: '#F16524', glow: '#F16524' };
}

interface NeuronDatum {
  learning: Learning | null;
  base: THREE.Vector3;
  radius: number;
  core: string;
  glow: THREE.Color;
  glowSize: number;
  drift: { px: number; py: number; pz: number; sx: number; sy: number; sz: number };
}

interface NeuralGraph {
  nodes: NeuronDatum[];
  edges: Array<[number, number]>;
  /** rgb per line vertex (2 per edge), brightness pre-multiplied. */
  edgeColors: Float32Array;
  overflow: number;
  newborn: boolean;
}

/**
 * Positions + wiring. Level 0-1: one sparse cloud. Level 2+: error-class
 * lobes fly apart on a fibonacci sphere while intra-lobe scatter tightens
 * and intra-lobe wiring brightens.
 */
function buildGraph(learnings: Learning[], level: number): NeuralGraph {
  const lvl = Math.max(0, Math.min(5, Math.floor(level)));
  const shown = learnings.slice(0, MAX_NEURONS);
  const overflow = Math.max(0, learnings.length - shown.length);
  const newborn = shown.length === 0;
  const source: Array<Learning | null> = newborn
    ? Array.from({ length: 6 }, () => null)
    : shown;

  const classNames: string[] = [];
  const classOf = source.map((l) => {
    const key = l ? l.errorClass.toLowerCase() : 'genesis';
    const found = classNames.indexOf(key);
    if (found !== -1) return found;
    classNames.push(key);
    return classNames.length - 1;
  });

  const spread = lvl <= 1 ? 0 : Math.min(1, (lvl - 1) / 3);
  const lobeRadius = 1.45 * spread;
  const scatter = newborn ? 0.5 : 1.7 - 1.0 * spread;

  const centers = classNames.map((_, i) => {
    if (lobeRadius === 0) return new THREE.Vector3();
    const count = classNames.length;
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    return new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi) * 0.7, // oblate — brain-ish
      Math.sin(phi) * Math.sin(theta),
    ).multiplyScalar(lobeRadius);
  });

  const nodes: NeuronDatum[] = source.map((l, i) => {
    const rng = mulberry32(hashString(l ? l.id : `newborn-${i}`));
    const g = () => (rng() + rng() + rng()) / 1.5 - 1; // ~gaussian [-1,1]
    const center = centers[classOf[i]];
    const base = newborn
      ? new THREE.Vector3(
          Math.cos((i / 6) * TAU) * 0.55 + g() * 0.12,
          g() * 0.3,
          Math.sin((i / 6) * TAU) * 0.55 + g() * 0.12,
        )
      : new THREE.Vector3(
          center.x + g() * scatter,
          center.y + g() * scatter * 0.8,
          center.z + g() * scatter,
        );
    const conf = l ? Math.max(1, l.confirmations) : 1;
    const radius = l ? 0.045 + 0.014 * Math.min(6, conf - 1) : 0.034;
    const { core, glow } = neuronPalette(l);
    return {
      learning: l,
      base,
      radius,
      core,
      glow: new THREE.Color(glow),
      glowSize: radius * (l ? 7 + 3 * Math.min(1, (conf - 1) / 5) : 6),
      drift: {
        px: rng() * TAU,
        py: rng() * TAU,
        pz: rng() * TAU,
        sx: 0.25 + rng() * 0.5,
        sy: 0.25 + rng() * 0.5,
        sz: 0.25 + rng() * 0.5,
      },
    };
  });

  // --- wiring -----------------------------------------------------------
  const list: Array<{ a: number; b: number; w: number }> = [];
  const seen = new Set<string>();
  const push = (a: number, b: number, w: number) => {
    if (a === b) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ a, b, w });
  };

  const intraW = newborn ? 0.5 : 0.4 + 0.5 * spread;
  const groups = new Map<number, number[]>();
  classOf.forEach((c, i) => {
    const arr = groups.get(c);
    if (arr) arr.push(i);
    else groups.set(c, [i]);
  });
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // nearest same-class neighbour…
    for (const i of group) {
      let best = -1;
      let bestD = Infinity;
      for (const j of group) {
        if (j === i) continue;
        const d = nodes[i].base.distanceToSquared(nodes[j].base);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best !== -1) push(i, best, intraW);
    }
    // …plus a chain so every lobe is one connected web
    for (let k = 1; k < group.length; k++) push(group[k - 1], group[k], intraW * 0.8);
  }
  if (newborn) push(5, 0, intraW);

  // a few cross-class links so lobes still talk to each other
  if (!newborn && classNames.length > 1) {
    const rng = mulberry32(0xc0ffee ^ Math.imul(source.length + lvl, 2654435761));
    const wanted = Math.min(10, Math.max(1, Math.round(source.length / 9)));
    const before = list.length;
    for (let tries = 0; tries < wanted * 6 && list.length < before + wanted; tries++) {
      const a = Math.floor(rng() * nodes.length);
      const b = Math.floor(rng() * nodes.length);
      if (classOf[a] !== classOf[b]) push(a, b, 0.18);
    }
  }

  const edges: Array<[number, number]> = list.map(({ a, b }) => [a, b]);
  const edgeColors = new Float32Array(edges.length * 6);
  list.forEach(({ a, b, w }, k) => {
    const ca = nodes[a].glow.clone().multiplyScalar(w);
    const cb = nodes[b].glow.clone().multiplyScalar(w);
    edgeColors.set([ca.r, ca.g, ca.b, cb.r, cb.g, cb.b], k * 6);
  });

  return { nodes, edges, edgeColors, overflow, newborn };
}

/* ------------------------------------------------------------------ */
/* shaders (soft additive radial glow — no textures, one draw call)    */
/* ------------------------------------------------------------------ */

const GLOW_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  uniform float uBeat;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (300.0 / max(0.1, -mv.z)) * (1.0 + 0.22 * uBeat);
    gl_Position = projectionMatrix * mv;
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * a * uOpacity);
  }
`;

const PULSE_VERT = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio * (300.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const PULSE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * a * uOpacity);
  }
`;

const noRaycast: THREE.Mesh['raycast'] = () => undefined;

/* ------------------------------------------------------------------ */
/* scene                                                               */
/* ------------------------------------------------------------------ */

interface PulseState {
  edge: number;
  t: number;
  speed: number;
}

function NeuralScene({
  graph,
  level,
  reduced,
  onSelect,
}: {
  graph: NeuralGraph;
  level: number;
  reduced: boolean;
  onSelect?: (l: Learning | null) => void;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const ringsRef = useRef<THREE.Group>(null);
  const meshRefs = useRef<Array<THREE.Mesh | null>>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [idle, setIdle] = useState(true);
  const idleTimer = useRef<number | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  useCursor(hovered !== null);

  // All per-frame GPU resources, allocated once per graph.
  const res = useMemo(() => {
    const n = graph.nodes.length;
    // +1 point: a large dim halo at the origin — the brain's "soul".
    const drifted = new Float32Array((n + 1) * 3);
    const glowSizes = new Float32Array(n + 1);
    const glowColors = new Float32Array((n + 1) * 3);
    graph.nodes.forEach((node, i) => {
      drifted.set([node.base.x, node.base.y, node.base.z], i * 3);
      glowSizes[i] = node.glowSize;
      glowColors.set([node.glow.r, node.glow.g, node.glow.b], i * 3);
    });
    glowSizes[n] = 1.5;
    const soul = new THREE.Color('#F16524').multiplyScalar(graph.newborn ? 0.22 : 0.4);
    glowColors.set([soul.r, soul.g, soul.b], n * 3);

    const glowGeo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(drifted, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    glowGeo.setAttribute('position', posAttr);
    glowGeo.setAttribute('aSize', new THREE.BufferAttribute(glowSizes, 1));
    glowGeo.setAttribute('aColor', new THREE.BufferAttribute(glowColors, 3));
    const glowMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: {
        uPixelRatio: { value: 1 },
        uBeat: { value: 0 },
        uOpacity: { value: 0.7 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const e = graph.edges.length;
    const linePos = new Float32Array(Math.max(1, e) * 6);
    graph.edges.forEach(([a, b], k) => {
      linePos.set(drifted.subarray(a * 3, a * 3 + 3), k * 6);
      linePos.set(drifted.subarray(b * 3, b * 3 + 3), k * 6 + 3);
    });
    const lineGeo = new THREE.BufferGeometry();
    const lineAttr = new THREE.BufferAttribute(linePos, 3);
    lineAttr.setUsage(THREE.DynamicDrawUsage);
    lineGeo.setAttribute('position', lineAttr);
    lineGeo.setAttribute('color', new THREE.BufferAttribute(graph.edgeColors, 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const hiPos = new Float32Array(Math.max(1, e) * 6);
    const hiGeo = new THREE.BufferGeometry();
    const hiAttr = new THREE.BufferAttribute(hiPos, 3);
    hiAttr.setUsage(THREE.DynamicDrawUsage);
    hiGeo.setAttribute('position', hiAttr);
    hiGeo.setDrawRange(0, 0);
    const hiMat = new THREE.LineBasicMaterial({
      color: '#FFC9A3',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const pulseCount = e > 0 ? Math.min(56, Math.max(8, Math.round(e * 0.6))) : 0;
    const pulsePos = new Float32Array(Math.max(1, pulseCount) * 3);
    const pulses: PulseState[] = Array.from({ length: pulseCount }, () => ({
      edge: Math.floor(Math.random() * Math.max(1, e)),
      t: Math.random(),
      speed: 0.3 + Math.random() * 0.45,
    }));
    const pulseGeo = new THREE.BufferGeometry();
    const pulseAttr = new THREE.BufferAttribute(pulsePos, 3);
    pulseAttr.setUsage(THREE.DynamicDrawUsage);
    pulseGeo.setAttribute('position', pulseAttr);
    const pulseMat = new THREE.ShaderMaterial({
      vertexShader: PULSE_VERT,
      fragmentShader: PULSE_FRAG,
      uniforms: {
        uPixelRatio: { value: 1 },
        uSize: { value: 0.14 },
        uColor: { value: new THREE.Color('#FFD9B4') },
        uOpacity: { value: 0.8 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const sphereGeo = new THREE.SphereGeometry(1, 20, 20);
    const coreMats = new Map<string, THREE.MeshBasicMaterial>();
    for (const node of graph.nodes) {
      if (!coreMats.has(node.core)) {
        coreMats.set(node.core, new THREE.MeshBasicMaterial({ color: node.core }));
      }
    }

    return {
      n,
      drifted,
      glowGeo,
      glowMat,
      glowSizes,
      glowBaseSizes: glowSizes.slice(),
      lineGeo,
      lineMat,
      linePos,
      hiGeo,
      hiMat,
      hiPos,
      pulseGeo,
      pulseMat,
      pulsePos,
      pulses,
      pulseCount,
      sphereGeo,
      coreMats,
      dispose() {
        glowGeo.dispose();
        glowMat.dispose();
        lineGeo.dispose();
        lineMat.dispose();
        hiGeo.dispose();
        hiMat.dispose();
        pulseGeo.dispose();
        pulseMat.dispose();
        sphereGeo.dispose();
        for (const m of coreMats.values()) m.dispose();
      },
    };
  }, [graph]);

  useEffect(() => () => res.dispose(), [res]);

  // New data — drop a stale hover index.
  useEffect(() => {
    setHovered(null);
    meshRefs.current = [];
  }, [graph]);

  useEffect(
    () => () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    },
    [],
  );

  // Hovered neuron gets a hotter halo.
  useEffect(() => {
    res.glowSizes.set(res.glowBaseSizes);
    if (hovered !== null && hovered < res.n) {
      res.glowSizes[hovered] = res.glowBaseSizes[hovered] * 1.7;
    }
    (res.glowGeo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    invalidate();
  }, [hovered, res, invalidate]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const beat = reduced ? 0 : heartbeat(t);
    // Soft 0..1 wave for the hovered neuron's glow/scale pulse.
    const hoverWave = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 5.2);
    const { drifted } = res;

    if (rootRef.current) rootRef.current.scale.setScalar(1 + 0.06 * beat);

    graph.nodes.forEach((node, i) => {
      const d = node.drift;
      const x = node.base.x + (reduced ? 0 : Math.sin(t * d.sx + d.px) * DRIFT_AMP);
      const y = node.base.y + (reduced ? 0 : Math.sin(t * d.sy + d.py) * DRIFT_AMP);
      const z = node.base.z + (reduced ? 0 : Math.sin(t * d.sz + d.pz) * DRIFT_AMP);
      drifted[i * 3] = x;
      drifted[i * 3 + 1] = y;
      drifted[i * 3 + 2] = z;
      const mesh = meshRefs.current[i];
      if (mesh) {
        mesh.position.set(x, y, z);
        mesh.scale.setScalar(
          node.radius *
            (hovered === i ? 1.55 + 0.16 * hoverWave : 1) *
            (1 + 0.05 * beat),
        );
      }
    });
    (res.glowGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // Hovered neuron: halo breathes on its own, faster than the heartbeat.
    if (!reduced && hovered !== null && hovered < res.n) {
      res.glowSizes[hovered] = res.glowBaseSizes[hovered] * (1.55 + 0.4 * hoverWave);
      (res.glowGeo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    }

    graph.edges.forEach(([a, b], k) => {
      res.linePos.set(drifted.subarray(a * 3, a * 3 + 3), k * 6);
      res.linePos.set(drifted.subarray(b * 3, b * 3 + 3), k * 6 + 3);
    });
    (res.lineGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    res.lineMat.opacity = reduced ? 0.75 : 0.45 + 0.4 * beat;

    if (hovered !== null) {
      let w = 0;
      graph.edges.forEach(([a, b]) => {
        if (a !== hovered && b !== hovered) return;
        res.hiPos.set(drifted.subarray(a * 3, a * 3 + 3), w);
        res.hiPos.set(drifted.subarray(b * 3, b * 3 + 3), w + 3);
        w += 6;
      });
      res.hiGeo.setDrawRange(0, w / 3);
      (res.hiGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      // Connected synapses shimmer in step with the hovered neuron's pulse.
      res.hiMat.opacity = reduced ? 0.95 : 0.72 + 0.28 * hoverWave;
    } else {
      res.hiGeo.setDrawRange(0, 0);
    }

    if (!reduced && res.pulseCount > 0 && graph.edges.length > 0) {
      res.pulses.forEach((p, k) => {
        p.t += delta * p.speed;
        if (p.t >= 1) {
          p.t %= 1;
          p.edge = Math.floor(Math.random() * graph.edges.length);
          p.speed = 0.3 + Math.random() * 0.45;
        }
        const [a, b] = graph.edges[p.edge];
        for (let c = 0; c < 3; c++) {
          const pa = drifted[a * 3 + c];
          res.pulsePos[k * 3 + c] = pa + (drifted[b * 3 + c] - pa) * p.t;
        }
      });
      (res.pulseGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    const dpr = state.gl.getPixelRatio();
    res.glowMat.uniforms.uPixelRatio.value = dpr;
    res.glowMat.uniforms.uBeat.value = beat;
    res.glowMat.uniforms.uOpacity.value = reduced ? 0.7 : 0.5 + 0.4 * beat;
    res.pulseMat.uniforms.uPixelRatio.value = dpr;
    res.pulseMat.uniforms.uOpacity.value = 0.55 + 0.45 * beat;

    if (ringsRef.current && !reduced) ringsRef.current.rotation.y += delta * 0.05;
  });

  const handleStart = () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    setIdle(false);
  };
  const handleEnd = () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 4000);
  };

  const lvl = Math.max(0, Math.min(5, Math.floor(level)));
  const ringCount = lvl >= 5 ? 2 : lvl >= 4 ? 1 : 0;
  const hoveredNode =
    hovered !== null && hovered < graph.nodes.length ? graph.nodes[hovered] : null;

  return (
    <group ref={rootRef}>
      <points geometry={res.glowGeo} material={res.glowMat} frustumCulled={false} />
      <lineSegments geometry={res.lineGeo} material={res.lineMat} frustumCulled={false} />
      <lineSegments geometry={res.hiGeo} material={res.hiMat} frustumCulled={false} />
      {!reduced && res.pulseCount > 0 && (
        <points geometry={res.pulseGeo} material={res.pulseMat} frustumCulled={false} />
      )}

      {graph.nodes.map((node, i) => (
        <mesh
          key={node.learning ? node.learning.id : `newborn-${i}`}
          geometry={res.sphereGeo}
          material={res.coreMats.get(node.core)}
          position={node.base}
          scale={node.radius}
          raycast={node.learning ? undefined : noRaycast}
          onPointerOver={
            node.learning
              ? (ev) => {
                  ev.stopPropagation();
                  setHovered(i);
                }
              : undefined
          }
          onPointerOut={
            node.learning ? () => setHovered((h) => (h === i ? null : h)) : undefined
          }
          onClick={
            node.learning
              ? (ev) => {
                  ev.stopPropagation();
                  onSelect?.(node.learning);
                }
              : undefined
          }
          ref={(m: THREE.Mesh | null) => {
            meshRefs.current[i] = m;
          }}
        />
      ))}

      {ringCount > 0 && (
        <group ref={ringsRef}>
          <mesh rotation={[1.15, 0.2, 0]}>
            <torusGeometry args={[2.15, 0.005, 8, 128]} />
            <meshBasicMaterial
              color="#F16524"
              transparent
              opacity={0.16}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          {ringCount > 1 && (
            <mesh rotation={[-1.05, -0.5, 0.2]}>
              <torusGeometry args={[2.55, 0.004, 8, 128]} />
              <meshBasicMaterial
                color="#FF8233"
                transparent
                opacity={0.1}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          )}
        </group>
      )}

      {hoveredNode?.learning && (
        <Html
          position={[
            hoveredNode.base.x,
            hoveredNode.base.y + hoveredNode.radius + 0.14,
            hoveredNode.base.z,
          ]}
          center
          zIndexRange={[40, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="pointer-events-none w-64 -translate-y-1/2 rounded-lg border border-white/10 bg-[#0b0603]/95 p-3 shadow-[0_0_30px_rgba(241,101,36,0.2)]">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#FF8233]">
              {hoveredNode.learning.errorClass}
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-white/85 line-clamp-3">
              {hoveredNode.learning.rootCause}
            </div>
            <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-white/45">
              <span>
                {hoveredNode.learning.confirmations > 1
                  ? `confirmed ×${hoveredNode.learning.confirmations}`
                  : 'observed once'}
              </span>
              <span
                className={
                  hoveredNode.learning.rating < 0 ? 'text-[#FF3B30]' : 'text-[#FF8233]'
                }
              >
                {hoveredNode.learning.rating > 0
                  ? '+1'
                  : hoveredNode.learning.rating < 0
                    ? '−1'
                    : hoveredNode.learning.source}
              </span>
            </div>
          </div>
        </Html>
      )}

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={2.4}
        maxDistance={9}
        minPolarAngle={0.6}
        maxPolarAngle={2.5}
        autoRotate={!reduced && idle && hovered === null}
        autoRotateSpeed={0.6}
        onStart={handleStart}
        onEnd={handleEnd}
      />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* public component                                                    */
/* ------------------------------------------------------------------ */

export function NeuralCore({ learnings, level, onSelect, className }: NeuralCoreProps) {
  const reduced = !!useReducedMotion();
  const graph = useMemo(() => buildGraph(learnings, level), [learnings, level]);
  const downPos = useRef<[number, number] | null>(null);

  return (
    <div
      className={`relative h-full min-h-[320px] w-full overflow-hidden ${className ?? ''}`}
      style={{
        background:
          'radial-gradient(120% 90% at 50% 42%, #120a05 0%, #050302 55%, #000 100%)',
      }}
    >
      <Canvas
        dpr={[1, 2]}
        flat
        frameloop={reduced ? 'demand' : 'always'}
        camera={{ position: [0, 0.6, 5.4], fov: 42, near: 0.1, far: 60 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onPointerDown={(ev) => {
          downPos.current = [ev.clientX, ev.clientY];
        }}
        onPointerMissed={(ev) => {
          // Ignore the click generated by an orbit drag.
          const d = downPos.current;
          if (d && Math.hypot(ev.clientX - d[0], ev.clientY - d[1]) > 6) return;
          onSelect?.(null);
        }}
      >
        <fog attach="fog" args={['#000000', 7, 13]} />
        <NeuralScene graph={graph} level={level} reduced={reduced} onSelect={onSelect} />
      </Canvas>
      {graph.overflow > 0 && (
        <div className="pointer-events-none absolute bottom-3 right-4 font-mono text-[11px] tracking-wider text-white/40">
          +{graph.overflow} more learnings
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* heartbeat audio                                                     */
/* ------------------------------------------------------------------ */

/**
 * Soft ~880Hz sine blip on each heartbeat. Default OFF; the AudioContext is
 * created lazily on the first enable (a user gesture, per autoplay rules) and
 * closed on unmount.
 */
export function useNeuralPing(enabled: boolean): void {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    const ctx = ctxRef.current;
    void ctx.resume();

    const blip = () => {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.04, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.25);
    };

    const id = window.setInterval(blip, Math.round(1000 / HEARTBEAT_HZ));
    return () => {
      window.clearInterval(id);
      void ctx.suspend();
    };
  }, [enabled]);

  useEffect(
    () => () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [],
  );
}
