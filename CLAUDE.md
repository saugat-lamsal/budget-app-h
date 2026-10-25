# Budget App, her setup

A personal budget and paycheck tracker for one person, called "the owner"
in this repo (never by name). It reads her Capital One and American Express
accounts through Plaid, on two connections, splits each paycheck into
buckets (savings, needs, wants, Wishlist), sorts transactions, and sends
reminders. She opens it on her phone as a web app added to the home screen.

It is a copy of the developer's budget app ("upstream",
github.com/saugat-lamsal/budget-app), changed for her setup. The developer
builds it and gives every OK. The owner's wishes reach this repo through
him.

The full behavior is in the rulebook. The build order is in the roadmap.
The plan for her setup, approved Oct 23, 2026, is docs/her-plan.txt.
Read all three before doing anything.

@budget-app-rulebook.md
@budget-app-roadmap.md


## Why this project is strict

This handles real money. Correctness comes before features, every time.


## Her money stays out of this repo

The repo is public. Nothing about the owner's real money goes in it, ever:
no names of her stores, no balances, no amounts from her accounts or
statements, no account numbers or their last digits, and not her name. That
covers code, tests, fixtures, logs, commit messages, PR text and docs. The
bank names (Capital One, American Express) may appear (his OK, Oct 23).

- Test data is made up. Worked examples use made-up numbers.
- A look at her live books (read-only, only with his OK) is reported
  without her numbers: "nnnn" for an account's digits, no amounts.
- A permanent test made from her real history never lives in this repo.
- If something of hers is found in the repo, stop and tell him. Do not
  quietly rewrite history.


## How to work

- Follow the roadmap one phase at a time, and the PR order in
  docs/her-plan.txt. Stop and report at each finish line and after each
  PR, before it is merged.
- The rulebook is the source of truth. If the code and the rulebook
  disagree, the code is wrong. If the rulebook is unclear or missing a case,
  stop and ask. Do not guess, and do not change the rulebook without his OK.
- A rule in the rulebook's "Approved for her setup, not built yet" section
  is not in force yet. The PR that builds it moves it into place, with its
  tests.
- Every numbered rule gets at least one test, named after the rule number
  (for example "50.2 the items fill in order").
- Write the test before the code for each rule.
- Never weaken, skip, or delete a failing test to make it pass. Fix the code
  or raise the question.
- Any bug found later becomes a test first, then gets fixed.
- Auto-merge only where point 7 says so (PRs 7+8 and 10+11). Never for
  the money-math PRs (3 to 6 and 9): open the PR, let CI run, and stop for
  his review. He merges after he has checked it.


## Upstream, and keeping close to it

Upstream's fixes (a Node security update, a rule fix) are merged in here
later, so the code stays as close to upstream's as it can.

- Switches, not deletions. Nothing of upstream's is deleted. The mom
  reserve and the old card stay in the code, switched off on her setup day
  and hidden. Upstream's defaults (DEFAULT_SETTINGS) never change. Her
  starting values live in packages/money/src/her-setup.ts. Every upstream
  test keeps passing unchanged.
- A new setting gets, for any history saved before it existed, the value
  that means "as upstream" (B242): Wishlist 0%, one card, mom on, no
  asking.
- New files over edits. Her code, tests and worked examples go in files of
  their own (her-setup.ts, wishlist.ts, statement.ts, *-her.test.ts,
  worked-examples-h.txt). Shared files get small hooks only. A merge
  conflict in shared code means a hook grew too big: move her part out.
- Database: her tables go in their own list of steps (HER_STEPS, with its
  own version in a table her_schema), run after upstream's STEPS. Never add
  to upstream's STEPS.
- Rule numbers: every upstream number is kept. Her new rules are numbered
  from 50 up. Her answers are rulebook sections from 60 up. Her questions
  are HA1, HB1, ... in docs/her-questions.txt.
- Upstream's QUESTIONS.md, docs/later.txt and phase reports are its
  history. Read them; do not edit them.
- Merging from upstream: docs/her-merging.txt, every time. It needs a git
  config on each machine (git config merge.ours.driver true), not only
  .gitattributes.
- The remote "upstream" is fetch only (its push URL is DISABLED). Never
  push to it and never change that.


## Testing bar for every PR

This applies to every PR and every session, cloud or local.

1. Tests before code. At least one test per numbered rule, named after the
   rule number. Watch each test fail before writing the code that makes it
   pass.
