import type { ReactNode } from "react";

const INK = "#241B15";
const WHITE = "#FFFFFF";
const CREAM = "#FBF5EC";
const PAPER = "#F4EFE6";
const HAIRLINE = "#DDD6C8";
const ORANGE = "#F26B1D";
const ORANGE_SIDE = "#E8600F";

const K = 0.866;
const O = { x: 480, y: 400 };

type Pt = [number, number];

const p = (x: number, y: number, z = 0): Pt => [O.x + (x - y) * K, O.y + (x + y) * 0.5 - z];
const f = (n: number) => Math.round(n * 10) / 10;
const pts = (...list: Pt[]) => list.map(([a, b]) => `${f(a)},${f(b)}`).join(" ");
const mtx = (a: number, b: number, c: number, d: number, [e, g]: Pt) => `matrix(${a} ${b} ${c} ${d} ${f(e)} ${f(g)})`;
/** Local (u,v) on the ground plane at height z: u along world x, v along world y. */
const onTop = (x: number, y: number, z: number) => mtx(K, 0.5, -K, 0.5, p(x, y, z));
/** Local (u,v) on a +x facing wall: u along world y, v downward. */
const onFaceX = (x: number, y: number, z: number) => mtx(-K, 0.5, 0, 1, p(x, y, z));
/** Local (u,v) on a +y facing wall: u along world x, v downward. */
const onFaceY = (x: number, y: number, z: number) => mtx(K, 0.5, 0, 1, p(x, y, z));

const thin = { vectorEffect: "non-scaling-stroke" as const };

function Box({ x, y, z, w, d, h, topFill = WHITE }: { x: number; y: number; z: number; w: number; d: number; h: number; topFill?: string }) {
  const x1 = x + w;
  const y1 = y + d;
  const z1 = z + h;
  return (
    <g>
      <polygon points={pts(p(x1, y, z), p(x1, y1, z), p(x1, y1, z1), p(x1, y, z1))} fill={PAPER} />
      <polygon points={pts(p(x, y1, z), p(x1, y1, z), p(x1, y1, z1), p(x, y1, z1))} fill={CREAM} />
      <polygon points={pts(p(x, y, z1), p(x1, y, z1), p(x1, y1, z1), p(x, y1, z1))} fill={topFill} />
    </g>
  );
}

function Ghost({ x, y, w, d, gap = 12 }: { x: number; y: number; w: number; d: number; gap?: number }) {
  return (
    <polygon
      points={pts(p(x - gap, y - gap), p(x + w + gap, y - gap), p(x + w + gap, y + d + gap), p(x - gap, y + d + gap))}
      fill="none"
      stroke={INK}
      strokeOpacity={0.3}
      strokeDasharray="3 4"
    />
  );
}

function Cylinder({ r, z0, z1, side = CREAM, top = WHITE }: { r: number; z0: number; z1: number; side?: string; top?: string }) {
  const [cx, b] = p(0, 0, z0);
  const [, t] = p(0, 0, z1);
  const rx = r * 1.2247;
  const ry = r * 0.7071;
  return (
    <g>
      <path d={`M${f(cx - rx)} ${f(t)} L${f(cx - rx)} ${f(b)} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(b)} L${f(cx + rx)} ${f(t)} Z`} fill={side} />
      <ellipse cx={f(cx)} cy={f(t)} rx={f(rx)} ry={f(ry)} fill={top} />
    </g>
  );
}

const ellipseAt = (r: number, z: number) => {
  const [cx, cy] = p(0, 0, z);
  return { cx: f(cx), cy: f(cy), rx: f(r * 1.2247), ry: f(r * 0.7071) };
};

const MARK_PATH =
  "M147 835H360C430 835 490 780 490 710V590C490 525 545 470 615 470H752C800 470 835 507 835 555C835 600 800 637 752 637H705C655 637 620 675 620 718C620 780 680 835 740 835H978";

