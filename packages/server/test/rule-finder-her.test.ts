import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addDays, type AccountId, type Cents, type IsoDate } from '@budget-app/money';
import { findRules, overlapsOf, reads, wordsThatStay, SHOWN, type FinderLine, type FinderSuggestion, type FoundRule } from '../src/rule-finder.js';
import { readFileSync } from 'node:fs';
import { labelOf, readPlaidItem } from '../src/bank/plaid-item.js';
import { runs } from './slow.js';

// Her rulebook, section 53 (his OK Oct 26, 2026, 60g): the rule finder on
// setup day, as a function of the bank history. Made-up histories in two
// wording styles: short capital lines with numbers that change, like a
// Capital One statement, and longer mixed-case lines, like an Amex one.
// Never her real wording. Every name and number is made up.

const START: IsoDate = '2025-01-06';

let next = 0;
function line(account: AccountId, date: IsoDate, amount: Cents, description: string, extra: Partial<FinderLine> = {}): FinderLine {
  next += 1;
  return { id: `t${next}`, account, amount, date, description, pending: false, label: null, postedAs: null, ...extra };
}
const label = (detailed: string, primary = detailed.split('_').slice(0, 2).join('_')): FinderLine['label'] => ({ primary, detailed });
const day = (n: number): IsoDate => addDays(START, n);

function find(lines: readonly FinderLine[], existing: Partial<Parameters<typeof findRules>[0]> = {}): FinderSuggestion[] {
  return findRules({ lines, bankRules: [], sortingRules: [], paycheckRule: null, ...existing });
}
const texts = (found: readonly FinderSuggestion[], group?: FinderSuggestion['group']): string[] => found.filter((s) => group === undefined || s.group === group).map((s) => s.rule.contains);
const bankRule = (s: FinderSuggestion | undefined): Extract<FoundRule, { kind: 'bank-rule' }> => {
  if (s?.rule.kind !== 'bank-rule') throw new Error('not a bank rule');
  return s.rule;
};

describe('53.2 the words that stay the same', () => {
  const items = (descriptions: readonly string[]): { id: string; date: IsoDate; description: string }[] => descriptions.map((description, i) => ({ id: `w${i}`, date: day(i), description }));

  it('53.2 the longest piece every description contains, leaving out what changes (the made-up example)', () => {
    expect(wordsThatStay(items(['ONLINE PMT 1047 THANK YOU', 'ONLINE PMT 2213 THANK YOU']))).toEqual([{ contains: 'ONLINE PMT', ids: ['w0', 'w1'] }]);
  });

  it('53.2 of two pieces equally long, the one that comes first in the newest description', () => {
    expect(wordsThatStay(items(['EF GH 11 AB CD', 'AB CD 22 EF GH'])).map((w) => w.contains)).toEqual(['AB CD']);
  });

  it('53.2 a word with digits that is the same every time stays; ignoring capitals, in the newest one\'s own capitals', () => {
    expect(wordsThatStay(items(['MADEUP CORP PAYROLL PPD ID: 4455 R1', 'MADEUP CORP PAYROLL PPD ID: 4455 R2'])).map((w) => w.contains)).toEqual(['MADEUP CORP PAYROLL PPD ID: 4455']);
    expect(wordsThatStay(items(['ONLINE PAYMENT - THANK YOU', 'Online Payment - Thank You'])).map((w) => w.contains)).toEqual(['Online Payment - Thank You']);
  });

  it('53.2 a piece begins and ends at whole words and has a letter in it', () => {
    // "PMT" inside "EPMT" is not a whole word; "4455" alone has no letter.
    expect(wordsThatStay(items(['EPMT 4455 X', 'PMT 4455 Y'])).map((w) => w.contains)).toEqual(['EPMT', 'PMT']);
  });

  it('53.2 wording that changed halfway shares nothing: split by first word, each part its own text', () => {
    expect(wordsThatStay(items(['ONLINE PMT 1047', 'ONLINE PMT 2213', 'MOBILE PYMT 3321', 'MOBILE PYMT 9876'])).map((w) => w.contains).sort()).toEqual(['MOBILE PYMT', 'ONLINE PMT']);
  });

  it('53.2 from one item alone, its wording as B241 reads it', () => {
    expect(wordsThatStay(items(['PAYMENT TO ACCT #4321 ON 10/02 VIA WEB']))).toEqual([{ contains: 'PAYMENT TO ACCT', ids: ['w0'] }]);
    expect(wordsThatStay(items(['10/02 X1', '10/03 Y2'])).map((w) => w.contains).sort()).toEqual(['10/02 X1', '10/03 Y2']);
  });
});

