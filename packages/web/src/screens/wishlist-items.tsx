import type { FilledItem, WishlistItem } from '@budget-app/money';
import type { WishlistEdit, WishlistListView, WishlistResponse } from '@budget-app/server/views';
import { useRef, useState, type CSSProperties, type DOMAttributes, type PointerEvent } from 'react';
import { newDecisionId, sendChoice, type Reload } from '../app/api.js';
import { BottomSheet, Button, ButtonRow, Card, ListRow, Money, Notice, TextField } from '../ui/blocks.js';
import { Icon } from '../ui/Icon.js';
import { moneyText } from '../ui/money-format.js';
import { landingPlace, reordered, stepAside, type RowBox } from '../ui/reorder.js';
import { boughtText, itemProgressText, logLineText, moreText, priceOf } from './wishlist-items-text.js';

// Her Wishlist list (her rulebook, 50.1 to 50.3), on Wishlist's own screen:
// the things she is saving for, in her order, each with what the bucket gives
// it (50.2), in words and amount and not only a bar; what was bought, which
// can be changed back (50.3); and every change to the list (13.5). The list
// holds no money: every number comes from the server.
//
// Her order is changed by dragging a row by its handle. A drag of several
// places is sent as that many moves of one place, one after another (50.1
// knows moving one up or down), each logged (13.5). Tapping a row opens its
// own sheet: change it, remove it, or move it a place without dragging (for
// VoiceOver and a keyboard).

type Editing =
  | { readonly kind: 'add' }
  | { readonly kind: 'item'; readonly item: WishlistItem }
  | { readonly kind: 'change'; readonly item: WishlistItem }
  | { readonly kind: 'remove'; readonly item: WishlistItem };

