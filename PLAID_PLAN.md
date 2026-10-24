# PLAID_PLAN.md

## Goal

Change an existing personal budget app (transactions, balances, liabilities,
read-only) from one Plaid Item to two Items: Capital One, then American
Express, each with its own access token, cursor, webhook item id,
update-mode re-login and consent expiry. (workflow_id: wf_dae764eeba929992)

This is her setup's copy of the app (CLAUDE.md). The rules it follows are in
budget-app-rulebook.md: 1.1, 1.3, 0.5, 0.7, section 2's sync line, 10.5,
10.7, 10.13 and 12.3 (PR 6), with the readings HB8 to HB11 in
docs/her-questions.txt.

## Scope

- Products: as the app already uses them, unchanged by PR 6.
  - transactions: her spending, deposits and transfers, through
    /transactions/sync (TXN-001), from each Item's own cursor.
  - liabilities: each card's statement balance, minimum and due date
    (sections 9 and 52), through /liabilities/get on each Item with a card
    (LIAB-008: both of hers have one).
  - Balances come with /accounts/get at no charge; no Balance product
    (BAL-001).
- Rejected: investments (she has none to track), Recurring Transactions (the
  app finds repeat charges itself, rulebook 40.16), auth and identity (the
  app never moves money and needs no account numbers).
- Platform: web/TypeScript: a Node server (packages/server) and a React/Vite
  web app added to the phone's home screen (packages/web), Plaid Link's web
  script on the Bank page only.
- Environment: sandbox (her own Plaid team) until her connection day
  (roadmap Phase 3). test/sandbox-only.test.ts keeps it so.

## Human tasks

| Task | Why it matters | Where | State |
|------|----------------|-------|-------|
| On her Plaid team, check that Transactions and Liabilities are enabled for Sandbox now, and for Production before connection day | Without them Link refuses her banks, or statements never come | https://dashboard.plaid.com/team/products | needs_human (her team is not readable from this session's Plaid login) |
| Before connection day, complete her team's company profile and any institution prerequisites for Capital One and American Express (OAuth institutions) | A missing prerequisite hides the bank from Link without an error (OAUTH-008) | https://dashboard.plaid.com/settings/company/profile | needs_human |
| After the first deploy with webhooks, point both connections at the hosted server (fly ssh console -C "node /app/serve/webhook-address.mjs") | Plaid's webhooks only reach a server whose address the Item has (HB11) | docs/her-setup.txt | needs_human (at connection day) |

## Implementation checklist

- [x] Her second Item kept in her own table (her step 2: her_connections,
      her_banks), sealed; upstream's one-row table keeps the first (GUIDE-002).
- [x] Same bank never connected twice: refused before the public_token is
      exchanged, by Link's institution_id (ITEM-001, ITEM-011).
- [x] A third Item never made; one connection made at a time.
- [x] Update mode per Item: the link_token for "Log in to <bank> again" is
      made with that Item's own access_token; nothing is exchanged after it
      (ITEM-003).
- [x] Each Item synced on its own cursor; a failure in one keeps what the
      other read (TXN-002, ITEM-004: tried again at the next sync).
- [x] ITEM_LOGIN_REQUIRED, consent_expiration_time (/item/get, ITEM-010) and
      the last good read kept per Item; alerts name the bank.
- [x] Webhooks routed by item_id (DATA-005); one for neither Item refused;
      each burst syncs only the Items it named (TXN-003).
- [x] Access tokens never logged, never sent to the browser (GUIDE-002,
      GUIDE-006): tests check the log and the Bank page.

## Acceptance

- Round 1 (PR 6, Oct 24): FAIL, 12 of 15 passed. Not passed, none of them
  a fault in the code:
  - CHECK-007, no OAuth redirect URI: Link's login opens in a window of its
    own, on a computer (Decisions made, his call Oct 24).
  - CHECK-008, not run against Plaid's real sandbox: her team's sandbox
    keys are not in this session; it is the roadmap's Phase 2 rehearsal.
  - CHECK-009, the human tasks above are still to do on her team.
- Round 2 (PR 7+8, Oct 24): FAIL, 12 of 15 passed, the same three as round
  1. PR 7+8 changes no Plaid call: each sync now also keeps every card
  statement Liabilities sends (her step 3, her_statements, 52.5), in the
  same transaction as the cursor. Liabilities fields are read as nullable
  (LIAB-002): a statement with neither date is not kept.
  Re-run build_check_acceptance after any later change to Plaid code, and
  after the rehearsal.

## Maintenance

This integration is maintained with the Plaid MCP; this file is its durable
state. Agents working in this repository: consult build_guidance before
modifying any Plaid-touching code, and re-run build_check_acceptance before
reporting such a change as working. The acceptance above applies only to
the code as it was verified — later changes invalidate it.

## How to test

### Two banks against made-up banks (no Plaid account needed)

1. Run the tests: `SKIP_BROWSER_TESTS=1 npm test` (the made-up Plaid in
   packages/server/test/fake-plaid.ts plays both banks, twoBanks()).
2. The Bank page in a browser: `npx vitest run --project web-browser
   packages/web/test/browser/two-banks-her.test.ts`.
3. Expect: "Connect a bank", then "Connect your other bank", both banks
   named, her four accounts picked across both, and "Log in to <bank> again"
   for each.

### The rehearsal on Plaid's sandbox (roadmap Phase 2)

1. Her team's sandbox keys in the server's `.env`, put there by him with
   `plaid keys write --env sandbox --gitignore` (GUIDE-021).
2. Start her server (BUDGET_SETUP=her), open Settings, then Bank, on a
   computer.
3. Connect a bank: in Plaid's window pick a sandbox bank, user_good /
   pass_good; then connect your other bank with a different sandbox bank.
4. Expect both banks listed by name, and the same bank refused if picked
   twice.

## Decisions made

- Link opens Plaid's own login in a window of its own, with no OAuth
  redirect URI; connecting is done on a computer, as the Bank page says
  (upstream's choice). OAUTH-001 to OAUTH-005 would be needed only to
  connect from the phone. His call, Oct 24: from a computer.
- Each bank's name on her screens and in her alerts is the one Link gives
  (HB8).
- Liabilities stays in `products`, beside transactions, as upstream has it
  (his call, Oct 24). Plaid's guidance (LIAB-007, SELECT-005) puts it in
  `additional_consented_products`; both of her banks support Liabilities
  and the app reads it on every sync, so it changes nothing for her, and
  upstream's code stays as it is.
- She connects from a computer: no OAuth redirect URI (his call, Oct 24).
  CHECK-007 stays not passed on purpose.

## Open questions

(none)