/** The machine itself. `ghost` renders it as a flat line drawing for secondary sections. */
export function EngineUnit({ ghost = false }: { ghost?: boolean }) {
  const window = ellipseAt(54, 138);
  return (
    <g stroke={INK} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round">
      {!ghost && <Ghost x={-150} y={-150} w={300} d={300} gap={14} />}
      <Box x={-150} y={-150} z={0} w={300} d={300} h={14} topFill={CREAM} />
      <Box x={-115} y={-115} z={14} w={230} d={230} h={110} />
      <polyline points={pts(p(115, -115, 44), p(115, 115, 44), p(-115, 115, 44))} fill="none" strokeOpacity={0.35} />

      {/* Output slot on the +x wall, centred on the band. */}
      <g transform={onFaceX(115, -115, 124)}>
        <rect x={62} y={60} width={106} height={46} rx={6} fill={INK} fillOpacity={ghost ? 0 : 0.9} {...thin} />
        {!ghost && <line x1={70} y1={70} x2={160} y2={70} stroke={WHITE} strokeOpacity={0.35} {...thin} />}
      </g>

      {/* Front wall: engraved Reflex mark and vents. */}
      <g transform={onFaceY(-115, 115, 124)}>
        <g transform="translate(26 30) scale(0.1) translate(-140 -430)">
          <path d={MARK_PATH} fill="none" strokeWidth={56} strokeLinecap="butt" strokeOpacity={0.85} />
          <circle cx={1058} cy={835} r={46} fill={INK} fillOpacity={0.85} stroke="none" />
        </g>
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={152 + i * 12} y1={28} x2={152 + i * 12} y2={62} strokeOpacity={0.55} {...thin} />
        ))}
      </g>

      {/* Bolts */}
      {[
        [-97, -97],
        [97, -97],
        [97, 97],
        [-97, 97],
      ].map(([bx, by]) => {
        const [cx, cy] = p(bx, by, 124);
        return <ellipse key={`${bx}${by}`} cx={f(cx)} cy={f(cy)} rx={6} ry={3.5} fill={CREAM} />;
      })}

      <Cylinder r={70} z0={124} z1={138} />
      <ellipse {...window} fill={PAPER} />

      {!ghost && (
        <>
          <defs>
            <clipPath id="eng-window">
              <ellipse {...window} />
            </clipPath>
          </defs>
          <g clipPath="url(#eng-window)" stroke="none">
            <rect className="eng-anim eng-scan" x={window.cx - 6} y={window.cy - 40} width={12} height={80} fill={WHITE} fillOpacity={0.7} />
          </g>
          <ellipse className="eng-anim eng-ring" {...ellipseAt(62, 138)} fill="none" strokeOpacity={0.4} strokeDasharray="5 7" />
          <ellipse className="eng-anim eng-ripple" {...ellipseAt(22, 152)} fill="none" strokeOpacity={0.45} />
          <g className="eng-anim eng-core">
            <Cylinder r={22} z0={140} z1={152} side={ORANGE_SIDE} top={ORANGE} />
          </g>
          <path
            d={`M${window.cx - 46} ${window.cy - 8} A66 38 0 0 1 ${window.cx - 12} ${window.cy - 28}`}
            fill="none"
            stroke={WHITE}
            strokeWidth={2}
            strokeOpacity={0.9}
          />
        </>
      )}
    </g>
  );
}

type SheetKind = "social" | "research" | "market" | "conviction" | "note";

