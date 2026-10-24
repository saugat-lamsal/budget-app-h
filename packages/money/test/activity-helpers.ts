import { ACTIVITY_KINDS, type Book, type Cents, type StartingPots } from '../src/index.js';

// What a bucket's activity must always satisfy, checked on a book after
// anything has happened to it. Worked out here on its own, from the numbers
// the book gives, so the checks do not lean on the code they check.
//
// For every bucket and every pay period: what it held at the start, plus what
// came in, plus what went out, is what it held at the end (QUESTIONS.md B97);
// the rows add up to what came in and went out; one pay period ends with
// exactly what the next one starts with; the last one ends with what the
// bucket holds now; and the first one starts with what setup day gave it.
export function activityProblems(book: Book, start?: StartingPots, from = 0): string[] {
  const problems: string[] = [];
  const pots = book.pots();
  const current = book.period().number;
  // Her rulebook: Wishlist too, where the setup has it ($0.00 when setup day gave it nothing).
  for (const pot of book.movablePots()) {
    let carried: Cents | undefined = from === 0 && start !== undefined ? (start[pot] ?? 0) : undefined;
    for (let k = from; k <= current; k += 1) {
      const a = book.activity(pot, k);
      const where = `${pot}, pay period ${k}`;
      if (a.pot !== pot || a.period.number !== k) problems.push(`${where}: asked for it, got ${a.pot} period ${a.period.number}`);
      if (a.opening + a.in + a.out !== a.closing) problems.push(`${where}: opening ${a.opening} + in ${a.in} + out ${a.out} is not closing ${a.closing}`);
      const rows = a.rows.reduce((sum, row) => sum + row.amount, 0);
      if (rows !== a.in + a.out) problems.push(`${where}: the rows add up to ${rows}, in and out to ${a.in + a.out}`);
      const wantIn = a.rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
      const wantOut = a.rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + row.amount, 0);
      if (a.in !== wantIn || a.out !== wantOut) problems.push(`${where}: in ${a.in} and out ${a.out}, but the rows give ${wantIn} and ${wantOut}`);
      if (carried !== undefined && a.opening !== carried) problems.push(`${where}: starts with ${a.opening}, but the one before ended with ${carried}`);
      if ((a.period.endDate === null) !== (k === current)) problems.push(`${where}: only the current pay period has no end day`);
      carried = a.closing;
      const ids = a.rows.map((row) => row.id);
      if (new Set(ids).size !== ids.length) problems.push(`${where}: an item is listed twice`);
    }
    if (carried !== pots[pot]) problems.push(`${pot}: the last pay period ends with ${String(carried)}, the bucket holds ${pots[pot]}`);
  }
  return problems;
}

// The same for a pay period added up by kind of entry (QUESTIONS.md B105):
// opening plus everything it did, kind by kind, is closing, and it agrees with
// the lists of the same bucket and pay period.
export function summaryProblems(book: Book, from = 0): string[] {
  const problems: string[] = [];
  const current = book.period().number;
  for (let k = from; k <= current; k += 1) {
    const s = book.periodSummary(k);
    if (s.number !== k) problems.push(`asked for pay period ${k}, got ${s.number}`);
    if ((s.endDate === null) !== (k === current)) problems.push(`pay period ${k}: only the current pay period has no end day`);
    const next = k < current ? book.periodSummary(k + 1) : undefined;
    for (const pot of book.movablePots()) {
      const where = `${pot}, pay period ${k}`;
      const byKind = (s.byKind as Readonly<Record<string, Readonly<Record<string, Cents>>>>)[pot] ?? {};
      const kinds: Cents = ACTIVITY_KINDS.map((kind) => byKind[kind] ?? 0).reduce((sum, c) => sum + c, 0);
      if ((s.opening[pot] ?? 0) + kinds !== s.closing[pot]) problems.push(`${where}: opening ${s.opening[pot]} plus ${JSON.stringify(s.byKind[pot])} is not closing ${s.closing[pot]}`);
      const a = book.activity(pot, k);
      if (a.opening !== s.opening[pot] || a.closing !== s.closing[pot]) problems.push(`${where}: the list and the summary disagree about where it started or ended`);
      if (a.in + a.out !== kinds) problems.push(`${where}: the list adds up to ${a.in + a.out}, the summary to ${kinds}`);
      if (next !== undefined && next.opening[pot] !== s.closing[pot]) problems.push(`${where}: ends with ${s.closing[pot]}, the next starts with ${next.opening[pot]}`);
    }
  }
  return problems;
}

// B4, B109: what each payday question asks about, and what was taken off it,
// always add up to what the bucket held at payday; the question in review says
// the same as the report; and nothing is asked or taken off below zero.
export function leftoverProblems(book: Book): string[] {
  const problems: string[] = [];
  const report = book.paydayReport();
  const asking = book.reviewItems().flatMap((item) => (item.type === 'leftover' ? [item] : []));
  for (const l of report.leftovers) {
    const where = `${l.bucket} leftover after payday ${report.period.number}`;
    if (l.outcome === 'nothing-to-ask') {
      if (l.amount !== 0 || l.lessSincePayday !== 0) problems.push(`${where}: nothing to ask, yet ${l.amount} asked and ${l.lessSincePayday} taken off`);
      continue;
    }
    if (l.amount < 0 || l.lessSincePayday < 0) problems.push(`${where}: asks ${l.amount}, took off ${l.lessSincePayday}`);
    if (l.amount + l.lessSincePayday !== l.leftAtPayday) problems.push(`${where}: ${l.amount} asked + ${l.lessSincePayday} taken off is not the ${l.leftAtPayday} held at payday`);
    if (l.setting === 'roll-over' && l.lessSincePayday !== 0) problems.push(`${where}: rolled over by the setting, yet ${l.lessSincePayday} was taken off`);
    const item = asking.find((i) => i.id === l.question);
    if (l.outcome === 'waiting') {
      if (item === undefined) problems.push(`${where}: waiting, but no question in review`);
      else if (item.amount !== l.amount || item.lessSincePayday !== l.lessSincePayday || item.atPayday !== l.leftAtPayday) problems.push(`${where}: the question in review says ${item.amount}/${item.lessSincePayday}/${item.atPayday}, the report ${l.amount}/${l.lessSincePayday}/${l.leftAtPayday}`);
    } else if (item !== undefined) {
      problems.push(`${where}: answered, yet still asked in review`);
    }
  }
  return problems;
}
