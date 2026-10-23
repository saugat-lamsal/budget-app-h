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
7. A PR that changes the money math (packages/money) gets the full bar:
   all of the above, plus the long simulator runs (1,000 her lives of 5
   years, `node scripts/simulate.mjs --profile her`, and 20 simulated years
   through the bank connection and the database with restarts), and the
   upstream lives too, unchanged.
8. End of each PR: a short report of the rules and their tests, the test
   count, the break-it results, and anything not tested and why.

Test only what changed (upstream's rule, kept):

- While working, run only the test files for the code you changed
  (`npx vitest related <files>` is fine), plus the type check.
- Before each push, run one full `SKIP_BROWSER_TESTS=1 npm test`. Run
  browser tests locally only for the screens you touched; CI runs the rest.
- Never rerun a suite that already passed on the same code.
- Long simulations only when the money math or the simulator changes, and
  then always (point 7).
- A commit with only docs or notes gets [skip ci].


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
- Waiting on: HA1 to HA5 in docs/her-questions.txt (plan Q2, Q4 to Q7).