function SheetContent({ kind, w, h }: { kind: SheetKind; w: number; h: number }) {
  const l = -w / 2;
  const t = -h / 2;
  const line = (x1: number, y1: number, x2: number, y2: number, key?: string | number, o = 0.7) => (
    <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} strokeOpacity={o} {...thin} />
  );
  switch (kind) {
    case "social":
      return (
        <>
          <circle cx={l + 15} cy={t + 15} r={7} fill={CREAM} {...thin} />
          {line(l + 28, t + 12, l + 62, t + 12)}
          {line(l + 28, t + 19, l + 48, t + 19, "b", 0.4)}
          {line(l + 10, t + 34, w / 2 - 12, t + 34, "c")}
          {line(l + 10, t + 43, w / 2 - 24, t + 43, "d")}
          {line(l + 10, t + 52, l + 40, t + 52, "e")}
        </>
      );
    case "research":
      return (
        <>
          {[0, 1, 2, 3].map((i) => line(l + 10, t + 12 + i * 10, w / 2 - (i % 2 ? 22 : 10), t + 12 + i * 10, i, 0.55))}
          {line(l + 10, t + 54, l + 34, t + 54, "x", 0.55)}
        </>
      );
    case "market":
      return (
        <>
          <polyline
            points={`${l + 10},${t + 44} ${l + 22},${t + 36} ${l + 32},${t + 40} ${l + 44},${t + 22} ${l + 56},${t + 30} ${l + 68},${t + 14} ${l + 80},${t + 20}`}
            fill="none"
            {...thin}
          />
          {line(l + 10, t + 52, w / 2 - 10, t + 52, "base", 0.35)}
        </>
      );
    case "conviction":
      return (
        <>
          {line(l + 22, t + 12, l + 22, t + 32, "bang", 0.9)}
          <circle cx={l + 22} cy={t + 40} r={1.6} fill={INK} stroke="none" />
          {line(l + 34, t + 18, w / 2 - 10, t + 18, "a", 0.6)}
          {line(l + 34, t + 28, w / 2 - 18, t + 28, "b", 0.6)}
          <path d={`M${l + 10} ${t + 52} q8 -5 16 0 t16 0 t16 0`} fill="none" strokeOpacity={0.7} {...thin} />
        </>
      );
    case "note":
      return (
        <>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={l + 10} y={t + 10 + i * 15} width={8} height={8} rx={1.5} fill="none" strokeOpacity={0.7} {...thin} />
              {line(l + 24, t + 14 + i * 15, w / 2 - 12 - i * 8, t + 14 + i * 15, `l${i}`, 0.55)}
            </g>
          ))}
        </>
      );
  }
}

function sheetOutline(kind: SheetKind, w: number, h: number): ReactNode {
  const l = -w / 2;
  const t = -h / 2;
  if (kind === "research") {
    const teeth = 7;
    const step = w / teeth;
    let d = `M${l} ${t} H${-l} V${-t - 4}`;
    for (let i = teeth - 1; i >= 0; i--) d += ` L${l + i * step + step / 2} ${-t + (i % 2 ? 2 : -4)} L${l + i * step} ${-t - 4}`;
    return <path d={`${d} Z`} {...thin} />;
  }
  if (kind === "social") {
    return <path d={`M${l + 6} ${t} H${-l - 6} Q${-l} ${t} ${-l} ${t + 6} V${-t - 6} Q${-l} ${-t} ${-l - 6} ${-t} H${l + 26} L${l + 14} ${-t + 10} L${l + 16} ${-t} H${l + 6} Q${l} ${-t} ${l} ${-t - 6} V${t + 6} Q${l} ${t} ${l + 6} ${t} Z`} {...thin} />;
  }
  return <rect x={l} y={t} width={w} height={h} rx={kind === "conviction" ? 2 : 5} {...thin} />;
}

type Sheet = { kind: SheetKind; x: number; y: number; z: number; rot: number; w: number; h: number; fill?: string };

function FloatingSheet({ kind, x, y, z, rot, w, h, fill = WHITE }: Sheet) {
  return (
    <g>
      <g transform={`${onTop(x, y, 0)} rotate(${rot})`} fill="none" stroke={INK} strokeOpacity={0.3} strokeDasharray="3 4">
        {sheetOutline(kind, w + 10, h + 10)}
      </g>
      <g transform={`${onTop(x, y, z - 4)} rotate(${rot})`} fill={PAPER}>
        {sheetOutline(kind, w, h)}
      </g>
      <g transform={`${onTop(x, y, z)} rotate(${rot})`} fill={fill}>
        {sheetOutline(kind, w, h)}
        <SheetContent kind={kind} w={w} h={h} />
      </g>
    </g>
  );
}