export function WishlistList({ list, reload, onChanged }: { readonly list: WishlistListView; readonly reload: Reload; readonly onChanged: Reload }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [said, setSaid] = useState<{
    readonly tone: 'ok' | 'danger';
    readonly text: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  // A change that could not be sent (no signal): sent again, it keeps its
  // decision number, so it is never made twice.
  const unsent = useRef<{ readonly what: string; readonly id: string } | null>(null);
  // The order on the screen: the one a drop asked for while its moves are on
  // their way, the server's otherwise.
  const ids = list.items.map((item) => item.id);
  const serverOrder = ids.join();
  const [dropped, setDropped] = useState<{ readonly from: string; readonly order: readonly string[] } | null>(null);
  const order = dropped !== null && dropped.from === serverOrder ? dropped.order : ids;
  // A row being dragged by its handle: where it began, where it would land,
  // how far the finger has gone, and every row as it was when it began.
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragNow = useRef<Drag | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const dragTo = (next: Drag | null): void => {
    dragNow.current = next;
    setDrag(next);
  };

  // One change at a time; the same decision number on a retry.
  const send = (wishlist: WishlistEdit, done: string, confirmed = false): void => {
    if (lock.current) return;
    lock.current = true;
    setSending(true);
    setSaid(null);
    const what = JSON.stringify([wishlist, confirmed]);
    const id = unsent.current?.what === what ? unsent.current.id : newDecisionId();
    unsent.current = null;
    sendChoice({
      id,
      wishlist,
      ...(confirmed ? { confirmed: true } : {}),
    }).then(
      (answer: WishlistResponse) => {
        lock.current = false;
        setSending(false);
        if (answer.ok) {
          setEditing(null);
          setSaid({ tone: 'ok', text: done });
          reload('after');
          onChanged('after');
        } else setSaid({ tone: 'danger', text: answer.why });
      },
      () => {
        lock.current = false;
        unsent.current = { what, id };
        setSending(false);
        setSaid({
          tone: 'danger',
          text: "Couldn't save that. Check your connection and try again. Nothing is changed twice.",
        });
      },
    );
  };

  // A row dragged to a new place, or moved a place from its sheet: one move of
  // one place at a time, each with its own decision number. If one is refused
  // or cannot be sent, the rest are not, and the list shows where it is now.
  const moveBy = (item: WishlistItem, steps: number): void => {
    const from = list.items.findIndex((i) => i.id === item.id);
    if (steps === 0 || from < 0 || lock.current) {
      setDropped(null);
      return;
    }
    lock.current = true;
    setSending(true);
    setSaid(null);
    const direction = steps < 0 ? 'up' : 'down';
    const go = async (): Promise<{ readonly tone: 'ok' | 'danger'; readonly text: string }> => {
      for (let done = 0; done < Math.abs(steps); done += 1) {
        const answer: WishlistResponse = await sendChoice({ id: newDecisionId(), wishlist: { move: { item: item.id, direction } } });
        if (!answer.ok) return { tone: 'danger', text: answer.why };
      }
      return { tone: 'ok', text: `Moved ${item.name} to number ${from + steps + 1} on your list.` };
    };
    go()
      .catch(() => ({ tone: 'danger' as const, text: "Couldn't move it all the way. Check your connection and try again. Your list shows where it is now." }))
      .then((result) => {
        lock.current = false;
        setSending(false);
        setEditing(null);
        setDropped(null);
        setSaid(result);
        reload('after');
        onChanged('after');
      });
  };

  // The handle follows the finger (the pointer is held by the handle, so it
  // keeps hearing it anywhere on the screen); let go, and the row is moved to
  // where it landed.
  const handle = (item: WishlistItem) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (sending || lock.current || dragNow.current !== null || order !== ids) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const boxes = ids.map((id): RowBox => {
        const box = rows.current.get(id)?.getBoundingClientRect();
        return { top: box?.top ?? 0, height: box?.height ?? 0 };
      });
      const from = ids.indexOf(item.id);
      dragTo({ item: item.id, pointer: event.pointerId, startY: event.clientY, dy: 0, from, to: from, rows: boxes });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const now = dragNow.current;
      if (now === null || now.pointer !== event.pointerId) return;
      const dy = event.clientY - now.startY;
      dragTo({ ...now, dy, to: landingPlace(now.rows, now.from, dy) });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const now = dragNow.current;
      if (now === null || now.pointer !== event.pointerId) return;
      dragTo(null);
      if (now.to === now.from) return;
      setDropped({ from: serverOrder, order: reordered(ids, now.from, now.to) });
      moveBy(item, now.to - now.from);
    },
    onPointerCancel: () => dragTo(null),
  });
  // Where each row is drawn while a row is dragged.
  const placed = (id: string): CSSProperties | undefined => {
    if (drag === null) return undefined;
    const at = order.indexOf(id);
    if (at === drag.from) return { transform: `translateY(${drag.dy}px)`, zIndex: 2, transition: 'none' };
    const by = stepAside(at, drag.from, drag.to, drag.rows[drag.from]?.height ?? 0);
    return by === 0 ? undefined : { transform: `translateY(${by}px)` };
  };

  const more = moreText(list.more);
  const byId = new Map(list.items.map((item) => [item.id, item]));
  return (
    <>
      {said !== null && editing === null && (
        <Notice tone={said.tone} icon={said.tone === 'ok' ? 'check' : 'alert'} testId="wishlist-said">
          {said.text}
        </Notice>
      )}
      <Card title="Your list" testId="wishlist-items">
        {list.items.length === 0 ? (
          <ListRow icon="heart" title="Nothing on your list yet" detail="Add the things you are saving for. Wishlist fills them in your order." testId="wishlist-empty" />
        ) : (
          <ol className="wishlist-list">
            {order.flatMap((id) => {
              const item = byId.get(id);
              if (item === undefined) return [];
              return [
                <ItemRow
                  key={id}
                  item={item}
                  busy={sending}
                  dragging={drag?.item === id}
                  style={placed(id)}
                  rowRef={(row) => {
                    if (row === null) rows.current.delete(id);
                    else rows.current.set(id, row);
                  }}
                  handle={handle(item)}
                  onOpen={() => setEditing({ kind: 'item', item })}
                />,
              ];
            })}
          </ol>
        )}
        {more !== null && <ListRow icon="check" title={more} testId="wishlist-more" />}
      </Card>
      <p className="sheet__note">Wishlist fills your list from the top: each thing gets what is left after the ones above it. The list only reads Wishlist. It never moves money.</p>
      <Button variant="secondary" wide disabled={sending || list.items.length >= 20} onClick={() => setEditing({ kind: 'add' })} testId="wishlist-add">
        {list.items.length >= 20 ? 'Your list has 20 things' : 'Add to your list'}
      </Button>

      {list.bought.length > 0 && (
        <Card title="Bought" testId="wishlist-bought">
          {list.bought.map((b) => (
            <ListRow
              key={b.purchase}
              icon="check"
              title={b.name}
              detail={boughtText(b)}
              trailing={
                <Button variant="plain" disabled={sending} onClick={() => send({ notBought: { purchase: b.purchase } }, `${b.name} is back on your list.`)} testId="bought-undo">
                  Not bought
                </Button>
              }
              testId={`bought-${b.purchase}`}
            />
          ))}
        </Card>
      )}

      {list.log.length > 0 && (
        <Card title="Changes to your list" testId="wishlist-log">
          {[...list.log].reverse().map((line, at) => (
            <ListRow key={list.log.length - at} title={logLineText(line)} testId="wishlist-log-line" />
          ))}
        </Card>
      )}

      <BottomSheet
        open={editing !== null}
        title={editing?.kind === 'item' ? editing.item.name : editing?.kind === 'remove' ? 'Remove it?' : editing?.kind === 'change' ? 'Change it' : 'Add to your list'}
        onClose={() => setEditing(null)}
        testId="wishlist-sheet"
      >
        {said !== null && editing !== null && (
          <Notice tone={said.tone} icon="alert" testId="wishlist-sheet-said">
            {said.text}
          </Notice>
        )}
        {editing?.kind === 'item' && <ItemActions item={editing.item} at={list.items.findIndex((i) => i.id === editing.item.id)} count={list.items.length} busy={sending} onChange={() => setEditing({ kind: 'change', item: editing.item })} onRemove={() => setEditing({ kind: 'remove', item: editing.item })} onMove={(steps) => moveBy(editing.item, steps)} />}
        {editing?.kind === 'remove' && (
          <>
            <p>Remove {editing.item.name} from your list? Wishlist keeps its money; the things below it move up.</p>
            <ButtonRow>
              <Button disabled={sending} onClick={() => send({ remove: { item: editing.item.id } }, `Removed ${editing.item.name}.`, true)} testId="remove-yes">
                Yes, remove it
              </Button>
              <Button variant="secondary" disabled={sending} onClick={() => setEditing(null)} testId="remove-no">
                Keep it
              </Button>
            </ButtonRow>
          </>
        )}
        {editing !== null && (editing.kind === 'add' || editing.kind === 'change') && (
          <ItemForm
            key={editing.kind === 'change' ? editing.item.id : 'add'}
            start={editing.kind === 'change' ? editing.item : null}
            busy={sending}
            onSave={(name, price) => (editing.kind === 'change' ? send({ change: { item: editing.item.id, name, price } }, `Changed ${name}.`) : send({ add: { name, price } }, `Added ${name}.`))}
            onCancel={() => setEditing(null)}
          />
        )}
      </BottomSheet>
    </>
  );
}

