"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { lookupLocode, type Place } from "@/lib/locode";
import { WORLD_LAND_PATH, WORLD_VIEW } from "@/lib/world-land";

/**
 * Geographic corridor map — pure SVG, no mapping library, no tile server.
 *
 * Lanes are UN/LOCODE pairs with a volume; the map plots each endpoint, draws
 * an arc between them weighted by volume, and auto-fits the viewport to the
 * corridors actually present. A book of Durban–Johannesburg moves zooms into
 * Southern Africa; add a Shanghai lane and it pulls back to show the Indian
 * Ocean. Nothing to configure.
 *
 * Deliberate limitation: this is an equirectangular flat map, so a lane is
 * drawn as the straight-on-the-map path between its endpoints, not a great
 * circle, and a lane crossing the antimeridian is drawn the long way round.
 * Neither matters on the corridors this platform serves; both would if it ever
 * carried transpacific volume.
 */

export interface CorridorLane {
  origin: string;
  destination: string;
  value: number;
  /** Overrides the volume-derived colour — for flagging lanes with exceptions. */
  tone?: LaneTone;
}

type LaneTone = "accent" | "success" | "warning" | "critical";

const TONE_VAR: Record<LaneTone, string> = {
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  critical: "var(--critical)",
};

const VB_W = 1000;
const MIN_SPAN = 260; // world units (~47° of longitude) — floor on zoom-in
const PAD_FRACTION = 0.14;
const DEFAULT_ASPECT = 1000 / 480;

interface PlottedNode {
  place: Place;
  x: number;
  y: number;
  volume: number;
  lanes: number;
  r: number;
  /** False when the code would overprint a busier port's label. */
  label: boolean;
  labelLeft: boolean;
}

interface PlottedLane {
  key: string;
  from: PlottedNode;
  to: PlottedNode;
  value: number;
  tone: LaneTone;
  d: string;
  width: number;
}

/** Equirectangular: lon −180…180 → 0…2000, lat 90…−90 → 0…1000. */
function toWorld(place: Place): [number, number] {
  return [
    ((place.lon + 180) / 360) * WORLD_VIEW.width,
    ((90 - place.lat) / 180) * WORLD_VIEW.height,
  ];
}

