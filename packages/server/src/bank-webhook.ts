import type { TokenBox } from './crypto/token-box.js';
import type { Db } from './db/database.js';
import { connectionsOf } from './bank/connections.js';
import type { Log } from './log.js';
import { BankKey, PlaidError, type PlaidClient } from './plaid/client.js';
import { WEBHOOK_PATH } from './plaid/webhook.js';

// Section 2 (QUESTIONS.md A47): points his connection's webhooks at the
// hosted server's own address, with one /item/webhook/update call. The same
// connection: nothing new is made (it never uses another of the 10), and
// nothing is read. Run once on the machine, at his word, after the deploy
// (serve/webhook-address.ts). Plaid confirms it with a webhook to the new
// address (WEBHOOK_UPDATE_ACKNOWLEDGED), which the server's log notes.

// Her setup (HB11): both of her connections are pointed, bank 1 first;
// itemIds then names both.
export type PointAnswer = { readonly ok: true; readonly address: string; readonly itemId: string; readonly itemIds?: readonly string[] } | { readonly ok: false; readonly why: string };

export async function pointWebhooks(input: { readonly db: Db; readonly plaid: PlaidClient; readonly box: TokenBox; readonly address: string | null; readonly log: Log }): Promise<PointAnswer> {
  const { address } = input;
  if (address === null || !address.startsWith('https://')) return { ok: false, why: 'Plaid can only send webhooks to the hosted server\'s https address (APP_ORIGIN).' };
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, why: 'That is not an address.' };
  }
  if (url.pathname !== WEBHOOK_PATH || url.search !== '' || url.hash !== '') return { ok: false, why: `The webhook address ends in ${WEBHOOK_PATH}.` };
  const connections = connectionsOf(input.db);
  if (connections.length === 0) return { ok: false, why: 'There is no bank connection: a new one gets the address when it is made (1.1).' };
  const pointed: string[] = [];
  for (const connection of connections) {
    try {
      const key = new BankKey(input.box.open(connection.sealedKey, connection.itemId));
      const { itemId } = await input.plaid.updateWebhook(key, address);
      if (itemId !== connection.itemId) return { ok: false, why: 'Plaid answered about another connection.' };
      input.log.info('webhook address set on the connection', { address, ...(connections.length > 1 ? { bank: connection.bank } : {}) });
      pointed.push(itemId);
    } catch (error) {
      const why = error instanceof PlaidError ? `Plaid refused it (${error.errorCode}).` : 'Plaid could not be reached.';
      input.log.warn('webhook address not set', { why });
      // Her setup: a bank already pointed stays pointed; running it again points the rest.
      const kept = pointed.length === 0 ? 'Nothing was changed.' : 'Her first bank has the address now; run it again for the other.';
      return { ok: false, why: `${why} ${kept}` };
    }
  }
  return { ok: true, address, itemId: pointed[0] ?? '', ...(pointed.length > 1 ? { itemIds: pointed } : {}) };
}