interface Drag {
  readonly item: string;
  readonly pointer: number;
  readonly startY: number;
  readonly dy: number;
  readonly from: number;
  readonly to: number;
  readonly rows: readonly RowBox[];
}

type Handle = Pick<DOMAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>;

// One thing on her list: a handle to drag it by, and the rest of the row opens
// its sheet. The handle is for a finger only; the sheet moves it too.
function ItemRow({ item, busy, dragging, style, rowRef, handle, onOpen }: { readonly item: FilledItem; readonly busy: boolean; readonly dragging: boolean; readonly style: CSSProperties | undefined; readonly rowRef: (row: HTMLLIElement | null) => void; readonly handle: Handle; readonly onOpen: () => void }) {
  return (
    <li ref={rowRef} className={`wishlist-item${dragging ? ' wishlist-item--dragging' : ''}`} style={style} data-testid={`wishlist-item-${item.id}`}>
      <span className="wishlist-item__handle" aria-hidden="true" data-testid="item-handle" {...handle}>
        <Icon name="grip" size={18} />
      </span>
      <button type="button" className="wishlist-item__open" disabled={busy} onClick={onOpen} data-testid="item-open">
        <span className="wishlist-item__text">
          <span className="bucket__line">
            <span className="bucket__name wishlist-item__name">{item.name}</span>
            <span className="bucket__left">
              <Money cents={item.price} testId="item-price" />
            </span>
          </span>
          <span className="bar" aria-hidden="true">
            <span className="bar__fill" style={{ width: `${item.percent}%`, display: 'block' }} />
          </span>
          <span className="bucket__caption" data-testid="item-progress">
            {itemProgressText(item)}
          </span>
        </span>
        <span className="row__chevron">
          <Icon name="chevron" size={16} />
        </span>
      </button>
    </li>
  );
}

