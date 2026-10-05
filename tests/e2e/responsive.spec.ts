import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const board = readFileSync(new URL("../../src/games/alkane-puzzle/client/AlkaneBoard.tsx", import.meta.url), "utf8");
const wordBank = readFileSync(new URL("../../src/games/alkane-puzzle/client/NameWordBank.tsx", import.meta.url), "utf8");
describe("responsive alkane puzzle acceptance", () => {
  it("keeps controls touch-sized and constrains narrow layouts", () => { expect(css).toContain("min-height: 48px"); expect(css).toContain("overflow-x: hidden"); expect(css).toContain("max-width: 420px"); });
  it("supports reduced motion and visible keyboard focus", () => { expect(css).toContain("prefers-reduced-motion"); expect(css).toContain(":focus-visible"); });
  it("supports touch placement, long press moves and word chip reordering", () => {
    expect(board).toContain("onPointerDown");
    expect(board).toContain("setPointerCapture");
    expect(board).toContain("setTimeout");
    expect(wordBank).toContain("onPointerUp");
    expect(wordBank).toContain("data-token-index");
  });
  it("centers active board bounds and keeps notebook word categories readable", () => {
    expect(board).toContain("Math.floor((grid.length-bounds.rows)/2)");
    expect(css).toContain(".alkane-cell.inactive");
    for (const color of ["#e3f0fb","#f1e8fb","#e6f6ea","#fdf0e0"]) expect(css).toContain(color);
  });
});
