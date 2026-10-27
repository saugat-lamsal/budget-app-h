import { bankNameOf, type BankConnection } from './bank/connections.js';
import type { ServerLogLine } from './views/server-log.js';

// Her rulebook, 1.1, 13.5 and HB8: on her screens each bank is named as
// Plaid named it when she connected it, so Settings' change log says
// "Bank connected · Capital One, through Plaid", not upstream's "Bank of
// America". The line keeps no bank number, but her banks are connected one at
// a time on the Bank page, bank 1 then bank 2, each with its line in the same
// step (bank-desk.ts), so the nth real line is bank n. The test bank's lines
// keep their words: its first bank connects by itself, with no line. Worked
// out when Settings opens, never saved; her setup only (keeper.ts). It only
// reads.
export function withBankNames(lines: readonly ServerLogLine[], banks: readonly Pick<BankConnection, 'bank' | 'name'>[]): ServerLogLine[] {
  let real = 0;
  return lines.map((line) => {
    if (line.action !== 'bank-connected' || line.bank !== 'real') return line;
    real += 1;
    const bank = banks.find((b) => b.bank === real);
    return bank === undefined ? line : { ...line, name: bankNameOf(bank) };
  });
}
