// Drag to reorder (her Wishlist list, her rulebook 50.1). Only the shape of a
// drag lives here: where the row being dragged would land, how far each other
// row steps aside, and the order after. What a drop does is what moving the
// row from its sheet does, through the same call (wishlist-items.tsx).

// A row as it was when the drag began: its top on the page and its height.
export interface RowBox {
  readonly top: number;
  readonly height: number;
}

// The place the dragged row lands, dy from where it began: a row it passes
// is one whose middle its own middle has gone past, strictly. Exactly level
// with a row's middle, it has not passed it yet.
export function landingPlace(rows: readonly RowBox[], from: number, dy: number): number {
  const dragged = rows[from];
  if (dragged === undefined) return from;
  const middle = dragged.top + dragged.height / 2 + dy;
  let place = 0;
  rows.forEach((row, at) => {
    if (at === from) return;
    const its = row.top + row.height / 2;
    if (at < from ? its <= middle : its < middle) place += 1;
  });
  return place;
}

// How far another row steps aside while a row of this height is dragged from
// one place to another: up out of its way going down, down going up.
export function stepAside(at: number, from: number, to: number, height: number): number {
  if (from < to && at > from && at <= to) return -height;
  if (to < from && at >= to && at < from) return height;
  return 0;
}

// The order after the row at from is put at to.
export function reordered<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}