2. Edge cases for every rule: zero, one cent, negative, very large amounts,
   and exact boundaries (exactly at an item's price, exactly at the alert
   level, a paycheck of one cent, a purchase on a statement's closing day).
3. Break-it check. After a section passes, break the code on purpose in
   several ways (flip a sign, change a rounding, shift a boundary by one
   cent). Some test must fail each time. If none does, add the missing test.
   Restore the code afterward. Run break-it only for the functions you
   changed. Her breaks are tagged "[her-...]".
4. Random-scenario tests for things that must always be true: paycheck
   parts add up exactly, no cent is created or lost, own-account transfers
   never change a bucket, the self-check holds, a statement's lines add up
   to its balance, what is set aside for a card is what it owes.
5. Worked examples by hand, with made-up numbers, that the developer can
   check (packages/money/worked-examples-h.txt and
   packages/server/worked-examples-h.txt). Each one is also a test.
6. Type-check and run the tests as "Test only what changed" says below.
7. Which bar each PR gets from PR 7 on (his OK, Oct 24, 2026). PRs 7 and
   8 are one PR, and 10 and 11 are one PR. The order: 7+8, 9, 10+11, 12.
   - View and read-only PRs (7+8, 10+11): tests for the new code only. No
     long simulator runs. Break-it at most about 25 breaks, on the new
     logic. No twin tests. Browser tests locally in Chromium for the
     screens touched only (CI runs WebKit, see "Two test runs"). Auto-merge when
     CI is green.
   - PR 9 (the Wishlist bucket, money math): tests first for every rule;
     the random tests (paycheck parts add up, no cent made or lost, the
     self-check holds); her lives 200 x 2 years only (`node
     scripts/simulate.mjs --profile her --lives 200 --years 2`); break-it
     about 25, on the money code. Stop for his review, no auto-merge.
   - Upstream's lives are not rerun unless shared money code changes.
   - PR 12 keeps the full end check: 1,000 her lives of 5 years (`node
     scripts/simulate.mjs --profile her`), and 20 simulated years through
     the bank connection and the database with restarts.
   (PRs 3 to 6 had the full bar: all of the above, plus 1,000 her lives of
   5 years, 20 years through the bank connection and the database with
   restarts, and the upstream lives too, unchanged.)
8. End of each PR: a short report of the rules and their tests, the test
   count, the break-it results, and anything not tested and why.

Test only what changed (upstream's rule, kept):

- While working, run only the test files for the code you changed
  (`npx vitest related <files>` is fine), plus the type check.
- Before each push, run one full `SKIP_BROWSER_TESTS=1 npm test`. Run
  browser tests locally only for the screens you touched; CI runs the rest.
- Never rerun a suite that already passed on the same code.
- Long simulations only as point 7 says.
- A commit with only docs or notes gets [skip ci], with one exception:
  main needs the four CI checks (checks, webkit 1/2, webkit 2/2, image)
  before a pull request can merge, and a pull request whose last commit says
  [skip ci] never gets them. So [skip ci] goes only on a docs or notes
  commit that is not the last commit of a pull request with code in it;
  the last commit of such a pull request always runs CI.


## Two test runs (his OK, Oct 24, 2026)

One good test per case beats many that check the same thing.

- Default run: `npm test`, and CI on every pull request (jobs: checks,
  webkit 1/2 and webkit 2/2, image). It leaves out the slow files, runs fast-check at most
  150 times a property, one short simulated life where a file needs one,
  and the browser tests in WebKit only (her phone is an iPhone, Safari's
  engine), split by file in two shards that run at the same time (vitest
  --shard). Locally, `BROWSER_ENGINE=chromium` picks Chromium.
- Slow run: `npm run test:slow` (sets TEST_SLOW=1). Everything, with the
  counts each test file had before, and the browser tests in Chromium. By
  hand in CI: Actions, Tests, Run workflow, tick "Run the slow tests".
  Run it for PR 12, when shared money code changes, and before trusting a
  change to the simulator or the harness. Break-it (scripts/break-it.mjs)
  judges every break against the slow run's tests.
- What is slow: SLOW_FILES in vitest.config.ts (the second-card twins,
  the long simulated lives and the alert and Trends random lives, the
  browser random-lives, break-it's own tests), the Litestream heartbeat
  test (real minutes), and the larger counts in each package's
  test/slow.ts (`runs(n)` for fast-check, `lives(slow, default)` for
  lives, years and scenarios).
- A new test is fast by default. A long one is either added to SLOW_FILES
  or written with `runs()`, `lives()` or `it.runIf(SLOW)`. A rule's test
  in a slow file still counts for the rule table. Upstream's test files
  stay where they are (merges stay easy).
- Her own tests: one rule is proved at the lowest level that can prove it,
  plus one browser test per screen. A test at a higher level stays only if
  it checks something the lower one cannot (the wiring, the database, the
  words). A her-only duplicate is dropped, never upstream's.

## Technical decisions already made

Upstream's, unchanged:

- TypeScript everywhere.
- The money math is its own package with no screens, no network, no
  database, and no clock of its own. Dates and times are passed in so tests
  can control them.
- All amounts are whole cents, stored as integers. No floating point for
  money anywhere.
- A web app (installable on the phone's home screen) with a small backend
  and SQLite (better-sqlite3). React + Vite in packages/web.
- Login by passkey. One user.
- Notifications by web push from the installed home-screen app.
- Nothing is hard-coded. Percentages, amounts, thresholds, rules, and timing
  are all settings (rulebook section 2). The switches fixed on setup day
  (mom reserve off, old card off) are the one exception, and the rulebook
  says so.
- Hosting: Fly.io, its own app for her, with Litestream backups to her own
  Cloudflare R2 bucket.


## Safety rules

- The app is read-only toward the bank. Never add anything that moves money.
- Plaid test bank (sandbox) only until her connection day. Do not connect
  real accounts before then. Her Plaid team (her own, not his) allows 10
  connections and removed ones do not come back, so never create a real
  connection for testing. Her setup uses two.
- Never submit a Production application in Plaid.
- The Plaid access tokens live on the server only, encrypted. They never go
  to the browser or the phone.
- No secrets in the repo. Use environment variables and keep .env out of
  git. Her keys (bank key, push keys, Plaid, R2) are her own, never his.
- Her bank logins are typed by her, in Plaid's window. Never by the
  developer, and never by Claude.
- Before changing code that touches Plaid, read the Plaid build kit's
  guidance (build_guidance), as upstream did.


## Testing layers

1. One or more tests per rulebook rule.
2. A simulator that invents a realistic money life and fast-forwards
   through years of it, with a profile shaped like hers (two cards, two
   banks, Wishlist, paychecks confirmed) beside upstream's. The daily
   self-check must pass on every simulated day.
3. Random-scenario tests against things that must always be true.
4. An independent set of tests written from her rulebook by a separate
   agent that has not seen the code (recommended for the Wishlist and the
   paycheck rules).
5. Browser tests that use the app like a person and compare the screens to
   the money math.


## How to talk to him

- Plain language, bottom line first, short.
- Plain text over formatted documents.
- When something needs a decision, give the options and a recommendation.
- Anything meant for the owner herself (a sheet in the app, an
  explanation) is in plain words with a made-up example.


## Design rules

Upstream's, unchanged: built for a phone first (the notch and the home bar,
44-point tap targets, the bottom tab bar Home, Buckets, Review, Trends,
Settings); the "Linear" look (Geist and Geist Mono, one accent color,
200 to 300 ms expo-out motion, no bounce, reduced motion turns it off;
charts on Trends only); dark only; one main number per screen (on Home,
safe to spend); money always formatted the same way; color is never the
only signal; every screen has loading, empty and error states, and "totals
do not match the bank" is impossible to miss; anything final asks first;
readable contrast and the phone's text size; one shared set of building
blocks on every screen (packages/web/src/ui).

Hers: nothing about mom or the old card on any screen. Words like "Ready"
or "Due" on Wishlist items and cards, never color alone.


## Status

- Oct 23, 2026: the repo is set up (a copy of upstream main at af53eee,
  PR #51). upstream is fetch only, and origin is budget-app-h. Plan approved
  (docs/her-plan.txt), with his answers to Q1 (Wishlist money in savings,
  plus rule 50.4), Q3 (her own Plaid team, already made) and Q8 (bank names
  kept).
- PR 1, her docs: this file, her rulebook draft H1, her roadmap,
  docs/her-later.txt, docs/her-questions.txt, docs/her-merging.txt,
  .gitattributes. Docs only.
- PR 1 merged (Oct 23, 2026).
- His answers to HA1 to HA5 (Oct 23): rulebook section 60,
  docs/her-questions.txt. Section H's 14.2 for PR 5 no longer names
  Wishlist (PR 9 adds it).
- PR 2, hosting config (branch her-hosting), no account made: her app
  budget-app-h-lbwr (https://budget-app-h-lbwr.fly.dev), volume
  budget_h_data, ewr, PLAID_ENV sandbox, backups to folder budget-h in her
  own R2 bucket. The deploy check reads the app from fly.toml (appOf in
  scripts/deploy-check-lib.mjs); upstream's name was written in it.
  test/hosting-config.test.ts holds her values and checks no hosting file
  names upstream's app, volumes or folders. test/sandbox-only.test.ts: only
  fly.toml may say production, now at most once. His steps:
  docs/her-setup.txt.
- PR 2 merged (Oct 23, 2026).
- PR 3, no mom reserve and no old card (branch her-switches): switches,
  not deletions. packages/money/src/switches.ts (both on is upstream's;
  off is fixed on setup day, and anything about what is off is refused
  with off-in-this-setup), her-setup.ts (HER_SWITCHES, HER_SETTINGS;
  DEFAULT_SETTINGS unchanged). The server starts her setup with
  BUDGET_SETUP=her (fly.toml; setup-start.ts), asks for three accounts,
  and takes what is off out of each screen just before it is sent
  (views/off.ts, http/off-options.ts); the web reads the ...Shown types.
  Her simulated life: node scripts/simulate.mjs --profile her, and
  packages/server/test/simulated-life-her.test.ts. Rulebook: "Off in this
  setup" after section 1, section 2, 12.2, 40.2, 40.4.
- PR 3 merged (Oct 23, 2026).
- PR 4, "Ask before splitting a paycheck" (branch her-paycheck-ask). The
  setting askBeforeSplittingPaycheck is optional: upstream's
  DEFAULT_SETTINGS do not have it (upstream's 0.2 test lists them all), and
  missing means off, as upstream; HER_SETTINGS has it on. While on, a
  deposit the paycheck rule matches waits in review with reason 'paycheck';
  yes is "This is my paycheck" (6.1, B53). Book.paychecksWaiting() (51.1),
  packages/money/src/paycheck-ask.ts (51.2, older first), the 13.2 recheck,
  review-options (51.2's why). Server: the 10.15 alert (paycheck-waiting),
  Home's paycheck-waiting row, the setting's reader. Web: Review's paycheck
  card (the parts, "Yes, split it", "Not a paycheck"), Home's row, Settings'
  row. Her simulated life says yes on the day, days late, or two weeks
  late, and sometimes "not a paycheck" first, then her paycheck after all.
  Rulebook: section 2, 3.1, 10.15, 13.2, section 51. Readings HB1 to HB5 in
  docs/her-questions.txt, for his check.
- PR 4 merged (Oct 23, 2026).
- PR 5, the second card (branch her-second-card). A fifth account,
  'second-card' (the Amex card; the Capital One card is 'everyday-card'),
  switched on by a third switch, secondCard: off is upstream's (and any
  book saved before it), on is hers (HER_SWITCHES). ALL_ACCOUNTS lists all
  five; upstream's ACCOUNTS stays its four. Money: BankBalances.secondCard
  (optional), the bank side and setup day take both cards off, reminders
  treat it as the everyday card (EverydayCard), review offers it as a
  transfer after the everyday card (optionsInThisSetup), her setting
  secondCardClosingDay (optional, like askBeforeSplittingPaycheck). Server:
  her first database step (db/her-steps.ts, her_account_roles, version in
  her_schema; run only in her setup), the bank side and why-lines per card,
  each card's statement with its own closing day, bank rules on it. Card
  names (HB6): each card as its bank names it, sent with the screens that
  name cards (http/card-names.ts) and in the reminders' facts; the web
  remembers them (ui/card-names.ts). Twins: second-card-twins-her.test.ts
  runs upstream's money tests again through a mirror (test/twin) with the
  second card in the everyday card's place. Readings HB6, HB7.
- PR 5 merged (Oct 24, 2026).
- PR 6, two bank connections (branch her-two-banks). Bank 1 is upstream's
  one connection; her second is in her step 2 (her_connections), and each
  bank's name, last good read and failing state in her_banks
  (bank/connections.ts). Her setup has two banks while the second card is
  on (Keeper #banksInSetup). The desk connects while fewer than two, refuses
  the same bank before the exchange (Link's institution, HB8), and logs in
  again per bank. Keeper.sync reads each bank in turn; one failing keeps
  the other's read and the check waits (12.3, HB9: #waiting). Alerts per
  bank (bank: 2, lasting kinds bank-login-2 and bank-not-read-2, HB10);
  webhooks per item (itemIds, syncItems, HB11). Screens: Bank page per bank,
  Home's login rows and greyed safe to spend by name, status per bank.
  Tests: two-banks-her.test.ts, sync-random-her.test.ts, her simulated life
  through two Items (harness twoBanks, bothBanks). PLAID_PLAN.md.
- PR 6 merged (Oct 24, 2026). His answers: HB6 to HB11 agreed; Liabilities
  stays in products, as upstream; she connects from a computer, no OAuth
  redirect. His new testing bar for PRs 7 to 12 (point 7).
- PR 7+8, both cards on Home and each card's statement (branch
  her-cards-statements). Section 52 in place. Money, read only: a hook on
  the book (Book.cardEntries), set-aside.ts (52.2: what each card owes as
  the books count it, from what setup day counted, owedAtSetup) and
  statement.ts (52.4: lines that add up to the statement balance, with
  "Not matched" never hidden). Server: Home's card rows (views/home-cards.ts,
  her setup only), the Statement screen's view (views/statement.ts) at
  /api/statement/<card> and /statement/<card> (HER_SCREEN_PATHS, kept apart
  from upstream's SCREEN_PATHS), her step 3 (her_statements, 52.5, kept by
  each sync in her setup). Web: "Your cards" on Home with the sheet "Why
  paying your card isn't spending", the Statement screen (by bucket, by
  paycheck). Readings HB12 to HB18. Random test: her lives, every day each
  card's owed against the simulated bank, every statement adds up with
  nothing not matched (cards-random-her.test.ts).
- PR 7+8 merged (Oct 24, 2026). HB12 to HB18 agreed by him (Oct 24).
- PR 9, the Wishlist bucket and 50.4 (branch her-wishlist). A fourth switch,
  wishlist (off is upstream's and any book saved before it, B242; on is
  hers), and Settings.split.wishlist (optional; with the switch on the split
  always names it; HER_SETTINGS starts it at 0%). Money: Pots.wishlist and
  PaycheckSplit.wishlist only where the switch is on; 3.3 four parts, 3.4
  never asked, 3.8 savings plus Wishlist, 4.2 and 4.4 sorting and splits to
  it (not a payment to a person), 6.1 payback into it and other income four
  ways, 11.3, 12.2, 13.4 out-of-wishlist, 14.2, 52.4's Wishlist group;
  Book.movablePots(), Book.wishlistFlows() (a read hook) and wishlist.ts
  (50.4: $X, when, the cards). No sorting rule picks Wishlist (HB21).
  Server: Buckets' wishlist, Wishlist's list at /buckets/wishlist
  (HER_POT_SLUGS, HER_BUCKET_PATHS, kept apart from upstream's), the desks
  (setup day, review, hand moves, the four-way split), history totals,
  Home's 50.4 line (views/home-wishlist.ts) and the card reminders' line.
  Web: Buckets, Move, Payday, Review, Settings, Setup day, the Statement
  screen, Home's "Wishlist" card. Trends' Wishlist parts (40.2, 40.4,
  40.5, 40.11) are built in PR 10+11 (HA6) and stay in section H.
  Readings HB19 to HB25.
  Her simulated life buys from Wishlist, splits three ways, refunds, moves
  money by hand and does 50.4's move.
- His answer to HA6 (Oct 24): Trends' Wishlist parts are built in PR 10+11
  (rulebook 60f; section H's PR 10+11 block).
- Test speed-up (branch her-test-speed, before PR 10+11): two test runs,
  see "Two test runs". Before it, the default run took 4 min 20 s here
  without browsers, and CI 17 min 30 s; the PR text has the times after.
  Required checks on main: checks, webkit, image.
- PR #9 merged (Oct 24, 2026); its branch deleted.
- PR 10+11, Wishlist items and Trends for her setup (branch
  her-wishlist-items-trends). Rules in force: 40.2, 40.4, 40.5, 40.11 and
  50.1 to 50.3; section H holds no approved text not built. Money:
  wishlist-items.ts (50.1 the list and its refusals, 50.2 the fill, 50.3
  bought and changed back; no money moves) and Book.wishlistSpentIn (a
  read hook, 40.2). Server: the list is kept as answers in the books'
  history (Answer.wishlist, replayed in history-db), changed through
  /api/choice ({ wishlist: ... }, wishlist-items.ts), and a sort to
  Wishlist names the item (ChoiceRequest.wishlistItem) in the same answer;
  Review and the bucket lists carry the list, Wishlist's list carries the
  fill, what was bought, and the changes. Trends: Wishlist's part of each
  bar, Wishlist beside savings, no estimate for it; 40.7 stays on needs and
  wants (HB27). Web: the list on /buckets/wishlist, "Which thing on your
  list was it?" in the choice sheet, Trends' Wishlist part and line.
  Readings HB26 to HB29. CI: the WebKit job in two shards, webkit 1/2 and
  webkit 2/2, both required on main (checks, webkit 1/2, webkit 2/2,
  image).
