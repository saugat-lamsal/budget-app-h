# Budget App Roadmap, her setup

Each phase has a finish line. We do not start the next phase until the
current one crosses it. The pull requests are the ones in
docs/her-plan.txt, in that order. Sizes are rough guesses, not promises.

Upstream's roadmap (Phases 0 to 8 for his setup) is done up to his Phase 7
and stays in upstream's history. Everything it built is the starting point
here: the money math, the simulator, the bank connection, the screens, the
alerts, the phone, hosting and backups.


## Phase 0. The repo (small) - done Oct 23, 2026

- A copy of upstream main (af53eee) in budget-app-h. upstream is fetch
  only (push URL DISABLED), and origin is budget-app-h.
- The plan, approved: docs/her-plan.txt.
- PR 1: her CLAUDE.md, this roadmap, her rulebook draft H1, her notes,
  and how to merge from upstream (docs/her-merging.txt).

Finish line: the plan is approved, and PR 1 is merged.


## Phase 1. Her setup in the code (large)

Each money-math pull request stops for his review before it is merged.
From PR 7 on, each PR gets the bar CLAUDE.md's point 7 gives it (his OK,
Oct 24, 2026): PRs 7 and 8 are one PR, and 10 and 11 are one PR; those two
are view and read-only and merge by themselves when CI is green.

- PR 2: hosting config for her own Fly app (no account made).
- PR 3: the mom reserve and the old card, switched off and hidden. Her
  simulated life starts. Full bar.
- PR 4: "Ask before splitting a paycheck". Full bar.
- PR 5: the second card. Full bar.
- PR 6: two bank connections. The long runs through the bank connection.
- PR 7+8: both cards on Home, set aside, reminders per card, and the
  statement view, per card. View and read-only.
- PR 9: the Wishlist bucket, and moving Wishlist money for a purchase
  (50.4). Money math: her lives 200 x 2 years, break-it about 25, his
  review. Second opinion recommended.
- PR 10+11: Wishlist items, and Trends for her setup. View and read-only.
- PR 12: the end check: break-it on every break new in PRs 3 to 11, 1,000
  of her simulated lives of 5 years, 20 years through the bank connection
  and the database with restarts, an agent through a full pay period on
  the screens, the table of every rule and its tests
  (docs/her-report.txt).
- PR 12b: the posted balance for her Capital One accounts (12.1, HA8,
  his OK Oct 26, 2026, 60h). Tests first, break-it about 25, her lives
  200 x 2 years, the run through the bank connection, his review.
- PR 13: the rule finder on setup day (section 53, his OK Oct 26, 2026,
  60g; docs/her-rule-finder.txt). Before her connection day: Plaid takes
  the 730 days only when a bank is first connected. Tests first,
  break-it about 25, no long runs, his review. Before it, a live read of
  her team's test bank labels.

Finish line: section H of the rulebook is empty (every approved text is in
force, with its tests), every numbered rule has a passing test, and PR 12's
runs pass with zero self-check failures.


## Phase 2. Hosting, test bank only (small)

- His steps in docs/her-setup.txt (PR 2): her own Fly app and volume, her
  own R2 bucket and token, new secrets (bank key, push keys, her Plaid
  team's sandbox keys), UptimeRobot on /health and /health/backups.
- The deploy check before every deploy, from the first one.
- Her phone: the one-time code, her passkey, the home-screen app,
  notifications, the test alert.
- The rehearsal: two made-up banks through Plaid's real window, the four
  picks, setup day on the test bank.

Finish line: the app works on her phone against the test bank, with both
made-up banks connected and the self-check passing.


## Phase 3. Connection day (small)

- The switch PR: her Plaid team's production secret, PLAID_ENV production,
  a fresh volume and backup folder.
- She connects Capital One, then American Express, typing her own logins
  in Plaid's window (2 of her team's 10).
- Check that each bank sends what the app needs: transactions, balances,
  and each card's statement balance, minimum, due date and statement date.
  Anything missing becomes a question before the trial starts.
- Setup day with her real balances and her split.

Finish line: setup day is done and the self-check passes.


## Phase 4. Trial on her real accounts (about a month)

- Run for two pay periods. Once a week, compare the app with her
  statements, card by card (the statement view helps).
- Any mismatch becomes a new test before it gets fixed.
- Nothing from her real accounts goes in the repo, not even with names
  removed.

Finish line: 30 days in a row with no self-check mismatches and no
surprises against her statements.


## Phase 5. Live

- She relies on the alerts and numbers day to day.
- The daily self-check stays on for good.
- Upstream's fixes are merged in as they come (docs/her-merging.txt).