const INPUTS: (Sheet & { label: string; lx: number; ly: number; anchor?: "start" | "end" })[] = [
  { kind: "social", label: "SOCIAL CALL", x: -470, y: -110, z: 54, rot: -14, w: 90, h: 64, lx: -40, ly: -62, anchor: "start" },
  { kind: "market", label: "MARKET CONTEXT", x: -300, y: -230, z: 34, rot: 9, w: 92, h: 62, lx: 0, ly: -56, anchor: "start" },
  { kind: "research", label: "RESEARCH NOTE", x: -420, y: 130, z: 40, rot: 18, w: 84, h: 66, lx: -96, ly: 64, anchor: "start" },
  { kind: "conviction", label: "CONVICTION", x: -250, y: 175, z: 60, rot: -10, w: 66, h: 64, lx: -40, ly: 76, anchor: "start" },
  { kind: "note", label: "DECISION NOTE", x: -560, y: 40, z: 26, rot: 6, w: 84, h: 60, lx: -44, ly: -50, anchor: "start" },
];

const STACK = { x: 305, y: -75, w: 150, d: 150, slab: 16, pitch: 26 };
const OUTPUTS = ["DECISION REVIEW", "PROCESS QUALITY", "DECISION DNA", "PLAN DRIFT", "PLAYBOOK RULE", "RECALL"];

function Band() {
  const y0 = -52;
  const y1 = 52;
  const chevrons: number[] = [];
  for (let x = -720; x <= 760; x += 100) if (Math.abs(x) > 200 && (x < 280 || x > 480)) chevrons.push(x);
  return (
    <g strokeLinejoin="round">
      <polygon points={pts(p(-900, y0), p(900, y0), p(900, y1), p(-900, y1))} fill={WHITE} stroke={INK} strokeOpacity={0.45} strokeWidth={1.25} />
      <line x1={p(-900, y0 - 12)[0]} y1={p(-900, y0 - 12)[1]} x2={p(900, y0 - 12)[0]} y2={p(900, y0 - 12)[1]} stroke={INK} strokeOpacity={0.3} strokeDasharray="3 4" />
      <line x1={p(-900, y1 + 12)[0]} y1={p(-900, y1 + 12)[1]} x2={p(900, y1 + 12)[0]} y2={p(900, y1 + 12)[1]} stroke={INK} strokeOpacity={0.3} strokeDasharray="3 4" />
      {chevrons.map((x) => (
        <path key={x} transform={onTop(x, 0, 0)} d="M-8 -11 L8 0 L-8 11" fill="none" stroke={HAIRLINE} strokeWidth={2.5} strokeLinecap="round" {...thin} />
      ))}
    </g>
  );
}

function Scrap({ rot, w, h }: { rot: number; w: number; h: number }) {
  return (
    <g transform={`${onTop(-760, 0, 6)}`}>
      <g className="eng-anim eng-wobble" style={{ animationDelay: `${rot * 0.05}s` }}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3} transform={`rotate(${rot})`} fill={WHITE} stroke={INK} strokeWidth={1.5} {...thin} />
        <line x1={-w / 2 + 7} y1={-2} x2={w / 2 - 9} y2={-2} transform={`rotate(${rot})`} stroke={INK} strokeOpacity={0.5} {...thin} />
      </g>
    </g>
  );
}

function OutputCard() {
  return (
    <g transform={onTop(STACK.x - 120, 0, 10)} stroke={INK} strokeWidth={1.5}>
      <rect x={-30} y={-30} width={60} height={60} rx={4} fill={WHITE} {...thin} />
      {[0, 1, 2].map((i) => (
        <line key={i} x1={-18} y1={-14 + i * 12} x2={i === 2 ? 4 : 18} y2={-14 + i * 12} strokeOpacity={0.6} {...thin} />
      ))}
    </g>
  );
}

