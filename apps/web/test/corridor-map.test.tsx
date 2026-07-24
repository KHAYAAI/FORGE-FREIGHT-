import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CorridorMap, type CorridorLane } from "@/components/ui/corridor-map";

afterEach(cleanup);

/** Circle centres, keyed by the port code label sitting next to them. */
function nodeCentres(container: HTMLElement): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const text of container.querySelectorAll("text")) {
    const code = text.textContent ?? "";
    // The label is offset from its node by r + 5; the node itself is the
    // outlined circle immediately before it in the same <g>.
    const circle = text.parentElement?.querySelector("circle:nth-of-type(2)");
    if (circle) {
      out.set(code, {
        x: Number(circle.getAttribute("cx")),
        y: Number(circle.getAttribute("cy")),
      });
    }
  }
  return out;
}

function lanePaths(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll("path")].filter(
    (p) => p.getAttribute("stroke") !== null && p.getAttribute("stroke") !== "var(--border-strong)",
  ) as SVGPathElement[];
}

const REGIONAL: CorridorLane[] = [
  { origin: "ZADUR", destination: "ZAJNB", value: 30 },
  { origin: "ZACPT", destination: "ZAJNB", value: 12 },
];

describe("CorridorMap", () => {
  it("plots a node per distinct location and an arc per lane", () => {
    const { container } = render(<CorridorMap lanes={REGIONAL} />);

    expect(nodeCentres(container).size).toBe(3); // ZADUR, ZAJNB, ZACPT
    // Each lane draws a visible stroke plus a transparent hit area.
    expect(lanePaths(container).filter((p) => p.getAttribute("stroke") !== "transparent")).toHaveLength(2);
  });

  it("reports unmapped codes instead of guessing a position for them", () => {
    const { container } = render(
      <CorridorMap lanes={[...REGIONAL, { origin: "XXXXX", destination: "ZADUR", value: 3 }]} />,
    );

    expect(screen.getByText(/no coordinates on file/i)).toBeTruthy();
    expect(screen.getByText("XXXXX")).toBeTruthy();
    // The unmappable lane is dropped; the two real ones still draw.
    expect(lanePaths(container).filter((p) => p.getAttribute("stroke") !== "transparent")).toHaveLength(2);
  });

  it("says nothing about unmapped codes when every code resolves", () => {
    render(<CorridorMap lanes={REGIONAL} />);
    expect(screen.queryByText(/no coordinates on file/i)).toBeNull();
  });

  it("zooms in on a regional book and pulls back for an intercontinental one", () => {
    // The same two South African ports should sit much further apart on a map
    // fitted to Southern Africa than on one that also has to show Shanghai.
    const regional = render(<CorridorMap lanes={REGIONAL} />);
    const near = nodeCentres(regional.container);
    const regionalGap = Math.hypot(
      near.get("ZADUR")!.x - near.get("ZAJNB")!.x,
      near.get("ZADUR")!.y - near.get("ZAJNB")!.y,
    );
    cleanup();

    const global = render(
      <CorridorMap lanes={[...REGIONAL, { origin: "CNSHA", destination: "ZADUR", value: 40 }]} />,
    );
    const far = nodeCentres(global.container);
    const globalGap = Math.hypot(
      far.get("ZADUR")!.x - far.get("ZAJNB")!.x,
      far.get("ZADUR")!.y - far.get("ZAJNB")!.y,
    );

    expect(regionalGap).toBeGreaterThan(globalGap * 2);
  });

  it("honours the aspect prop in the rendered viewBox", () => {
    const { container } = render(<CorridorMap lanes={REGIONAL} aspect={3} />);
    const [, , w, h] = container.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    expect(w / h).toBeCloseTo(3, 1);
  });

  it("colours a lane by its tone so exceptions read as exceptions", () => {
    const { container } = render(
      <CorridorMap lanes={[{ ...REGIONAL[0], tone: "critical" }, REGIONAL[1]]} />,
    );
    const strokes = lanePaths(container).map((p) => p.getAttribute("stroke"));
    expect(strokes).toContain("var(--critical)");
    expect(strokes).toContain("var(--accent)");
  });

  it("scales heavier lanes to a thicker stroke", () => {
    const { container } = render(
      <CorridorMap
        lanes={[
          { origin: "ZADUR", destination: "ZAJNB", value: 100 },
          { origin: "ZACPT", destination: "ZAJNB", value: 1 },
        ]}
      />,
    );
    const widths = lanePaths(container)
      .filter((p) => p.getAttribute("stroke") !== "transparent")
      .map((p) => Number(p.getAttribute("stroke-width")));
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths));
  });

  it("plots a location that only appears on a self-lane, without an arc", () => {
    const { container } = render(
      <CorridorMap lanes={[{ origin: "ZADUR", destination: "ZADUR", value: 2 }]} />,
    );
    expect(nodeCentres(container).size).toBe(1);
    expect(lanePaths(container).filter((p) => p.getAttribute("stroke") !== "transparent")).toHaveLength(0);
  });

  it("names the lane in the readout on hover", () => {
    const { container } = render(<CorridorMap lanes={REGIONAL} />);
    expect(screen.getByText(/hover a lane for detail/i)).toBeTruthy();

    const hit = lanePaths(container).find((p) => p.getAttribute("stroke") === "transparent")!;
    fireEvent.mouseEnter(hit);

    expect(screen.queryByText(/hover a lane for detail/i)).toBeNull();
    expect(screen.getByText(/shipments?$/)).toBeTruthy();

    fireEvent.mouseLeave(hit);
    expect(screen.getByText(/hover a lane for detail/i)).toBeTruthy();
  });

  it("falls back to a message rather than an empty frame when nothing is plottable", () => {
    render(
      <CorridorMap
        lanes={[{ origin: "XXXXX", destination: "YYYYY", value: 1 }]}
        emptyLabel="Nothing in transit"
      />,
    );
    expect(screen.getByText("Nothing in transit")).toBeTruthy();
  });

  it("renders nothing plottable for an empty lane list", () => {
    const { container } = render(<CorridorMap lanes={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
