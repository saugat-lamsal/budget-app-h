import { describe, expect, it } from 'vitest';
import { checkBankRules, readBankItem } from '../src/bank/reading.js';

// Her rulebook, PR 5 (4.1, 4.8): how the bank's items on her second card are
// read. Kept apart from second-card-her.test.ts, whose bank rules are checked
// when the file loads: here a card read wrong fails a test, not the file.
// Every amount is made up.

describe('4.1 4.8 the second card is read as a card', () => {
  it('4.1 money onto the second card is a purchase, and money back is a refund, never a deposit', () => {
    expect(readBankItem('second-card', 4_210, 'MADE UP GROCERY', [])).toEqual({ kind: 'purchase' });
    expect(readBankItem('second-card', 1, 'MADE UP GROCERY', [])).toEqual({ kind: 'purchase' });
    expect(readBankItem('second-card', -1, 'MADE UP GROCERY', [])).toEqual({ kind: 'refund' });
    expect(readBankItem('second-card', -4_210, 'MADE UP GROCERY', [])).toEqual({ kind: 'refund' });
    expect(readBankItem('second-card', 0, 'MADE UP GROCERY', [])).toEqual({ kind: 'nothing' });
  });

  it('4.8 a fee or interest rule on the second card is a good bank rule', () => {
    expect(() => checkBankRules([{ id: 'second-fee', account: 'second-card', contains: 'LATE FEE', means: 'card-fee' }])).not.toThrow();
  });
});