function OutputStack() {
  const { x, y, w, d, slab, pitch } = STACK;
  const topZ = (OUTPUTS.length - 1) * pitch + slab;
  return (
    <g stroke={INK} strokeWidth={1.5} strokeLinejoin="round">
      <Ghost x={x} y={y} w={w} d={d} />
      {OUTPUTS.map((label, i) => (
        <g key={label} className={i === OUTPUTS.length - 1 ? "eng-anim eng-settle" : undefined}>
          <Box x={x} y={y} z={i * pitch} w={w} d={d} h={slab} />
        </g>
      ))}
      <g className="eng-anim eng-settle">
        <g transform={onTop(x, y, topZ)}>
          {[92, 64, 108, 48, 80].map((len, i) => (
            <line key={i} x1={22} y1={26 + i * 22} x2={22 + len} y2={26 + i * 22} strokeOpacity={i === 0 ? 0.85 : 0.5} {...thin} />
          ))}
        </g>
      </g>
      {OUTPUTS.map((label, i) => {
        const [ax, ay] = p(x + w, y + 34, i * pitch + slab / 2);
        const tx = 968;
        return (
          <g key={label}>
            <line className="eng-leader" x1={f(ax + 4)} y1={f(ay)} x2={tx - 10} y2={f(ay)} strokeOpacity={0.35} strokeWidth={1} />
            <circle className="eng-leader" cx={f(ax + 4)} cy={f(ay)} r={2} fill={INK} stroke="none" />
            <text className="eng-label" x={tx} y={f(ay + 5.5)} stroke="none">
              {label}
            </text>
          </g>
        );
      }).reverse()}
    </g>
  );
}

export function ReflexEngineArt() {
  return (
    <svg
      viewBox="-100 -10 1280 790"
      className="block h-auto w-full overflow-visible"
      role="img"
      aria-labelledby="reflex-engine-title reflex-engine-desc"
    >
      <title id="reflex-engine-title">The Reflex Engine</title>
      <desc id="reflex-engine-desc">
        An isometric illustration. Scattered inputs, a social call, market context, a research note, personal conviction and a decision note, ride a
        band into a central machine with an orange core. On the far side the machine files structured outputs into a neat stack: decision review,
        process quality, Decision DNA, plan drift, a Playbook rule and recall.
      </desc>

      <Band />

      <g className="eng-flow" stroke={INK}>
        {[
          { rot: -18, w: 42, h: 30, delay: 0 },
          { rot: 12, w: 34, h: 40, delay: -2.5 },
          { rot: -6, w: 46, h: 28, delay: -5 },
        ].map((s, i) => (
          <g key={i} className="eng-anim eng-in" style={{ animationDelay: `${s.delay}s` }}>
            <Scrap rot={s.rot} w={s.w} h={s.h} />
          </g>
        ))}
      </g>

      <g strokeLinejoin="round" strokeLinecap="round" stroke={INK} strokeWidth={1.5}>
        {INPUTS.map(({ label, lx, ly, anchor, ...sheet }) => {
          const [sx, sy] = p(sheet.x, sheet.y, sheet.z);
          return (
            <g key={label}>
              <FloatingSheet {...sheet} />
              <text className="eng-label" x={f(sx + lx)} y={f(sy + ly)} textAnchor={anchor} stroke="none">
                {label}
              </text>
            </g>
          );
        })}
      </g>

      <EngineUnit />

      <g className="eng-flow">
        {[0, -2.5].map((delay) => (
          <g key={delay} className="eng-anim eng-out" style={{ animationDelay: `${delay}s` }}>
            <OutputCard />
          </g>
        ))}
      </g>

      <OutputStack />
    </svg>
  );
}

export function EngineGhost({ className }: { className?: string }) {
  return (
    <svg viewBox="200 120 560 440" className={className} aria-hidden="true" focusable="false">
      <g opacity={0.08}>
        <EngineUnit ghost />
      </g>
    </svg>
  );
}