// A row's own sheet: what it has, and what can be done with it.
function ItemActions({ item, at, count, busy, onChange, onRemove, onMove }: { readonly item: WishlistItem; readonly at: number; readonly count: number; readonly busy: boolean; readonly onChange: () => void; readonly onRemove: () => void; readonly onMove: (steps: number) => void }) {
  const act = (run: () => void) => () => {
    if (!busy) run();
  };
  return (
    <>
      <p className="sheet__note">
        Price {moneyText(item.price)}. Number {at + 1} of {count} on your list. To move it, drag it by its handle, or:
      </p>
      <div className="card">
        <ListRow title="Change its name or price" onClick={act(onChange)} testId="item-change" />
        {at > 0 && <ListRow title="Move it up one" onClick={act(() => onMove(-1))} testId="item-move-up" />}
        {at < count - 1 && <ListRow title="Move it down one" onClick={act(() => onMove(1))} testId="item-move-down" />}
        <ListRow title="Remove it from your list" onClick={act(onRemove)} testId="item-remove" />
      </div>
    </>
  );
}

function ItemForm({ start, busy, onSave, onCancel }: { readonly start: WishlistItem | null; readonly busy: boolean; readonly onSave: (name: string, price: number) => void; readonly onCancel: () => void }) {
  const [name, setName] = useState(start?.name ?? '');
  const [typed, setTyped] = useState(start === null ? '' : (start.price / 100).toFixed(2));
  const [wrong, setWrong] = useState<string | null>(null);
  const save = (): void => {
    const price = priceOf(typed);
    if (name.trim() === '') setWrong('Give it a name.');
    else if (price === null) setWrong('Type its price in dollars, more than $0.00.');
    else {
      setWrong(null);
      onSave(name, price);
    }
  };
  return (
    <>
      <TextField label="What it is" kind="name" value={name} onChange={setName} testId="item-name" />
      <TextField label="Price (dollars)" money value={typed} onChange={setTyped} testId="item-price-field" />
      {wrong !== null && (
        <Notice tone="danger" icon="alert" testId="item-wrong">
          {wrong}
        </Notice>
      )}
      <ButtonRow>
        <Button disabled={busy} onClick={save} testId="item-save">
          Save
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel} testId="item-cancel">
          Cancel
        </Button>
      </ButtonRow>
    </>
  );
}

// 50.3: in review, which thing on her list a Wishlist purchase was, or none.
// Picking one marks it bought; the bucket goes down by what the purchase cost.
export function WhichItem({ items, busy, onPick, onBack }: { readonly items: readonly WishlistItem[]; readonly busy: boolean; readonly onPick: (pick: string) => void; readonly onBack: () => void }) {
  return (
    <>
      <p className="sheet__title" data-testid="which-item-title">
        Which thing on your list was it?
      </p>
      <p className="sheet__note">The one you pick is marked bought and leaves your list. Wishlist goes down by what this cost, not by the price on your list.</p>
      <div className="card">
        {items.map((item) => (
          <ListRow
            key={item.id}
            icon="heart"
            title={item.name}
            detail={`Price ${moneyText(item.price)}`}
            onClick={() => {
              if (!busy) onPick(item.id);
            }}
            testId={`which-${item.id}`}
          />
        ))}
        <ListRow
          icon="close"
          title="None of them"
          onClick={() => {
            if (!busy) onPick('none');
          }}
          testId="which-none"
        />
      </div>
      <Button variant="secondary" wide disabled={busy} onClick={onBack} testId="which-back">
        Back
      </Button>
    </>
  );
}
