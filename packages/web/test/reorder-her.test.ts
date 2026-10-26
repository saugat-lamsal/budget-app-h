import { describe, expect, it } from 'vitest';
import { landingPlace, reordered, stepAside, type RowBox } from '../src/ui/reorder.js';

// Her rulebook, 50.1: her list in the order she chooses, changed by dragging a
// row by its handle. Only the shape of a drag: where the row lands, how far
// the others step aside, and the order after. Made-up sizes.

const ROWS: readonly RowBox[] = [
  { top: 0, height: 80 },
  { top: 80, height: 100 },
  { top: 180, height: 80 },
  { top: 260, height: 80 },
];

describe('50.1 dragging a row to a new place', () => {
  it('50.1 a row not moved past another row\'s middle stays where it is, either way', () => {
    expect(landingPlace(ROWS, 1, 0)).toBe(1);
    // Row 1's middle is at 130; row 0's is at 40 and row 2's at 220.
    expect(landingPlace(ROWS, 1, -89)).toBe(1);
    expect(landingPlace(ROWS, 1, 89)).toBe(1);
  });

  it('50.1 past a row\'s middle it takes that row\'s place, up or down, and one pixel decides', () => {
    expect(landingPlace(ROWS, 1, -91)).toBe(0);
    expect(landingPlace(ROWS, 1, -90)).toBe(1);
    expect(landingPlace(ROWS, 1, 91)).toBe(2);
    expect(landingPlace(ROWS, 1, 90)).toBe(1);
    expect(landingPlace(ROWS, 0, 1_000)).toBe(3);
    expect(landingPlace(ROWS, 3, -1_000)).toBe(0);
  });

  it('50.1 the rows it passes step aside by its height, and no other row moves', () => {
    // Row 0 (80 high) dragged to place 2: rows 1 and 2 step up.
    expect([0, 1, 2, 3].map((at) => stepAside(at, 0, 2, 80))).toEqual([0, -80, -80, 0]);
    // Row 3 dragged to place 1: rows 1 and 2 step down.
    expect([0, 1, 2, 3].map((at) => stepAside(at, 3, 1, 80))).toEqual([0, 80, 80, 0]);
    expect([0, 1, 2, 3].map((at) => stepAside(at, 2, 2, 80))).toEqual([0, 0, 0, 0]);
  });

  it('50.1 the order after a drag: the row taken out and put in its new place, the rest in order', () => {
    expect(reordered(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reordered(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(reordered(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(reordered(['a'], 0, 0)).toEqual(['a']);
  });

  it('50.1 a list of one: nowhere to go', () => {
    expect(landingPlace([{ top: 0, height: 80 }], 0, -500)).toBe(0);
    expect(landingPlace([{ top: 0, height: 80 }], 0, 500)).toBe(0);
  });
});
