import { useRef, useState, useEffect } from 'react';
import * as Matter from 'matter-js';

/**
 * FallingText — the words of a sentence drop and pile up under real physics
 * (adapted from React Bits to TS). Each word becomes a rigid body; the DOM spans
 * are positioned from the simulation each frame, and the mouse can shove them.
 *
 * Fixes over the upstream source:
 *  - runs the engine once (upstream both `Runner.run`s AND calls `Engine.update`
 *    in the rAF loop, double-stepping the simulation),
 *  - cancels its animation frame on unmount (upstream leaks the loop forever),
 *  - positions words with a single translate(-50%,-50%) convention instead of
 *    the upstream's mismatched bounds math, so nothing jumps on the first frame,
 *  - guards canvas teardown, and skips the whole effect under reduced motion.
 */
export interface FallingTextProps {
  text: string;
  className?: string;
  /** Words rendered in the accent colour (matched by prefix). */
  highlightWords?: string[];
  trigger?: 'click' | 'hover' | 'auto' | 'scroll';
  gravity?: number;
  mouseConstraintStiffness?: number;
  fontSize?: string;
  wireframes?: boolean;
  backgroundColor?: string;
}

export function FallingText({
  text,
  className = '',
  highlightWords = [],
  trigger = 'hover',
  gravity = 0.56,
  mouseConstraintStiffness = 0.9,
  fontSize = '2rem',
  wireframes = false,
  backgroundColor = 'transparent',
}: FallingTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [effectStarted, setEffectStarted] = useState(false);

  // Split into per-word spans; highlighted words get the accent class.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.replaceChildren();
    text.split(' ').forEach((word, i, arr) => {
      const span = document.createElement('span');
      span.className = `ft-word${
        highlightWords.some((hw) => word.startsWith(hw)) ? ' ft-highlight' : ''
      }`;
      span.textContent = word;
      el.appendChild(span);
      if (i < arr.length - 1) el.appendChild(document.createTextNode(' '));
    });
  }, [text, highlightWords]);

  useEffect(() => {
    if (trigger === 'auto') {
      setEffectStarted(true);
      return;
    }
    if (trigger === 'scroll' && containerRef.current) {
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setEffectStarted(true);
            obs.disconnect();
          }
        },
        { threshold: 0.1 },
      );
      obs.observe(containerRef.current);
      return () => obs.disconnect();
    }
  }, [trigger]);

  useEffect(() => {
    if (!effectStarted) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const container = containerRef.current;
    const textEl = textRef.current;
    const canvasHost = canvasContainerRef.current;
    if (!container || !textEl || !canvasHost) return;

    const { Engine, Render, World, Bodies, Runner, Mouse, MouseConstraint, Body } = Matter;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) return;

    const engine = Engine.create();
    engine.world.gravity.y = gravity;

    const render = Render.create({
      element: canvasHost,
      engine,
      options: { width, height, background: backgroundColor, wireframes },
    });

    // Invisible walls so words settle in the box instead of falling out of it.
    const wallOpts = { isStatic: true, render: { fillStyle: 'transparent' } };
    const walls = [
      Bodies.rectangle(width / 2, height + 25, width, 50, wallOpts), // floor
      Bodies.rectangle(-25, height / 2, 50, height, wallOpts), // left
      Bodies.rectangle(width + 25, height / 2, 50, height, wallOpts), // right
      Bodies.rectangle(width / 2, -25, width, 50, wallOpts), // ceiling
    ];

    const wordSpans = Array.from(textEl.querySelectorAll<HTMLElement>('.ft-word'));
    const wordBodies = wordSpans.map((elem) => {
      const r = elem.getBoundingClientRect();
      const body = Bodies.rectangle(
        r.left - rect.left + r.width / 2,
        r.top - rect.top + r.height / 2,
        r.width,
        r.height,
        { render: { fillStyle: 'transparent' }, restitution: 0.8, frictionAir: 0.01, friction: 0.2 },
      );
      Body.setVelocity(body, { x: (Math.random() - 0.5) * 5, y: 0 });
      Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.05);
      return { elem, body };
    });

    // Pin the spans to their measured spot before handing them to the sim, so
    // the hand-off is seamless (they're static in flow until this moment).
    wordBodies.forEach(({ elem, body }) => {
      elem.style.position = 'absolute';
      elem.style.left = `${body.position.x}px`;
      elem.style.top = `${body.position.y}px`;
      elem.style.transform = 'translate(-50%, -50%)';
    });

    const mouse = Mouse.create(container);
    const mouseConstraint = MouseConstraint.create(engine, {
      mouse,
      constraint: { stiffness: mouseConstraintStiffness, render: { visible: false } },
    });
    render.mouse = mouse;

    World.add(engine.world, [...walls, mouseConstraint, ...wordBodies.map((w) => w.body)]);

    const runner = Runner.create();
    Runner.run(runner, engine);
    Render.run(render);

    // Read-only sync: the Runner already steps the engine.
    let raf = 0;
    const sync = (): void => {
      wordBodies.forEach(({ body, elem }) => {
        elem.style.left = `${body.position.x}px`;
        elem.style.top = `${body.position.y}px`;
        elem.style.transform = `translate(-50%, -50%) rotate(${body.angle}rad)`;
      });
      raf = requestAnimationFrame(sync);
    };
    sync();

    return () => {
      cancelAnimationFrame(raf);
      Render.stop(render);
      Runner.stop(runner);
      render.canvas?.remove();
      World.clear(engine.world, false);
      Engine.clear(engine);
    };
  }, [effectStarted, gravity, wireframes, backgroundColor, mouseConstraintStiffness]);

  const start = (): void => {
    if (!effectStarted && (trigger === 'click' || trigger === 'hover')) setEffectStarted(true);
  };

  return (
    <div
      ref={containerRef}
      className={`ft-container ${className}`}
      // Touch devices never fire mouseenter, so a tap starts the `hover` variant too.
      onClick={trigger === 'click' || trigger === 'hover' ? start : undefined}
      onMouseEnter={trigger === 'hover' ? start : undefined}
    >
      <div ref={textRef} className="ft-target" style={{ fontSize, lineHeight: 1.4 }} />
      <div ref={canvasContainerRef} className="ft-canvas" />
    </div>
  );
}

export default FallingText;
