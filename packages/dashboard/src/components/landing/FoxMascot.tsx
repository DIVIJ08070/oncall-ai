import { useEffect, useRef, useState } from 'react';

/**
 * Interactive cartoon fox mascot (SVG, no assets). Unlike the pre-rendered
 * video fox, this one is rigged in code: the pupils and head track the cursor,
 * he blinks on a timer, blushes when the cursor comes near his face, and waves
 * with a "Hi!" bubble when clicked (or focused + Enter/Space). All cursor work
 * writes transforms through refs inside one rAF, so mousemove never re-renders.
 */
export function FoxMascot() {
  const svgRef = useRef<SVGSVGElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const pupilLRef = useRef<SVGGElement>(null);
  const pupilRRef = useRef<SVGGElement>(null);
  const blushRef = useRef<SVGGElement>(null);
  const raf = useRef<number>(0);
  const [waving, setWaving] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const onMove = (e: MouseEvent): void => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        // Face center sits at ~50% width, ~33% height of the drawing.
        const faceX = rect.left + rect.width * 0.5;
        const faceY = rect.top + rect.height * 0.33;
        const dx = e.clientX - faceX;
        const dy = e.clientY - faceY;
        // Normalize against the viewport so far-away cursor still reads.
        const nx = Math.max(-1, Math.min(1, dx / (window.innerWidth / 2)));
        const ny = Math.max(-1, Math.min(1, dy / (window.innerHeight / 2)));

        const eyes = `translate(${nx * 9}px, ${ny * 7}px)`;
        if (pupilLRef.current) pupilLRef.current.style.transform = eyes;
        if (pupilRRef.current) pupilRRef.current.style.transform = eyes;
        if (headRef.current) {
          headRef.current.style.transform = `translate(${nx * 7}px, ${ny * 5}px) rotate(${nx * 5}deg)`;
        }
        if (blushRef.current) {
          const near = Math.hypot(dx, dy) < rect.width * 0.38;
          blushRef.current.style.opacity = near ? '0.9' : '0';
        }
      });
    };

    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  // The wave un-sticks itself on a timer (events are unreliable in hidden tabs).
  useEffect(() => {
    if (!waving) return;
    const t = window.setTimeout(() => setWaving(false), 1700);
    return () => window.clearTimeout(t);
  }, [waving]);

  return (
    <div className="pointer-events-auto flex h-full w-full items-center justify-center">
      <style>{`
        @keyframes fox-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
        @keyframes fox-sway { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(5deg); } }
        @keyframes fox-blink { 0%, 91%, 97%, 100% { transform: scaleY(0); } 94% { transform: scaleY(1); } }
        @keyframes fox-wave {
          0% { transform: rotate(0deg); }
          25% { transform: rotate(-128deg); }
          40% { transform: rotate(-100deg); }
          55% { transform: rotate(-128deg); }
          70% { transform: rotate(-100deg); }
          100% { transform: rotate(0deg); }
        }
        @keyframes fox-pop {
          0% { transform: scale(0); }
          60% { transform: scale(1.12); }
          100% { transform: scale(1); }
        }
      `}</style>
      <svg
        ref={svgRef}
        viewBox="0 0 400 560"
        role="button"
        tabIndex={0}
        aria-label="Say hi to the fox"
        onClick={() => setWaving(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setWaving(true);
          }
        }}
        className="h-full max-h-full w-auto cursor-pointer outline-none"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="foxFur" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F4741F" />
            <stop offset="100%" stopColor="#E85A16" />
          </linearGradient>
        </defs>

        {/* everything bobs gently */}
        <g style={{ animation: 'fox-bob 3.2s ease-in-out infinite' }}>
          {/* ground shadow */}
          <ellipse cx="200" cy="496" rx="118" ry="14" fill="rgba(120, 45, 0, 0.14)" />

          {/* tail */}
          <g
            style={{
              animation: 'fox-sway 3.2s ease-in-out infinite',
              transformBox: 'fill-box',
              transformOrigin: '15% 85%',
            }}
          >
            <path
              d="M262 442 C 336 430 362 356 336 314 C 392 368 374 456 268 470 Z"
              fill="url(#foxFur)"
            />
            <path d="M336 314 C 362 356 350 396 322 416 C 356 382 356 344 336 314 Z" fill="#FFF6EC" />
          </g>

          {/* legs + sneakers */}
          <rect x="152" y="398" width="36" height="66" rx="16" fill="#F5EDE0" />
          <rect x="212" y="398" width="36" height="66" rx="16" fill="#F5EDE0" />
          <rect x="166" y="398" width="8" height="60" rx="4" fill="#24252A" />
          <rect x="226" y="398" width="8" height="60" rx="4" fill="#24252A" />
          <ellipse cx="168" cy="470" rx="35" ry="17" fill="#24252A" />
          <ellipse cx="232" cy="470" rx="35" ry="17" fill="#24252A" />
          <path d="M134 474 Q168 490 202 474 L202 482 Q168 496 134 482 Z" fill="#FFFFFF" />
          <path d="M198 474 Q232 490 266 474 L266 482 Q232 496 198 482 Z" fill="#FFFFFF" />

          {/* body: black turtleneck sweater (top tucks behind the head) */}
          <path
            d="M200 268 C 150 268 126 306 126 352 L 126 390 C 126 412 152 424 200 424 C 248 424 274 412 274 390 L 274 352 C 274 306 250 268 200 268 Z"
            fill="#24252A"
          />
          {/* left arm (static) */}
          <path
            d="M146 312 C 114 330 106 362 114 392"
            stroke="#24252A"
            strokeWidth="27"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="116" cy="397" r="14" fill="url(#foxFur)" />
          {/* turtleneck collar, tucked under the chin */}
          <rect x="168" y="258" width="64" height="26" rx="12" fill="#33343B" />

          {/* head (tracks the cursor) */}
          <g
            ref={headRef}
            style={{
              transition: 'transform 0.25s ease-out',
              transformBox: 'fill-box',
              transformOrigin: '50% 88%',
            }}
          >
            {/* ears */}
            <path d="M118 138 L 148 50 L 186 120 Z" fill="url(#foxFur)" />
            <path d="M132 126 L 150 76 L 170 114 Z" fill="#FFD9BF" />
            <path d="M282 138 L 252 50 L 214 120 Z" fill="url(#foxFur)" />
            <path d="M268 126 L 250 76 L 230 114 Z" fill="#FFD9BF" />

            {/* head base */}
            <ellipse cx="200" cy="188" rx="94" ry="82" fill="url(#foxFur)" />
            {/* cheek fluff */}
            <path d="M108 196 L 84 214 L 112 226 Z" fill="url(#foxFur)" />
            <path d="M292 196 L 316 214 L 288 226 Z" fill="url(#foxFur)" />

            {/* white baseball cap: dome on top of the head, flat brim ellipse */}
            <path d="M118 114 C 124 58 276 58 282 114 Q 200 94 118 114 Z" fill="#F6F3EE" />
            <ellipse cx="200" cy="115" rx="90" ry="17" fill="#FFFFFF" stroke="#E5E0D6" strokeWidth="2" />
            <circle cx="200" cy="64" r="7" fill="#E5E0D6" />

            {/* muzzle */}
            <ellipse cx="200" cy="230" rx="52" ry="38" fill="#FFF6EC" />
            {/* nose */}
            <path d="M188 210 Q 200 202 212 210 Q 208 224 200 226 Q 192 224 188 210 Z" fill="#3B2B25" />

            {/* mouth: smile normally, open when waving */}
            <path
              d="M182 234 Q 200 250 218 234"
              stroke="#3B2B25"
              strokeWidth="5"
              strokeLinecap="round"
              fill="none"
              opacity={waving ? 0 : 1}
            />
            <path
              d="M180 232 Q 200 262 220 232 Z"
              fill="#7A4632"
              opacity={waving ? 1 : 0}
            />

            {/* eyes */}
            <ellipse cx="162" cy="176" rx="23" ry="25" fill="#FFFFFF" />
            <ellipse cx="238" cy="176" rx="23" ry="25" fill="#FFFFFF" />
            <g ref={pupilLRef} style={{ transition: 'transform 0.1s linear' }}>
              <circle cx="162" cy="176" r="10.5" fill="#2E1F1A" />
              <circle cx="165.5" cy="172.5" r="3.5" fill="#FFFFFF" />
            </g>
            <g ref={pupilRRef} style={{ transition: 'transform 0.1s linear' }}>
              <circle cx="238" cy="176" r="10.5" fill="#2E1F1A" />
              <circle cx="241.5" cy="172.5" r="3.5" fill="#FFFFFF" />
            </g>
            {/* eyelids (blink) */}
            <ellipse
              cx="162"
              cy="176"
              rx="24"
              ry="26"
              fill="url(#foxFur)"
              style={{
                animation: 'fox-blink 4.6s linear infinite',
                transformBox: 'fill-box',
                transformOrigin: '50% 0%',
                transform: 'scaleY(0)',
              }}
            />
            <ellipse
              cx="238"
              cy="176"
              rx="24"
              ry="26"
              fill="url(#foxFur)"
              style={{
                animation: 'fox-blink 4.6s linear infinite',
                transformBox: 'fill-box',
                transformOrigin: '50% 0%',
                transform: 'scaleY(0)',
              }}
            />

            {/* blush (appears when the cursor is near the face) */}
            <g ref={blushRef} style={{ opacity: 0, transition: 'opacity 0.3s ease' }}>
              <ellipse cx="134" cy="214" rx="15" ry="8" fill="#FF9D5C" />
              <ellipse cx="266" cy="214" rx="15" ry="8" fill="#FF9D5C" />
            </g>
          </g>

          {/* right arm — waves on click, drawn in front of the body */}
          <g
            style={{
              animation: waving ? 'fox-wave 1.5s ease-in-out' : 'none',
              transformBox: 'fill-box',
              transformOrigin: '18% 12%',
            }}
          >
            <path
              d="M254 312 C 286 330 294 362 286 392"
              stroke="#24252A"
              strokeWidth="27"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="284" cy="397" r="14" fill="url(#foxFur)" />
          </g>

          {/* "Hi!" bubble */}
          {waving && (
            <g
              style={{
                animation: 'fox-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transformBox: 'fill-box',
                transformOrigin: '20% 100%',
              }}
            >
              <path d="M300 96 L 288 122 L 316 106 Z" fill="#FFFFFF" />
              <rect x="292" y="48" width="82" height="54" rx="27" fill="#FFFFFF" />
              <text
                x="333"
                y="84"
                textAnchor="middle"
                fontFamily="Inter, sans-serif"
                fontWeight="800"
                fontSize="28"
                fill="#F16524"
              >
                Hi!
              </text>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
