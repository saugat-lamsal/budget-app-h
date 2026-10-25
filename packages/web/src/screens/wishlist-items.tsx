import type { WishlistItem } from '@budget-app/money';
import type { WishlistEdit, WishlistListView, WishlistResponse } from '@budget-app/server/views';
import { useRef, useState } from 'react';
import { newDecisionId, sendWishlist, type Reload } from '../app/api.js';
import { BottomSheet, Button, ButtonRow, Card, ListRow, Money, Notice, StatusLabel, TextField } from '../ui/blocks.js';
import { moneyText } from '../ui/money-format.js';
import { boughtText, itemProgressText, logLineText, moreText, priceOf } from './wishlist-items-text.js';

// Her Wishlist list (her rulebook, 50.1 to 50.3), on Wishlist's own screen:
// the things she is saving for, in her order, each with what the bucket gives
// it (50.2), in words and amount and not only a bar; what was bought, which
// can be changed back (50.3); and every change to the list (13.5). The list
// holds no money: every number comes from the server.

type Editing = { readonly kind: 'add' } | { readonly kind: 'change'; readonly item: WishlistItem } | { readonly kind: 'remove'; readonly item: WishlistItem };

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

  // One change at a time; the same decision number on a retry.
  const send = (wishlist: WishlistEdit, done: string, confirmed = false): void => {
    if (lock.current) return;
    lock.current = true;
    setSending(true);
    setSaid(null);
    const what = JSON.stringify([wishlist, confirmed]);
    const id = unsent.current?.what === what ? unsent.current.id : newDecisionId();
    unsent.current = null;
    sendWishlist({
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

  const more = moreText(list.more);
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
          list.items.map((item, at) => (
            <div key={item.id} className="wishlist-item" data-testid={`wishlist-item-${item.id}`}>
              <div className="bucket__line">
                <span className="bucket__name">{item.name}</span>
                <span className="bucket__left">
                  <Money cents={item.price} testId="item-price" />
                </span>
              </div>
              <div className="bar" aria-hidden="true">
                <div className="bar__fill" style={{ width: `${item.percent}%` }} />
              </div>
              <p className="bucket__caption" data-testid="item-progress">
                {item.ready && <StatusLabel status="ready" testId="item-ready" />} {itemProgressText(item)}
              </p>
              <ButtonRow>
                <Button variant="plain" disabled={sending || at === 0} onClick={() => send({ move: { item: item.id, direction: 'up' } }, `Moved ${item.name} up.`)} testId="item-up">
                  Move up
                </Button>
                <Button variant="plain" disabled={sending || at === list.items.length - 1} onClick={() => send({ move: { item: item.id, direction: 'down' } }, `Moved ${item.name} down.`)} testId="item-down">
                  Move down
                </Button>
                <Button variant="plain" disabled={sending} onClick={() => setEditing({ kind: 'change', item })} testId="item-change">
                  Change
                </Button>
                <Button variant="plain" disabled={sending} onClick={() => setEditing({ kind: 'remove', item })} testId="item-remove">
                  Remove
                </Button>
              </ButtonRow>
            </div>
          ))
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

      <BottomSheet open={editing !== null} title={editing?.kind === 'remove' ? 'Remove it?' : editing?.kind === 'change' ? 'Change it' : 'Add to your list'} onClose={() => setEditing(null)} testId="wishlist-sheet">
        {said !== null && editing !== null && (
          <Notice tone={said.tone} icon="alert" testId="wishlist-sheet-said">
            {said.text}
          </Notice>
        )}
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
        {editing !== null && editing.kind !== 'remove' && (
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