describe('53.3 card payments, both sides, across both banks', () => {
  // Capital One style on checking and its card; Amex style on the Amex card.
  function history(): FinderLine[] {
    next = 0;
    const lines: FinderLine[] = [];
    for (let m = 0; m < 4; m += 1) {
      lines.push(line('checking', day(30 * m), 25_000 + m, `ONLINE PMT ${1000 + m} TO CRD 0412`));
      lines.push(line('everyday-card', day(30 * m + 1), -(25_000 + m), 'CAPITAL ONE PYMT RECEIVED'));
      lines.push(line('checking', day(30 * m + 3), 40_000 + m, `EPAY TO AMEX ACH W${4800 + m}`));
      lines.push(line('second-card', day(30 * m + 5), -(40_000 + m), 'Online Payment Received - Thank You'));
    }
    return lines;
  }

  it('53.3 two suggestions for each account and card, worded from each side, in that bank\'s own words', () => {
    const found = find(history()).filter((s) => s.group === 'card-payments');
    expect(found.map((s) => bankRule(s)).map(({ account, contains, means, other }) => ({ account, contains, means, other }))).toEqual([
      { account: 'checking', contains: 'TO CRD 0412', means: 'transfer', other: 'everyday-card' },
      { account: 'everyday-card', contains: 'CAPITAL ONE PYMT RECEIVED', means: 'transfer', other: 'checking' },
      { account: 'checking', contains: 'EPAY TO AMEX ACH', means: 'transfer', other: 'second-card' },
      { account: 'second-card', contains: 'Online Payment Received - Thank You', means: 'transfer', other: 'checking' },
    ]);
    expect(found.every((s) => s.found.length === 4 && !s.pending)).toBe(true);
  });

  it('53.3 B227 the card\'s side is suggested from the history, not from a label', () => {
    const card = find(history()).find((s) => s.rule.kind === 'bank-rule' && s.rule.account === 'everyday-card');
    expect(card?.rule).toMatchObject({ contains: 'CAPITAL ONE PYMT RECEIVED', other: 'checking' });
  });

  it('53.3 arriving 0 and 5 days later pairs; 6 days later, or one cent different, does not', () => {
    next = 0;
    const lines = [
      line('checking', day(0), 10_000, 'PMT A1'),
      line('everyday-card', day(0), -10_000, 'PAID A'),
      line('checking', day(10), 20_000, 'PMT B1'),
      line('everyday-card', day(15), -20_000, 'PAID B'),
      line('checking', day(20), 30_000, 'PMT C1'),
      line('everyday-card', day(26), -30_000, 'PAID C'),
      line('checking', day(40), 40_000, 'PMT D1'),
      line('everyday-card', day(41), -40_001, 'PAID D'),
    ];
    const found = find(lines).filter((s) => s.group === 'card-payments');
    const ids = new Set(found.flatMap((s) => s.found));
    expect([...ids].sort()).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('53.3 two payments of the same amount in the window pair oldest first', () => {
    next = 0;
    const lines = [line('checking', day(0), 5_000, 'PMT ONE'), line('checking', day(1), 5_000, 'PMT TWO'), line('everyday-card', day(2), -5_000, 'PAID FIRST'), line('everyday-card', day(3), -5_000, 'PAID SECOND')];
    const found = find(lines).filter((s) => s.group === 'card-payments');
    // One leaving text and one arriving text, each from both items.
    expect(found.map((s) => [s.rule.contains, s.found])).toEqual([
      ['PMT', ['t1', 't2']],
      ['PAID', ['t3', 't4']],
    ]);
  });

  it('53.3 each payment pairs with the earliest arrival not paired yet, so a later payment still finds its own', () => {
    next = 0;
    // Paired with the latest arrival in its window instead, the first would take the second's.
    const lines = [line('checking', day(0), 5_000, 'PMT ONE'), line('everyday-card', day(1), -5_000, 'PAID ONE'), line('checking', day(2), 5_000, 'PMT TWO'), line('everyday-card', day(4), -5_000, 'PAID TWO')];
    const ids = find(lines).filter((s) => s.group === 'card-payments').flatMap((s) => s.found);
    expect(ids.sort()).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('53.3 an arrival dated the day before the money left does not pair', () => {
    next = 0;
    const lines = [line('everyday-card', day(9), -7_000, 'PAID EARLY'), line('checking', day(10), 7_000, 'PMT LATE')];
    expect(find(lines).filter((s) => s.group === 'card-payments')).toEqual([]);
  });

  it('53.3 B226 a pending wording the app saw before it posted is a suggestion of its own', () => {
    const lines = history();
    const posted = lines.filter((l) => l.account === 'second-card');
    // The app saw the newest one pending, worded otherwise, between connecting and setup day.
    const newest = posted[posted.length - 1]!;
    lines.push(line('second-card', newest.date, newest.amount, 'Payment Pending - Online', { pending: true, postedAs: newest.id }));
    // And one still pending now, paired by itself.
    lines.push(line('checking', day(200), 41_000, 'EPAY TO AMEX ACH W9999'));
    lines.push(line('second-card', day(201), -41_000, 'Payment Pending - Online', { pending: true }));
    const amex = find(lines).filter((s) => s.rule.kind === 'bank-rule' && s.rule.account === 'second-card');
    expect(amex.map((s) => [s.rule.contains, s.pending, s.found.length])).toEqual([
      ['Online Payment Received - Thank You', false, 4],
      ['Payment Pending - Online', true, 2],
    ]);
  });

  it('53.3 B226 a pending item the app saw before it posted is not paired itself: its posted item is', () => {
    next = 0;
    // The app saw it pending first (so it is the older item) and a day before it posted.
    const lines = [
      line('checking', day(0), 12_000, 'EPAY TO AMEX ACH W1'),
      line('second-card', day(1), -12_000, 'Payment Pending - Online', { pending: true, postedAs: 't3' }),
      line('second-card', day(2), -12_000, 'Online Payment Received - Thank You'),
    ];
    const amex = find(lines).filter((s) => s.rule.kind === 'bank-rule' && s.rule.account === 'second-card');
    expect(amex.map((s) => [s.rule.contains, s.pending, s.found])).toEqual([
      ['Online Payment Received - Thank You', false, ['t3']],
      ['Payment Pending - Online', true, ['t2']],
    ]);
  });

  it('53.3 a card worded alike from checking and from savings gets one suggestion for each account', () => {
    next = 0;
    const lines = [line('checking', day(0), 9_000, 'PMT FROM CHK'), line('everyday-card', day(1), -9_000, 'PAYMENT RECEIVED'), line('savings', day(10), 8_000, 'PMT FROM SAV'), line('everyday-card', day(11), -8_000, 'PAYMENT RECEIVED')];
    const card = find(lines).filter((s) => s.rule.kind === 'bank-rule' && s.rule.account === 'everyday-card');
    expect(card.map((s) => [s.rule.contains, bankRule(s).other])).toEqual([
      ['PAYMENT RECEIVED', 'checking'],
      ['PAYMENT RECEIVED', 'savings'],
    ]);
  });
});

describe('53.4 transfers between checking and savings, both sides', () => {
  it('53.4 each way the money went: a rule on the account it left and one on the account it reached', () => {
    next = 0;
    const lines = [
      line('checking', day(0), 50_000, 'ONLINE TRANSFER TO SAV 7781 REF IB01'),
      line('savings', day(0), -50_000, 'ONLINE TRANSFER FROM CHK 3321 REF IB01'),
      line('checking', day(14), 50_000, 'ONLINE TRANSFER TO SAV 7781 REF IB02'),
      line('savings', day(15), -50_000, 'ONLINE TRANSFER FROM CHK 3321 REF IB02'),
      line('savings', day(20), 7_000, 'ONLINE TRANSFER TO CHK 3321 REF IB03'),
      line('checking', day(20), -7_000, 'ONLINE TRANSFER FROM SAV 7781 REF IB03'),
    ];
    const found = find(lines).filter((s) => s.group === 'transfers');
    // Two items share their wording; one alone is worded as B241 reads it.
    expect(found.map((s) => bankRule(s)).map(({ account, contains, other }) => [account, contains, other])).toEqual([
      ['checking', 'ONLINE TRANSFER TO SAV 7781 REF', 'savings'],
      ['savings', 'ONLINE TRANSFER FROM CHK 3321 REF', 'checking'],
      ['savings', 'ONLINE TRANSFER TO CHK', 'checking'],
      ['checking', 'ONLINE TRANSFER FROM SAV', 'savings'],
    ]);
  });

  it('53.4 an item paired as a card payment is not paired again as a transfer', () => {
    next = 0;
    const lines = [line('checking', day(0), 6_000, 'PMT TO CARD'), line('everyday-card', day(1), -6_000, 'PAID'), line('savings', day(1), -6_000, 'FROM CHK')];
    const found = find(lines);
    expect(texts(found, 'card-payments')).toEqual(['PMT TO CARD', 'PAID']);
    expect(texts(found, 'transfers')).toEqual([]);
  });
});

describe('53.5 payments to people, fees and interest, from the labels', () => {
  it('53.5 one suggestion for each account and kind, worded from the items with that label', () => {
    next = 0;
    const lines = [
      line('checking', day(1), 4_000, 'ZELLE TO ANNA MADEUP 81', { label: label('TRANSFER_OUT_TRANSFER_OUT_FROM_APPS', 'TRANSFER_OUT') }),
      line('checking', day(9), 2_500, 'ZELLE TO BEN MADEUP 92', { label: label('TRANSFER_OUT_TRANSFER_OUT_FROM_APPS', 'TRANSFER_OUT') }),
      line('second-card', day(3), 2_900, 'Late Payment Fee', { label: label('BANK_FEES_LATE_FEES', 'BANK_FEES') }),
      line('second-card', day(33), 1_842, 'Interest Charge on Purchases', { label: label('BANK_FEES_INTEREST_CHARGE', 'BANK_FEES') }),
      // A transfer by its label alone, with no other side: not suggested here.
      line('checking', day(5), 9_999, 'TRANSFER TO SAV', { label: label('TRANSFER_OUT_SAVINGS', 'TRANSFER_OUT') }),
      // A bank fee on checking is a purchase there, not a card fee.
      line('checking', day(6), 1_200, 'MONTHLY MAINTENANCE FEE', { label: label('BANK_FEES_OTHER_BANK_FEES', 'BANK_FEES') }),
    ];
    const found = find(lines).filter((s) => s.group === 'people-fees');
    expect(found.map((s) => bankRule(s)).map(({ account, contains, means }) => [account, contains, means])).toEqual([
      ['checking', 'ZELLE TO', 'payment-to-person'],
      ['second-card', 'Late Payment Fee', 'card-fee'],
      ['second-card', 'Interest Charge on Purchases', 'card-interest'],
    ]);
  });
});

describe('53.6 the paycheck rule: a deposit that repeats about every 14 days', () => {
  const pay = (days: readonly number[], description = (i: number) => `MADEUP CORP PAYROLL PPD ID 4455 ${i}`): FinderLine[] => days.map((d, i) => line('checking', day(d), -(250_000 + i), description(i)));

  it('53.6 at least 3 deposits, each 12 to 16 days after the one before; the words that stay the same', () => {
    next = 0;
    const found = find(pay([0, 14, 28, 42])).filter((s) => s.group === 'paycheck');
    expect(found.map((s) => [s.rule.contains, s.run?.length])).toEqual([['MADEUP CORP PAYROLL PPD ID 4455', 4]]);
    expect(found[0]?.run?.map((r) => r.date)).toEqual([day(42), day(28), day(14), day(0)]);
  });

  it('53.6 gaps of exactly 12 and 16 days count; 11 and 17 do not', () => {
    next = 0;
    expect(find(pay([0, 12, 28])).filter((s) => s.group === 'paycheck')).toHaveLength(1);
    next = 0;
    expect(find(pay([0, 11, 28])).filter((s) => s.group === 'paycheck')).toHaveLength(0);
    next = 0;
    expect(find(pay([0, 17, 31])).filter((s) => s.group === 'paycheck')).toHaveLength(0);
  });

  it('53.6 exactly 3 is a run, 2 is not', () => {
    next = 0;
    expect(find(pay([0, 14, 28])).filter((s) => s.group === 'paycheck')).toHaveLength(1);
    next = 0;
    expect(find(pay([0, 14])).filter((s) => s.group === 'paycheck')).toHaveLength(0);
  });

  it('53.6 a bonus in between is passed over; an older job before a longer gap is not part of the run', () => {
    next = 0;
    const lines = [
      ...pay([0, 14, 28], (i) => `OLDJOB INC DIR DEP ${i}`),
      ...pay([100, 114, 120, 128, 142], (i) => `MADEUP CORP PAYROLL PPD ID 4455 ${i}`),
    ];
    const found = find(lines).filter((s) => s.group === 'paycheck');
    expect(found.map((s) => [s.rule.contains, s.run?.map((r) => r.date)])).toEqual([
      ['MADEUP CORP PAYROLL PPD ID 4455', [day(142), day(128), day(114), day(100)]],
      ['OLDJOB INC DIR DEP', [day(28), day(14), day(0)]],
    ]);
  });

  it('53.6 money in that a transfer pairs is left out', () => {
    next = 0;
    const lines = [0, 14, 28].flatMap((d) => [line('savings', day(d), 30_000, 'XFER TO CHK'), line('checking', day(d), -30_000, 'XFER FROM SAV')]);
    expect(find(lines).filter((s) => s.group === 'paycheck')).toEqual([]);
  });
});

describe('53.7 places you pay often', () => {
  // Other made-up purchases on each account, each at a place once, so that 13.8
  // finds names as it would in a real history (a word on most of an
  // account's purchases is not a name). On checking each says "DEBIT CARD".
  const others = (): FinderLine[] => [
    ...['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT'].map((name) => line('checking', day(0), 1_100, `DEBIT CARD ${name} GOODS`)),
    ...['GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA'].map((name) => line('everyday-card', day(0), 1_100, `${name} BAKERY`)),
    ...['MIKE', 'NOVEMBER', 'OSCAR', 'PAPA', 'QUEBEC', 'ROMEO'].map((name) => line('second-card', day(0), 1_100, `${name} Books`)),
  ];

  it('53.7 3 or more purchases at a place, its name as 13.8 finds it, and a bucket from the bank\'s category', () => {
    next = 0;
    const lines = [
      ...others(),
      line('everyday-card', day(1), 6_412, 'GREEN LEAF MARKET 0451 SPRINGFIELD', { label: label('FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK') }),
      line('second-card', day(9), 5_120, 'Green Leaf Market', { label: label('FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK') }),
      line('checking', day(20), 3_001, 'DEBIT CARD GREEN LEAF MARKET 7781', { label: label('FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK') }),
      line('second-card', day(2), 450, 'Corner Cafe Madeup', { label: label('FOOD_AND_DRINK_COFFEE', 'FOOD_AND_DRINK') }),
      line('second-card', day(4), 475, 'Corner Cafe Madeup', { label: label('FOOD_AND_DRINK_COFFEE', 'FOOD_AND_DRINK') }),
      line('second-card', day(6), 500, 'Corner Cafe Madeup', { label: label('FOOD_AND_DRINK_COFFEE', 'FOOD_AND_DRINK') }),
      line('everyday-card', day(3), 999, 'NOLABEL SHOP', {}),
      line('everyday-card', day(4), 999, 'NOLABEL SHOP', {}),
      line('everyday-card', day(5), 999, 'NOLABEL SHOP', {}),
      line('everyday-card', day(8), 1_500, 'TWICE ONLY STORE'),
      line('everyday-card', day(10), 1_500, 'TWICE ONLY STORE'),
    ];
    const found = find(lines).filter((s) => s.group === 'places');
    expect(found.map((s) => [s.rule.contains, s.rule.kind === 'place' ? s.rule.bucket : '?', s.found.length])).toEqual([
      ['GREEN LEAF MARKET', 'needs', 3],
      ['Corner Cafe Madeup', 'wants', 3],
      ['NOLABEL SHOP', null, 3],
    ]);
  });

  it('53.7 places are listed by how many purchases, most first', () => {
    next = 0;
    // The diner was bought at last, but has fewer purchases.
    const lines = [
      ...others(),
      ...[1, 2, 3].map((d) => line('second-card', day(40 + d), 800, 'Late Night Diner')),
      ...[1, 2, 3, 4].map((d) => line('everyday-card', day(d), 2_000, 'HARDWARE HUT')),
    ];
    expect(texts(find(lines), 'places')).toEqual(['HARDWARE HUT', 'Late Night Diner']);
  });

  it('53.7 a card payment or a transfer is not a place', () => {
    next = 0;
    const lines = [0, 30, 60].flatMap((d) => [line('checking', day(d), 9_000 + d, 'EPAY TO AMEX ACH'), line('second-card', day(d + 1), -(9_000 + d), 'Payment Received')]);
    expect(find(lines).filter((s) => s.group === 'places')).toEqual([]);
  });
});

describe('53.8 what it would have matched', () => {
  it('53.8 how many, on which account, from what day to what day, the items newest first, and what else it matches listed apart', () => {
    next = 0;
    const lines = [
      line('checking', day(0), 10_000, 'PMT TO CARD 1'),
      line('everyday-card', day(1), -10_000, 'PAID'),
      line('checking', day(30), 11_000, 'PMT TO CARD 2'),
      line('everyday-card', day(31), -11_000, 'PAID'),
      // Not a card payment, but its words fit the leaving side's text.
      line('checking', day(50), 777, 'PMT TO CARD SHOP'),
    ];
    const leaving = find(lines).find((s) => s.rule.kind === 'bank-rule' && s.rule.account === 'checking');
    expect(leaving?.matches).toEqual({
      count: 3,
      accounts: ['checking'],
      from: day(0),
      to: day(50),
      items: [
        { id: 't3', date: day(30), account: 'checking', description: 'PMT TO CARD 2', amount: 11_000, direction: 'out', pending: false },
        { id: 't1', date: day(0), account: 'checking', description: 'PMT TO CARD 1', amount: 10_000, direction: 'out', pending: false },
      ],
      foundCount: 2,
      also: [{ id: 't5', date: day(50), account: 'checking', description: 'PMT TO CARD SHOP', amount: 777, direction: 'out', pending: false }],
      alsoCount: 1,
    });
  });

  it(`53.8 a long history shows the newest ${SHOWN} of each, with how many in all`, () => {
    next = 0;
    const lines = Array.from({ length: SHOWN + 7 }, (_, i) => [line('checking', day(10 * i), 30_000 + i, `EPAY TO AMEX ACH W${i}`), line('second-card', day(10 * i + 2), -(30_000 + i), 'Payment Received')]).flat();
    const leaving = find(lines).find((s) => s.rule.kind === 'bank-rule' && s.rule.account === 'checking');
    expect(leaving?.matches.foundCount).toBe(SHOWN + 7);
    expect(leaving?.matches.items).toHaveLength(SHOWN);
    expect(leaving?.matches.items[0]?.date).toBe(day(10 * (SHOWN + 6)));
  });
});

describe('53.9 never one item two ways', () => {
  it('53.9 a card worded alike from checking and from savings: the two suggestions overlap on the items both match', () => {
    next = 0;
    const lines = [line('checking', day(0), 9_000, 'PMT FROM CHK'), line('everyday-card', day(1), -9_000, 'PAYMENT RECEIVED'), line('savings', day(10), 8_000, 'PMT FROM SAV'), line('everyday-card', day(11), -8_000, 'PAYMENT RECEIVED')];
    const found = find(lines);
    const [fromChecking, fromSavings] = found.filter((s) => s.rule.kind === 'bank-rule' && s.rule.account === 'everyday-card');
    const overlaps = overlapsOf(fromChecking!.rule, found.filter((s) => s !== fromChecking).map((s) => ({ key: { suggestion: s.id }, rule: s.rule })), lines);
    expect(overlaps.map((o) => [o.key, o.count])).toEqual([[{ suggestion: fromSavings!.id }, 2]]);
  });

  it('53.9 a place that reads an item a bank rule reads as a transfer overlaps it; one that reads nothing in common does not', () => {
    next = 0;
    const lines = [line('checking', day(0), 9_000, 'EPAY TO AMEX'), line('checking', day(5), 1_000, 'AMEX TRAVEL SHOP')];
    const place: FoundRule = { kind: 'place', contains: 'AMEX', bucket: null };
    const rule = { key: { rule: 'bank-rule-1' }, rule: { kind: 'bank-rule', account: 'checking', contains: 'EPAY', means: 'transfer', other: 'second-card' } as FoundRule };
    expect(overlapsOf(place, [rule], lines).map((o) => [o.key, o.items.map((i) => i.id)])).toEqual([[{ rule: 'bank-rule-1' }, ['t1']]]);
    expect(overlapsOf({ kind: 'place', contains: 'TRAVEL SHOP', bucket: null }, [rule], lines)).toEqual([]);
  });

  it('53.9 a paycheck rule and a rule that reads the same deposit as a transfer overlap', () => {
    next = 0;
    const lines = [line('checking', day(0), -100_000, 'MADEUP CORP PAYROLL')];
    const transfer = { key: { rule: 'r' }, rule: { kind: 'bank-rule', account: 'checking', contains: 'MADEUP', means: 'transfer', other: 'savings' } as FoundRule };
    expect(overlapsOf({ kind: 'paycheck', contains: 'PAYROLL' }, [transfer], lines)).toHaveLength(1);
    // A rule reads only the way the money went: money in is not a purchase.
    expect(reads({ kind: 'place', contains: 'PAYROLL', bucket: null }, lines[0]!)).toBe(false);
  });
});

describe('53 random histories', () => {
  // Card payments, transfers, paychecks and purchases in both wording
  // styles, on random days and amounts.
  const histories = fc
    .record({
      payments: fc.array(fc.record({ from: fc.constantFrom<AccountId>('checking', 'savings'), to: fc.constantFrom<AccountId>('everyday-card', 'second-card'), on: fc.integer({ min: 0, max: 700 }), lag: fc.integer({ min: 0, max: 7 }), amount: fc.integer({ min: 1, max: 500_000 }) }), { maxLength: 12 }),
      transfers: fc.array(fc.record({ out: fc.boolean(), on: fc.integer({ min: 0, max: 700 }), lag: fc.integer({ min: 0, max: 7 }), amount: fc.integer({ min: 1, max: 500_000 }) }), { maxLength: 8 }),
      paydays: fc.array(fc.integer({ min: 10, max: 18 }), { maxLength: 10 }),
      purchases: fc.array(fc.record({ at: fc.constantFrom('GREEN LEAF MARKET', 'Corner Cafe Madeup', 'MADE UP FUEL 22', 'Online Payment Received'), account: fc.constantFrom<AccountId>('checking', 'everyday-card', 'second-card'), on: fc.integer({ min: 0, max: 700 }), amount: fc.integer({ min: 1, max: 50_000 }) }), { maxLength: 25 }),
    })
    .map(({ payments, transfers, paydays, purchases }) => {
      next = 0;
      const lines: FinderLine[] = [];
      for (const [i, p] of payments.entries()) {
        lines.push(line(p.from, day(p.on), p.amount, p.to === 'second-card' ? `EPAY TO AMEX ACH W${i}` : `ONLINE PMT ${i} TO CRD 0412`));
        lines.push(line(p.to, day(p.on + p.lag), -p.amount, p.to === 'second-card' ? 'Online Payment Received - Thank You' : 'CAPITAL ONE PYMT RECEIVED'));
      }
      for (const [i, t] of transfers.entries()) {
        const [from, to] = t.out ? (['checking', 'savings'] as const) : (['savings', 'checking'] as const);
        lines.push(line(from, day(t.on), t.amount, `ONLINE TRANSFER TO ${to.toUpperCase()} REF ${i}`));
        lines.push(line(to, day(t.on + t.lag), -t.amount, `ONLINE TRANSFER FROM ${from.toUpperCase()} REF ${i}`));
      }
      let d = 0;
      for (const [i, gap] of paydays.entries()) {
        d += gap;
        lines.push(line('checking', day(d), -(200_000 + i), `MADEUP CORP PAYROLL ${i}`));
      }
      for (const p of purchases) lines.push(line(p.account, day(p.on), p.amount, p.at, { label: label('FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK') }));
      return lines;
    });

  it('53.2 53.8 random histories: every item a suggestion was found from contains its text and is matched by it; no item is found by two suggestions', () => {
    fc.assert(
      fc.property(histories, (lines) => {
        const found = find(lines);
        const byId = new Map(lines.map((l) => [l.id, l]));
        const seen = new Set<string>();
        for (const s of found) {
          for (const id of s.found) {
            const item = byId.get(id)!;
            expect(item.description.toLowerCase()).toContain(s.rule.contains.toLowerCase());
            expect(reads(s.rule, item)).toBe(true);
            expect(seen.has(id), `${id} found twice`).toBe(false);
            seen.add(id);
          }
          expect(s.matches.foundCount).toBe(s.found.length);
          expect(s.matches.count).toBe(s.matches.foundCount + s.matches.alsoCount);
        }
      }),
      { numRuns: runs(500) },
    );
  });

  it('53.9 random histories: overlaps go both ways, and two suggestions overlap exactly when an item reads by both', () => {
    fc.assert(
      fc.property(histories, (lines) => {
        const found = find(lines);
        for (const a of found) {
          for (const b of found) {
            if (a === b) continue;
            const both = lines.some((l) => reads(a.rule, l) && reads(b.rule, l));
            const ab = overlapsOf(a.rule, [{ key: { suggestion: b.id }, rule: b.rule }], lines);
            const ba = overlapsOf(b.rule, [{ key: { suggestion: a.id }, rule: a.rule }], lines);
            expect(ab.length === 1).toBe(both);
            expect(ba.length === 1).toBe(both);
          }
        }
      }),
      { numRuns: runs(300) },
    );
  });
});

describe("53.5 her team's test bank labels (recorded Oct 26, 2026)", () => {
  // What Plaid's test bank sent her Plaid team for made-up accounts
  // (live/labels.live.ts, LIVE_RECORD): the same detailed labels as his
  // team's on Oct 9 (her-questions.txt HB34). Read by the finder as setup day
  // would, the accounts by their made-up masks; the old card is not hers.
  it('53.5 53.3 53.4 the labels her team gets give payments to people, fees and interest; card payments and transfers pair', () => {
    const recorded = JSON.parse(readFileSync(new URL('./fixtures/her-test-bank-labels.json', import.meta.url), 'utf8')) as { endpoint: string; response: { accounts?: { account_id: string; mask: string }[]; added?: unknown[] } }[];
    const page = recorded.find((r) => r.endpoint === '/transactions/sync' && (r.response.added ?? []).length > 0);
    if (page === undefined) throw new Error('no history in the recording');
    const roles = new Map<string, AccountId>([['1111', 'checking'], ['2222', 'savings'], ['3333', 'everyday-card']]);
    const accounts = new Map((page.response.accounts ?? []).map((a) => [a.account_id, roles.get(a.mask)]));
    const lines = (page.response.added ?? []).flatMap((raw): FinderLine[] => {
      const read = readPlaidItem(raw);
      const account = read.ok ? accounts.get(read.item.accountId) : undefined;
      return !read.ok || account === undefined ? [] : [{ id: read.item.id, account, amount: read.item.amount, date: read.item.date, description: read.item.description, pending: read.item.pending, label: labelOf(raw), postedAs: null }];
    });
    const found = find(lines);
    expect(found.filter((s) => s.group === 'people-fees').map((s) => [bankRule(s).account, s.rule.contains, bankRule(s).means])).toEqual([
      ['checking', 'payment to', 'payment-to-person'],
      ['savings', 'Zelle payment to MOM MADEUP', 'payment-to-person'],
      ['everyday-card', 'FEE', 'card-fee'],
      ['everyday-card', 'INTEREST CHARGE ON PURCHASES', 'card-interest'],
    ]);
    // 53.8: the two fees share only "FEE", which a purchase holds too: it is
    // listed apart, so she sees it before she keeps the rule.
    const fees = found.find((s) => s.rule.contains === 'FEE');
    expect(fees?.matches.also.map((i) => i.description)).toEqual(['COFFEE SHOP 5']);
    expect(found.filter((s) => s.group === 'card-payments').map((s) => [bankRule(s).account, s.rule.contains, bankRule(s).other])).toEqual([
      ['checking', 'Online payment to CRD', 'everyday-card'],
      ['everyday-card', 'PAYMENT - THANK YOU', 'checking'],
    ]);
    expect(found.filter((s) => s.group === 'transfers').map((s) => bankRule(s).account)).toEqual(['checking', 'savings', 'savings', 'checking']);
  });
});