export function CorridorMap({
  lanes,
  className,
  emptyLabel = "No mapped corridors yet.",
  aspect = DEFAULT_ASPECT,
}: {
  lanes: CorridorLane[];
  className?: string;
  emptyLabel?: string;
  /** Width ÷ height. Raise it where the map is one panel among many. */
  aspect?: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const model = useMemo(() => buildModel(lanes, aspect), [lanes, aspect]);

  if (!model) {
    return (
      <div
        className={cn(
          "flex h-[260px] items-center justify-center rounded border border-hairline bg-inset text-[12px] text-tertiary",
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  const { nodes, plotted, transform, vbHeight, unmapped, graticule } = model;
  const active = plotted.find((l) => l.key === hovered) ?? null;

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded border border-hairline bg-inset">
        <svg
          viewBox={`0 0 ${VB_W} ${vbHeight}`}
          className="block w-full"
          role="img"
          aria-label={`Corridor map covering ${plotted.length} lanes across ${nodes.length} locations`}
        >
          {/* Graticule — reference only, drawn under everything else. */}
          <g stroke="var(--border-hairline)" strokeWidth={0.5} opacity={0.55}>
            {graticule.map((g) =>
              g.horizontal ? (
                <line key={g.key} x1={0} y1={g.at} x2={VB_W} y2={g.at} />
              ) : (
                <line key={g.key} x1={g.at} y1={0} x2={g.at} y2={vbHeight} />
              ),
            )}
          </g>

          {/* Landmass. Scaled with the viewport, so its stroke must not be. */}
          <g transform={`translate(${transform.tx} ${transform.ty}) scale(${transform.k})`}>
            <path
              d={WORLD_LAND_PATH}
              fill="var(--bg-raised)"
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>

          {/* Lanes. */}
          <g fill="none" strokeLinecap="round">
            {plotted.map((lane) => {
              const dim = hovered !== null && hovered !== lane.key;
              return (
                <g key={lane.key}>
                  <path
                    d={lane.d}
                    stroke={TONE_VAR[lane.tone]}
                    strokeWidth={lane.width}
                    opacity={dim ? 0.16 : hovered === lane.key ? 1 : 0.62}
                  />
                  {/* Fat invisible hit area — the visible stroke is too thin to hover. */}
                  <path
                    d={lane.d}
                    stroke="transparent"
                    strokeWidth={Math.max(12, lane.width + 10)}
                    className="cursor-pointer"
                    onMouseEnter={() => setHovered(lane.key)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <title>{`${lane.from.place.name} → ${lane.to.place.name}: ${lane.value}`}</title>
                  </path>
                </g>
              );
            })}
          </g>

          {/* Nodes. */}
          <g>
            {nodes.map((node) => {
              const touched =
                active !== null &&
                (active.from.place.code === node.place.code ||
                  active.to.place.code === node.place.code);
              const dim = hovered !== null && !touched;
              return (
                <g key={node.place.code} opacity={dim ? 0.25 : 1}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.r + 3}
                    fill="var(--accent)"
                    opacity={touched ? 0.22 : 0.1}
                  />
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.r}
                    fill="var(--bg-canvas)"
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                  />
                  {(node.label || touched) && (
                    <text
                      x={node.labelLeft ? node.x - node.r - 5 : node.x + node.r + 5}
                      y={node.y + 3.5}
                      textAnchor={node.labelLeft ? "end" : "start"}
                      fill={touched ? "var(--text-primary)" : "var(--text-secondary)"}
                      fontSize={10}
                      fontFamily="var(--font-mono), monospace"
                      style={{ pointerEvents: "none" }}
                    >
                      {node.place.code}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Readout. Fixed height so hovering doesn't reflow the panel. */}
        <div className="flex h-8 items-center justify-between gap-3 border-t border-hairline bg-surface px-3 text-[11px]">
          {active ? (
            <>
              <span className="truncate text-primary">
                <span className="font-mono">{active.from.place.code}</span>{" "}
                {active.from.place.name} <span className="text-tertiary">→</span>{" "}
                <span className="font-mono">{active.to.place.code}</span> {active.to.place.name}
              </span>
              <span className="tabular shrink-0 font-mono text-accent">
                {active.value} {active.value === 1 ? "shipment" : "shipments"}
              </span>
            </>
          ) : (
            <>
              <span className="text-tertiary">
                {plotted.length} {plotted.length === 1 ? "lane" : "lanes"} · {nodes.length}{" "}
                locations · hover a lane for detail
              </span>
              <span className="shrink-0 text-tertiary">Equirectangular · UN/LOCODE</span>
            </>
          )}
        </div>
      </div>

      {unmapped.length > 0 && (
        <p className="mt-2 text-[11px] text-tertiary">
          Not plotted — no coordinates on file for{" "}
          <span className="font-mono text-secondary">{unmapped.join(", ")}</span>. Add them to{" "}
          <span className="font-mono">lib/locode.ts</span> to bring these lanes onto the map.
        </p>
      )}
    </div>
  );
}

// --- geometry ------------------------------------------------------------

function buildModel(lanes: CorridorLane[], aspect: number) {
  const unmapped = new Set<string>();
  const resolved: { from: Place; to: Place; value: number; tone?: LaneTone }[] = [];

  for (const lane of lanes) {
    const from = lookupLocode(lane.origin);
    const to = lookupLocode(lane.destination);
    if (!from) unmapped.add(lane.origin.toUpperCase());
    if (!to) unmapped.add(lane.destination.toUpperCase());
    // A lane from a place to itself has no arc to draw, but its endpoint is
    // still worth plotting, so it is kept and rendered as a node only.
    if (from && to) resolved.push({ from, to, value: lane.value, tone: lane.tone });
  }

  if (resolved.length === 0) return null;

  // Aggregate endpoints so a port on ten lanes is one node, sized by its total.
  const nodeAcc = new Map<string, { place: Place; volume: number; lanes: number }>();
  for (const lane of resolved) {
    for (const place of [lane.from, lane.to]) {
      const entry = nodeAcc.get(place.code) ?? { place, volume: 0, lanes: 0 };
      entry.volume += lane.value;
      entry.lanes += 1;
      nodeAcc.set(place.code, entry);
    }
  }

  // --- fit the viewport to the corridors present -------------------------
  const world = [...nodeAcc.values()].map((n) => toWorld(n.place));
  let x0 = Math.min(...world.map((w) => w[0]));
  let x1 = Math.max(...world.map((w) => w[0]));
  let y0 = Math.min(...world.map((w) => w[1]));
  let y1 = Math.max(...world.map((w) => w[1]));

  const padX = Math.max((x1 - x0) * PAD_FRACTION, 40);
  const padY = Math.max((y1 - y0) * PAD_FRACTION, 40);
  x0 -= padX;
  x1 += padX;
  y0 -= padY;
  y1 += padY;

  // Floor the span so a single-lane book doesn't zoom to street level.
  const widen = (lo: number, hi: number, min: number): [number, number] => {
    const span = hi - lo;
    if (span >= min) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - min / 2, mid + min / 2];
  };
  [x0, x1] = widen(x0, x1, MIN_SPAN);
  [y0, y1] = widen(y0, y1, MIN_SPAN / aspect);

  // Match the target aspect by growing the short axis, never cropping.
  let spanX = x1 - x0;
  let spanY = y1 - y0;
  if (spanX / spanY < aspect) {
    [x0, x1] = widen(x0, x1, spanY * aspect);
  } else {
    [y0, y1] = widen(y0, y1, spanX / aspect);
  }
  spanX = x1 - x0;
  spanY = y1 - y0;

  const k = VB_W / spanX;
  const transform = { k, tx: -x0 * k, ty: -y0 * k };
  const vbHeight = Math.round(spanY * k);
  const project = (place: Place): [number, number] => {
    const [wx, wy] = toWorld(place);
    return [wx * k + transform.tx, wy * k + transform.ty];
  };

  const maxVolume = Math.max(...[...nodeAcc.values()].map((n) => n.volume));
  const nodes = [...nodeAcc.values()]
    .map((n) => {
      const [x, y] = project(n.place);
      return {
        ...n,
        x,
        y,
        // Square-root scaling: area tracks volume, so a 10× lane doesn't
        // produce a 10×-wide blob that swallows its neighbours.
        r: 3 + 4 * Math.sqrt(n.volume / maxVolume),
        label: true,
        labelLeft: false,
      };
    })
    .sort((a, b) => b.volume - a.volume);

  // Zoomed out far enough, ports cluster tightly and their codes overprint each
  // other into mush. Place labels greedily by volume — busiest port wins the
  // space — and drop any that would collide. A dropped label still appears on
  // hover, so nothing becomes unreachable.
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const LABEL_W = 34;
  const LABEL_H = 11;
  for (const node of nodes) {
    const left = node.x + node.r + 5 + LABEL_W > VB_W;
    const bx0 = left ? node.x - node.r - 5 - LABEL_W : node.x + node.r + 5;
    const box = { x0: bx0, x1: bx0 + LABEL_W, y0: node.y - LABEL_H / 2, y1: node.y + LABEL_H / 2 };
    const collides = placed.some(
      (q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0,
    );
    node.labelLeft = left;
    node.label = !collides;
    if (!collides) placed.push(box);
  }

  const nodeByCode = new Map(nodes.map((n) => [n.place.code, n]));
  const maxLane = Math.max(...resolved.map((l) => l.value));

  const plotted: PlottedLane[] = resolved
    .filter((lane) => lane.from.code !== lane.to.code)
    .map((lane) => {
      const from = nodeByCode.get(lane.from.code)!;
      const to = nodeByCode.get(lane.to.code)!;
      return {
        key: `${lane.from.code}-${lane.to.code}`,
        from,
        to,
        value: lane.value,
        tone: lane.tone ?? "accent",
        d: arcPath(from, to),
        width: 0.9 + 3.1 * Math.sqrt(lane.value / maxLane),
      };
    })
    .sort((a, b) => a.value - b.value); // heaviest lanes drawn last, on top

  return {
    nodes,
    plotted,
    transform,
    vbHeight,
    graticule: graticuleLines(x0, x1, y0, y1, k, transform),
    unmapped: [...unmapped].sort(),
  };
}

/**
 * Quadratic bézier bowing to the left of the direction of travel — the
 * convention that makes an eastbound northern-hemisphere lane arc upward, the
 * way a great circle would.
 */
function arcPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(len * 0.16, 70);
  const cx = mx + (dy / len) * bow;
  const cy = my - (dx / len) * bow;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** Meridians/parallels on a round-degree step chosen to keep ~4–8 of each. */
function graticuleLines(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  k: number,
  t: { tx: number; ty: number },
) {
  const degSpan = ((x1 - x0) / WORLD_VIEW.width) * 360;
  const step = [5, 10, 15, 30, 45].find((s) => degSpan / s <= 8) ?? 60;
  const out: { key: string; at: number; horizontal: boolean }[] = [];

  const lonFrom = Math.ceil((((x0 / WORLD_VIEW.width) * 360 - 180) / step)) * step;
  for (let lon = lonFrom; ((lon + 180) / 360) * WORLD_VIEW.width <= x1; lon += step) {
    const wx = ((lon + 180) / 360) * WORLD_VIEW.width;
    out.push({ key: `lon${lon}`, at: wx * k + t.tx, horizontal: false });
  }

  const latFrom = Math.ceil(((90 - (y1 / WORLD_VIEW.height) * 180) / step)) * step;
  for (let lat = latFrom; ((90 - lat) / 180) * WORLD_VIEW.height >= y0; lat += step) {
    const wy = ((90 - lat) / 180) * WORLD_VIEW.height;
    out.push({ key: `lat${lat}`, at: wy * k + t.ty, horizontal: true });
  }
  return out;
}
