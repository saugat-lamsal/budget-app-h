# Budget App Rulebook, her setup (draft H1)

This is how the app treats every kind of money movement. Each rule has a
number so a test can point at it. Nothing gets coded until he approves it.

How this rulebook is built (draft H1, Oct 23, 2026). It starts from
upstream's rulebook, draft 30, kept word for word in sections 0 to 42,
with every number, because the code is upstream's and its tests are named
after those numbers. Today the code does exactly what sections 0 to 42 say,
for upstream's setup (one bank, the old card, the mom reserve), with the
texts already moved here from section H in their places (PR 3: "Off in this
setup" after section 1, section 2, 12.2, 40.2 and 40.4; PR 4: section 2,
3.1, 10.15, 13.2 and section 51; PR 5: section 1, 1.2, 4.1, 4.8, 5.1, 9.1,
9.3, 9.8, 12.1, 12.6 and 14.2; PR 6: 0.5, 0.7, 1.1, 1.3, section 2's sync
line, 10.5, 10.7, 10.13 and 12.3). The rest of her
setup is in section "H. Approved for her setup, not built yet" at the end:
the texts he approved on Oct 23, 2026 (docs/her-plan.txt). A text there is not in
force until the pull request named above it moves it into its place here,
with its tests. Until then, the rule it replaces is the one in force. "You"
is the owner. New rules are numbered from 50, and her answers will be
sections from 60.


## 0. Ground rules

0.1  All amounts are stored in whole cents.
0.2  Every number and rule in this document is a setting you can change in
     the app. Nothing is hard-coded.
0.3  Changing a setting never rewrites a past pay period.
0.4  The app is read-only. It never moves money.
0.5  If the app's totals do not match the banks, it says so instead of
     showing a number it cannot back up. If either bank cannot be read,
     Home shows the last safe to spend that both banks backed up, greyed,
     with the day and time it was checked, and says which bank could not
     be read.
0.6  What the bank sent and every answer you give are kept in order, each
     with the totals after it. If they no longer replay to those totals (a
     fix to the money math that changes what an old event does), the app
     does not start. A separate command shows each event whose totals would
     change, before and after, and with your yes takes the new totals from
     that event on. It goes in the change log (13.5), dated, with what
     changed. If an event cannot be replayed at all (a fix makes the money
     math refuse an old answer), the app does not start either: the command
     says which event and why, and nothing is dropped or replaced.
0.7  Status. Settings has a row "Status" that opens a page that only
     reads: when the bank was last read, and how the last sync went (new
     activity, nothing new, the bank wants a new login, or it failed, and
     when); whether the backups are copying (the heartbeat /health/backups
     watches); when the server last started; how many events the history
     holds, and that every one replayed to its totals when the books opened
     (0.6); since when the totals have not matched the bank, if they do not
     (10.4); and how many alerts wait to be sent. It shows no amounts.
     With two connections, each bank's last read and last sync, by name.
0.8  When the app cannot be reached. If the phone cannot reach the app's
     server when it opens a screen (no answer within 15 seconds, or the
     host saying the server is not running), it shows one fixed page built
     into the app instead of a blank screen: "Can't reach the app right
     now. Your money is safe; the server is offline or restarting. Try
     again in a few minutes." and Try again. The page has no numbers and
     nothing from the server. The phone keeps nothing for it, and every
     number is still asked of the server.


## 1. Accounts (two banks, two connections)

- Capital One: checking (debit card), savings, and the Capital One card.
- American Express: the Amex card.

Both cards are used day to day and work the same way.

1.1  Connecting the banks. This setup has two connections: Capital One,
     then American Express. "Connect a bank" is offered while fewer than
     two are connected. It asks first: each connection uses 1 of the 10
     Plaid allows, and one that is removed never comes back. Each bank's
     own login opens (through Plaid). The app keeps each connection the
     moment it gets it, sealed, on the server only. The app never makes
     a third, never connects the same bank twice, and never removes one.
1.2  Which account is which. After connecting, before setup day, you say
     which of the banks' accounts is checking, savings, the Capital One
     card, and the Amex card, each once, from either connection. Nothing
     is read from either bank until all four are picked. If one is
     missing, log in to its bank again to add it (1.3). Once tracking
     starts they cannot change. An account that is none of the four is
     never read.
1.3  Logging in to a bank again. For each connection: when that bank
     needs it (10.5), when its permission is running out (10.13), or to
     add an account that is missing, Settings offers "Log in to Capital
     One again" (or American Express). It keeps the same connection: it
     never uses another of the 10, and nothing already read changes.


## Off in this setup

These rules are part of the app and keep their tests, but this setup has no
mom reserve and no old card, and they never apply: 3.2, 5.2, 5.4, 5.5, 7.6
(the "for mom" choice), 8.1 to 8.4, 9.2, 9.5, 12.4, 40.13, and the old
card's share in 10.14. Being off is fixed on setup day and is not a setting
on the Settings screen. Off is not zero: nothing about them is shown or
offered anywhere.


## 2. Settings and starting values

- Split: savings 50%, needs 30%, wants 20% (must add up to 100)
- Low-bucket alert: 20% of what the bucket started the pay period with
- Card reminders: 7 days and 2 days before the due date
- Statement closing day, for each card: the day of the month its statement
  closes (you fill in, from a statement). Used only when the bank does not
  send a card's statement date (9.8).
- Daily review time: 8:00 PM
- Quiet hours: 10:00 PM to 7:00 AM. No alert is sent then (10.8).
- Bank not read: an alert after 24 hours without a good read of the bank
  (10.7).
- Totals do not match: told after the difference has lasted 12 hours
  (10.4).
- Amounts on the lock screen: off (10.10).
- Stay logged in: 30 days on a device, counted from the login. Logins, new
  passkeys and log outs are logged (13.5).
- Sync with the bank: every 60 minutes, of real time, counted from when the
  last sync started (a clock change does not move it), and also as soon as
  Plaid says it has something new (a webhook): new transactions, new
  statements, or a change to the connection. The timer stays, for a webhook
  that never comes. When the app starts, it syncs at once if one is due. A sync that fails changes nothing and is
  tried again at the next time. A change to this is logged (13.5).
  Each sync reads both banks. Plaid's webhook for one bank syncs that
  bank. A sync where one bank fails keeps what the other read, and the
  failed one is tried again at the next time.
- Bank permission ending: told 7 days before the bank's permission to read
  your accounts runs out (10.13).
- History at connection: when the bank is connected, the app asks it for
  the last 90 days. This cannot change once the bank is connected.
- Home time zone: America/New_York. The app's today is the date there,
  whatever time zone the server's own clock is set to. Dates the bank sends
  stay exactly as sent.
- Leftover at payday: ask each time (other options: always roll over,
  always move to savings)
- Paycheck rule: how your pay shows up on the statement (set after first sync)
- Ask before splitting a paycheck: on. While on, every paycheck waits for
  your yes before it is split (3.1). Off: a deposit the paycheck rule
  matches is split by itself, as soon as it posts.
- Pay schedule: twice a month, on the 15th and on the last day of the
  month; when that day is a Saturday or Sunday, the Friday before. The
  other choice: every 14 days, counted from the last paycheck (the app
  starts with this one; you pick on Settings). Twice a month, the next
  payday is the one after the scheduled payday nearest the last paycheck
  (halfway between two counts as the earlier), so a paycheck a few days
  early or late does not move the next one. A change applies right away
  (13.1).
- Setup day looks back 10 days for transfers with only one side showing
  (14.2). You can change it on the Setup day screen.
- Bank rules: which bank items are transfers between your accounts,
  payments to people, and card fees or interest. Each is text the bank's
  description contains, on one account (set after the first sync; the
  setup screen also suggests some from the bank's own labels, for you to
  confirm). They can be changed later in Settings, and each change is
  logged (13.5). A changed bank rule reads what the bank sends from then
  on; what was already read stays as it was, and one item read wrong is
  fixed in review (5.6). If two bank rules fit one item, the first in the
  list wins. A rule can be moved up or down among the rules on its account
  (only those can fit the same item), and each move is logged (13.5).


## 3. Payday

3.1  A deposit that matches the paycheck rule is a paycheck. With "Ask
     before splitting a paycheck" on, it first waits in review: it shows the
     amount and what each bucket would get (3.3, with the split the next
     paycheck uses, 13.1), and nothing moves until you say yes. Yes splits it
     and starts the new pay period on the day it arrived, not the day you
     answer, exactly as "This is my paycheck" does (6.1). "Not a paycheck"
     gives it the other choices of 6.1 (other income, payback, not mine).
     With the setting off, a matching deposit is split by itself and starts
     a new pay period.
3.2  The mom reserve comes off first. If the reserve is already at its cap,
     the part that does not fit goes to savings instead.
3.3  The rest is split by the percentages. Needs and wants are each rounded
     down to the cent, and savings gets the rest, so the parts always add up
     to the paycheck exactly.
3.4  At each payday, unspent needs and unspent wants either roll over into
     the next pay period or move to savings. You choose for each bucket
     separately. Until you answer, the money stays where it is, and you can
     still move it by hand later (13.3). While the question is open,
     spending made before payday that shows up or changes after it (4.1)
     changes the amount asked about by as much, never below zero and never
     above what was asked at payday.
3.5  An overspent bucket carries over as a negative, so the next period
     starts smaller. At payday nothing is asked about it and nothing moves;
     the new share is added on top.
3.6  A third paycheck in a month is handled exactly like any other.
3.7  A paycheck-looking deposit that arrives less than 10 days after the last
     one goes to review instead of splitting automatically.
3.8  On payday the app tells you how much should be sitting in the savings
     account (savings plus mom reserve) and how much you still need to move.
     If the account already holds more than it should, the amount to move
     is $0 and the extra is shown separately.


## 4. Spending

4.1  A purchase on the debit card or on either card comes out of a
     bucket on the day of the purchase.
4.2  The bucket is picked by your rules. No matching rule means "unsorted".
     Spending goes to needs or wants only; to pay for something out of
     savings, move the money by hand (13.3).
4.3  Unsorted spending is held back from safe-to-spend until you sort it.
4.4  A purchase can be split across buckets. The parts must add up to the
     total.
4.5  A refund goes back into the bucket the purchase came from. A full
     refund of a split purchase goes back to each bucket as it was split;
     a partial one sends the purchase back to review to be split again. If
     the app cannot match a refund to a purchase, it goes to review. Review
     lists the purchases it likely belongs to; picking one ("this refund is
     for this one") matches it exactly as if the bank had, and cannot be
     undone in review. A likely purchase is on the same account, made on or
     before the refund, with at least the refund's amount not yet refunded,
     and either has the same name as the refund or exactly the refund's
     amount left. The same name means a word of the name is in both; a word
     on most of your purchases on that account (more than half of those on
     the refund's day and in the 90 days before it), such as a city, is not
     a name. At most five are listed, the best first.
     A store's refund to the debit card shows up as money in to checking,
     so money in to checking also lists its likely purchases on checking,
     and picking one makes it that refund (6.1).
     A purchase or payment still waiting in review that is refunded in full
     has nothing left to sort: it leaves review by itself and is kept as a
     record, sorted nowhere. If the bank later takes the refund back (4.10),
     it comes back to review to be sorted.
4.6  A pending charge counts once. When it posts, the final charge replaces
     the pending one, even if the amount changed (a tip, for example). If
     the bank changes a pending charge's amount before it posts, the new
     amount counts right away, in the same bucket. If the bank drops a
     pending charge without posting it (a hold that falls off), it is
     removed and the money goes back to where it came from.
4.7  Re-sorting a purchase updates the buckets right away.
4.8  Fees and interest on either card go to review. Suggested bucket:
     needs.
4.9  Money leaving savings that is not a transfer to one of your accounts
     (5.3, 5.6) or a payment to a person (7.4), such as a withdrawal or a
     bill paid straight from savings, always waits in review, even when a
     rule matches it. It has the same choices as any spending (4.2 to 4.4).
     To pay for it out of savings, sort it and then move the money by hand
     (13.3).
4.10 If the bank takes back a transaction the app already counted (a charge
     shown twice, a correction), the app takes it back too: whatever it did
     to the buckets, the mom reserve, money in transit, or the old card
     debt is undone, and its money goes back where it came from. The change
     is logged (13.5) and you are told (10.6). If the bank changes the
     amount of a posted transaction, the old one is taken back and the new
     one counts as new. A paycheck taken back keeps the pay period it
     started; only its money comes back out of the buckets. A pending
     charge is dropped, not taken back (4.6).


## 5. Transfers and card payments

5.1  Checking or savings to either card: not spending. The purchases
     were already counted under 4.1.
5.2  Checking to old card: spending. It comes out of needs, on a "debt
     payoff" line. From savings, it waits in review and comes out of the
     savings bucket once you confirm it, or out of needs if you pick that
     instead.
5.3  Checking to savings, or savings to checking: no bucket changes. The app
     only updates how much still needs to be moved (3.8).
5.4  A new purchase on the old card is flagged and sent to review. Like
     interest and fees (5.5), it raises the debt shown and touches a bucket
     only when you pay it (5.2).
5.5  Interest or fees on the old card raise the debt shown. They touch a
     bucket only when you pay them.
5.6  Review also offers "transfer between my accounts" for money out of
     checking or savings, and for money in, that the bank did not show as
     a transfer. It then counts as that transfer's half: no bucket changes
     (5.1, 5.3), it is in transit until its other half shows (12.5), and a
     payment to the old card counts as one (5.2). Sorting it another way
     later makes it what the bank sent again. One you marked as a payment
     to the old card from savings takes savings or needs (5.2), or has its
     own choice, "It was not a payment to the old card": it is then what
     the bank sent again (money leaving savings waits in review, 4.9), and
     the old card owes what it did before.


## 6. Deposits that are not a paycheck

6.1  They always go to review, with four choices:
     - This is my paycheck: starts a new pay period like any paycheck
       (3.1 to 3.5): the mom reserve first, then the split. The new pay
       period starts on the day the deposit arrived, not the day you
       answer (B53).
     - Other income: split by the percentages only. No mom reserve is
       taken and no new pay period starts. The reserve comes only from
       paychecks.
     - Payback: goes into the bucket you pick
     - Not mine: goes to "held for others"
     A paycheck-looking deposit held back under 3.7 gets the same
     choices. A store refund waiting in review is not income: it gets
     payback and not mine, and it can be matched to the purchase it belongs
     to (4.5). Money in to checking keeps the four choices and also offers
     "this refund is for this one", with its likely purchases on checking
     (4.5).
6.2  A rule can make the choice automatic for a known source.


## 7. Other people's money

7.1  A deposit marked "not mine" adds to "held for others". It is not income
     and is not split.
7.2  A payment out marked "not mine" lowers "held for others". It is not
     spending.
7.3  "Held for others" is shown as its own number and should return to zero.
     A negative number means someone owes you.
7.4  Payments to people go to the daily review unless there is a rule for
     that person. This is the same whichever of your accounts they leave.
7.5  A friend paying you back is a payback (6.1).
7.6  In review, a payment to a person can go to needs, wants, not mine, or
     "for mom", or be split across needs, wants, and not mine; the parts
     must add up to the payment. "For mom" takes it out of the mom reserve
     and counts it toward the month, like a payment the mom rule matches
     (8.1 to 8.3). A rule for a person can say "for mom" too. One marked
     for mom this way can be sorted again later; one the mom rule matches
     cannot.


## 8. Mom

8.1  Any payment that matches the mom rule comes out of the mom reserve,
     whatever the day or amount, and whichever account it leaves. So does
     a payment to a person you mark "for mom" (7.6).
8.2  The app shows how much you have sent this calendar month against the
     target.
8.3  If a payment is bigger than the reserve, the app asks which bucket
     covers the difference.
8.4  The reserve carries over between months, up to its cap (3.2).


## 9. Credit card reminders

9.1  Each card: reminders show the statement balance, the minimum, and
     the due date.
9.2  Old card: reminders show the minimum and the due date.
9.3  Each card: reminders continue until the payments the app sees
     since the statement add up to the full statement balance. Paying
     less usually means interest on the rest.
     A payment counts toward the statement it reached the card after; one
     landing on the statement date counts toward the one before (B28). It
     counts from the day it leaves checking or savings, even while still on
     its way (B47).
9.4  If the due date passes and the payments the app sees since the
     statement add up to less than the minimum, you get an overdue alert.
     It stays due every day after the due date until enough is paid (B30).
     This works the same on both cards.
9.5  Old card payoff countdown: what the old card owes (5.4, 5.5), divided
     by the paydays left before the promo ends, from the pay schedule:
     paydays after today and before the end date, not on it. Each share is
     rounded up to the cent. With no paydays left, all of it is due now.
     With nothing owed, $0.
9.6  Home shows a card payment as due every day from the first reminder day
     until the payments the app sees add up to what 9.3 asks for. After the
     due date, it shows overdue as in 9.4. The reminders on your phone still
     come only on the reminder days.
9.7  Card reminders and the overdue alert come at the daily review time
     (section 2), with the daily review (10.3). A reminder that goes out
     later than its day counts the days to the due date from the day it
     is sent ("due in 4 days", not "due in 7 days").
9.8  When the bank does not send a card's statement date, the statement
     date is the last day before the card's due date that falls on the
     closing day set for that card, each card with its own (section 2); in
     a month too short for that day, the month's last day. Until it is
     set, that card has no reminders, no due line on Home, and no overdue
     alert, and Home and Settings say so, naming the card: "Card reminders
     are off for the Amex card: the bank did not send its statement date."
     The same when the bank sends a statement for a card that the app
     cannot read.


## 10. Alerts

10.1  Low bucket: needs or wants falls below the alert level. Once per bucket
      per pay period. The level is 20% of what the bucket started the pay
      period with, including what rolled over. If a bucket starts the pay
      period at zero or below, there is no low alert; the empty alert
      (10.2) covers it. Below means strictly below, to the cent (B57). At
      zero or below only the empty alert comes; back above zero but under
      the level, the low alert comes then, once per pay period (B58).
10.2  Empty bucket: needs or wants reaches zero or below. Once per bucket
      per pay period: refilled and empty again in the same pay period, no
      second alert. Still empty when a new pay period starts, the alert
      comes again (B50).
10.3  Daily review: sent at the review time, only if something is unsorted.
10.4  Totals do not match the bank (section 12): told once the difference
      has lasted 12 hours (a setting), then once a day at the daily review
      time while it lasts. Until then Home and Buckets say the bank is
      still catching up, with the difference.
10.5  Bank connection needs you to log in again. Told the same way as 10.4.
      For each connection, and each alert names the bank.
10.6  The bank took back a transaction the app had counted (4.10). Once,
      when it happens. On Home it stays in Needs attention until you mark it
      seen.
10.7  The bank has not been read for 24 hours (a setting): the sync keeps
      failing, or the app was not running. Told once, when the last good
      read of the bank is that old, and again only after a good read.
      For each connection, and each alert names the bank.
10.8  Quiet hours (section 2): no alert is sent from 10:00 PM to 7:00 AM.
      What comes due then waits until they end, and says when it was due:
      "Was due Sat, Oct 3, 8:00 PM." Every alert that goes out late says
      it that way.
10.9  Alerts that came due while the app was not running (the daily review,
      a reminder day): when it is back, only the newest of each kind, and
      only if it is still true then. One daily review, one reminder per
      card.
      The same when the app was running but the phone could not be given
      its alerts (it could not be reached, or no phone had them on): when
      it can be again, of what waited only the newest of each kind goes,
      and only if it is still true then. Each bucket's low alert and empty
      alert are kinds of their own, and each take-back is its own. The
      rest stay in the list of alerts in the app: "Not sent: a newer one
      went." or "Not sent: no longer true."
10.10 On the phone's lock screen an alert shows amounts only if the setting
      says so (off to start): words only, such as "Needs is low", and the
      amounts are in the app.
10.11 Notifications go to each phone where you turned them on, until you
      turn them off there or log out there. They keep coming after that
      phone's login ends (section 2). Logging in again on that phone moves
      them to the new login by itself, and Settings says they are on.
10.12 A phone shows each alert once. It keeps the ids of the newest 500
      alerts it has shown (ids only, never words or amounts) in its own
      storage, so a repeat is dropped even after the phone has stopped and
      started the app's background part. Nothing else is kept on the phone.
10.13 The bank lets the app read your accounts only until a date it sets
      (Bank of America: a year after you connect, or log in to the bank
      again). When the bank gives that date, Settings shows it, and you are
      told once, 7 days before it (section 2), at the daily review time.
      Logging in to the bank again before then moves the date, and nothing
      is lost. If it runs out anyway, the bank needs you to log in again
      (10.5). For each connection, and each alert names the bank.
10.14 Payday: when a paycheck is counted, you are told how much to move
      to savings (3.8) and, with the payoff countdown on, the old card's
      share this payday (9.5). At once; quiet hours apply (10.8); a tap
      opens Payday; amounts only if the lock-screen setting allows (10.10).
10.15 A paycheck is waiting for your yes: you are told once, when it posts.
      Quiet hours apply (10.8), a tap opens Review, and the amount is shown
      only if the lock screen setting allows it (10.10). The payday alert
      (10.14) comes at your yes, not before.


## 11. Safe to spend

11.1  Safe to spend = wants left, minus unsorted spending.
11.2  It is shown with the number of days until the next payday, from the
      pay schedule. If that day passes with no paycheck, the days go
      negative instead of jumping ahead (B35).
11.3  Savings, mom reserve, held for others, and unsorted money in are never
      part of it.
11.4  Money still pending into checking or savings (a deposit, which the
      app counts only once it posts, 12.1) is shown on Home with its
      amount and account: "Paycheck on its way" when the paycheck rule
      matches it, otherwise "Money on its way in", and "counted when it
      posts". It is not part of safe to spend or any bucket, and nothing
      is asked about it, until it posts. While the bank cannot be read,
      none is shown.
      Each row also says when the app first saw it pending ("Pending
      since Fri 6:12 AM"). Once the app has seen at least 3 earlier ones of
      the same kind (a paycheck, or other money in) go from pending to
      posted on the same account, the row adds "Usually posts within 9
      hours": the time within which at least three in four of the last 10
      of them posted, from when the app first saw each one pending to when
      it first saw it posted, rounded up to the hour, or to the day from 2
      days. It is never a promise. One the app first saw before it kept
      the times of its reads says the day the bank dated it instead.


## 12. Daily self-check

12.1  Bank side: checking + savings - the Capital One card - the Amex
      card. For checking and savings, the balance the bank shows as
      available, with what is still pending that the app counts only once
      it posts put back: money going out added back (a transfer between
      your accounts, a payment to a person, money leaving savings), and
      money coming in taken out (a paycheck or other deposit, a refund, a
      transfer arriving). If the bank gives no available balance, its
      posted balance less pending charges. For each card, what it owes, including pending charges
      (they already count in the buckets under 4.6).
12.2  App side: savings + needs + wants + held for others + unsorted
      money in - unsorted spending.
      Unsorted money in: deposits and refunds waiting in review
      (3.7, 4.5, 6.1).
12.3  The two must be equal. If not, the app shows a warning with the
      difference: the bank side plus money in transit (12.5), minus the app
      side. The check uses each bank's latest good read. When one bank was
      read and the other could not be, the check waits, as when the bank
      is still catching up (10.4).
12.4  The old card balance is tracked separately as debt and is not part of
      this check.
12.5  Money in transit: a transfer that has left one of your accounts but not
      yet arrived in another (a card payment, usually) is shown as "in
      transit". The check is: bank side + in transit = app side. Money on its
      way to the old card is shown but not counted, because the old card is
      not part of this check (12.4). It comes out of needs when it leaves
      checking (5.2), and the debt goes down when it lands. The two halves
      pair by the bank's link, otherwise with the oldest unpaired half
      between the same accounts for the same amount. One seen arriving
      first is a negative in transit until it shows leaving (B45).
12.6  Why it does not match. When the totals do not match the bank (12.3),
      the daily check sheet on Home, and a sheet on Buckets, list why:
      short lines, each with an amount, that add up to the difference
      exactly, to the cent. With every read of the bank the app keeps each
      account's balances as the bank gave them (posted and available), what
      the check counted for it, and whether the check matched. It compares
      the last read that matched with now, account by account: how each
      balance moved, against what the bank's transactions in between
      account for. It names a cause only when it accounts for a move to
      the cent:
      - On each card, pending charges Plaid still lists, when the card's
        balance went up by exactly them: "Posted at the bank, Plaid
        still says pending: counted twice for now." Money in still pending
        there (a refund) that the balance already took: "Posted at the
        bank, Plaid still says pending: counted once Plaid says it posted."
        The same for checking or savings when the bank gives no available
        balance.
      - On checking or savings: a pending item Plaid lists that the
        available balance does not show yet; a pending item whose amount
        Plaid changed while the available balance still has the old one;
        and a deposit or charge that posted while Plaid still lists the
        pending one too.
      What is left of each account's move is one line, such as "Checking's
      available balance went up $27.50 with no transaction from the bank
      yet." Anything the balances do not account for is one more line. With
      no earlier read that matched, one line says so, with the whole
      difference. The lines only explain: they change nothing.


## 13. Changing things on the fly

13.1  A change to the split or the mom reserve applies from the next
      paycheck. Settings shows the split and the mom reserve in force this
      pay period next to what the next paycheck will use. Every other
      setting applies right away.
13.2  A new or changed sorting rule applies to new and unsorted transactions.
      Already-sorted ones stay put unless you re-sort them. Setting the
      paycheck rule or the mom rule does the same with what is waiting: a
      deposit that matches the paycheck rule becomes a paycheck, still with
      the 10-day check (3.7), and a payment that matches the mom rule comes
      out of the mom reserve (8.1). A waiting item the rule matches but
      cannot sort (a partly refunded payment cannot be for mom, for
      example) stays waiting exactly as it was, and you are told which.
      Setting the paycheck rule while "Ask before splitting a paycheck" is
      on marks matching deposits as paychecks waiting for your yes; it
      splits none of them.
      You can move a sorting rule up or down in its list (only rules of
      the same kind compete, so the first of them that matches wins). Each
      move is logged (13.5), and what is waiting in review that a moved rule
      is now the first match for is sorted, as after a changed rule.
13.3  You can move money between buckets by hand at any time.
13.4  Moving money out of savings or the mom reserve asks you to confirm
      first. So does any move that would leave the bucket it comes out of
      below zero, since that is usually a typo.
13.5  Every change and every manual move is logged with the date.
13.6  When you correct something and choose "always do this", the new rule
      goes just ahead of the rule it corrects, so the correction sticks.
      The rule it corrects is the first rule in your list that matches the
      item, as it first showed up (often the pending description) or as it
      posted. If no rule matches it, the new rule goes at the end of your
      list.
13.7  An answer about an item that changed since the screen showed it (a
      sync came in between) is refused, says how the item is now, and
      changes nothing. Changed means its amount, day, description, pending
      or posted, what a payday question asks, where it is sorted now, or
      what "this is my paycheck" would do. What the item is offered is not
      part of it: a choice no longer offered is refused anyway. A hand move
      and the settings are not about one item: a move still asks first when
      it would leave a bucket below zero (13.4), and the paycheck rule and
      the mom rule ask again when what they would do has changed.
      When a screen reads its numbers again (coming back from the
      background, for example) and an item on it is not what it showed
      before, the item says so where it is ("Changed: now $21.50,
      posted") and takes no tap for about a second, so a tap meant for what
      was there before is not sent. An item you answered yourself is not
      marked.
13.8  When you sort a purchase, a payment to a person, or money in by hand
      the same way as an earlier one from the same place that you also
      sorted by hand, the app offers to make it a rule ("always do this",
      13.6). The place is the name in the item's description as it first
      showed up: its longest run of words with no digits in them and none
      on most of your items of that kind on that account in the 90 days
      before (as in 4.5). The same place means the earlier one has that
      name in its description too. The rule's text starts as that name, and
      you can change it before you say yes. "Not now" changes nothing, and
      it is offered again the next time. "Always do this" (13.6) also
      starts from that name instead of the whole description.


## 14. Setup day

14.1  The app reads your current balances.
14.2  You assign the starting money (checking + savings - both cards'
      balances) across savings, needs, wants and held for others. Charges
      still pending that day are part of the starting
      money. If one later posts at a different amount, is refunded, or is
      dropped, only the difference waits in review. Money on its way
      between your accounts that day is part of it too (12.5): setup day
      asks about each transfer with only one side showing from the last 10
      days (section 2), and you say whether it is still on its way. Older
      ones are history.
14.3  The self-check must pass before tracking starts.


## 15. Choices confirmed (Oct 6, 2026)

a.  An overspent bucket carries over as a negative (3.5).
b.  Mom reserve carries over and is capped at $3,000, with overflow going to
    savings (3.2, 8.4).
c.  Old card payments come out of needs (5.2).
d.  Safe to spend counts wants only, not needs (11.1).
e.  Split changes start at the next paycheck, not mid-period (13.1).
f.  Taking money out of savings is allowed but asks you to confirm (13.4).
g.  Deposits and refunds waiting in review count in the self-check but not
    in safe to spend (12.2, 11.3).
h.  A new purchase on the old card raises the debt and touches needs only
    when you pay it (5.4).
i.  The bank side of the self-check includes pending charges (12.1).
j.  Paydays are every 14 days, counted from the last paycheck (section 2,
    9.5, 11.2).


## 16. Still needed from you

- The promo end date on the old card (you are checking). Until it is
  entered, the payoff countdown (9.5) stays off. Everything else works.


## 17. Changes after the Phase 1 review (Oct 6, 2026)

a.  Money in transit between your accounts is part of the self-check, so
    a card payment on its way does not show as a mismatch (12.5).
b.  A rule made from a correction beats the rule it corrects (13.6).
c.  The empty-bucket alert comes once per bucket per pay period, like the
    low-bucket alert (10.2).
d.  A hand move that would take any bucket below zero asks you to confirm
    first (13.4).
e.  Everyday card reminders continue until the full statement balance is
    paid. The old card stays at the minimum (9.3).


## 18. Answers to the Phase 1 questions (Oct 6, 2026)

a.  Money in from review: "this is my paycheck" starts a new pay period,
    with the mom reserve first and then the split. "Other income" is
    split by the percentages only: no mom reserve, no new pay period
    (6.1).
b.  Old card: payments since the statement add up. Reminders and the
    overdue alert stop once they total at least the minimum (9.3, 9.4).
c.  Low bucket alert: 20% of what the bucket started the pay period with,
    including rollover. A bucket that starts at zero or below gets no low
    alert; the empty alert covers it (10.1).
d.  Everyday card: the overdue alert works like the old card's. It stops
    once the payments since the statement total at least the minimum
    (9.4).
e.  Old card payoff countdown: the debt the app tracks, divided by the
    paydays after today and before the promo end date (not on it), each
    share rounded up to the cent. With no paydays left, all of it is due
    now; with nothing owed, $0 (9.5, QUESTIONS.md A7).
f.  A savings account holding more than it should: the amount to move is
    $0, and the extra is shown separately (3.8).
g.  A refund of a split purchase: a full refund goes back to each bucket
    as it was split; a partial one sends the purchase back to review to be
    split again (4.5, QUESTIONS.md A1).
h.  Rounding at payday: needs and wants are each rounded down to the cent,
    and savings gets the rest (3.3).
i.  A bucket at zero or below at payday: nothing is asked and nothing
    moves. It carries over, and the new share is added on top (3.5).
j.  The self-check difference is the bank side (plus money in transit)
    minus the app side (12.3).
k.  A pending charge the bank drops without posting it is removed, and its
    money goes back where it came from (4.6, QUESTIONS.md A2).
l.  Spending goes to needs or wants only (4.2, A3).
m.  A payment to the old card from savings comes out of the savings bucket
    once you confirm it, or out of needs if you pick that (5.2, A4).
n.  Setting the paycheck rule or the mom rule also checks what is waiting
    in review (13.2, A9).
o.  A charge pending on setup day: only a later difference waits in review
    (14.2, A10).


## 19. Readings from QUESTIONS.md part B, now in the rules (Oct 6, 2026)

The second-opinion tests (PR #4) found these places unclear in the
rulebook. QUESTIONS.md part B already had the answers, and the app already
works that way: 6.1 (B53), 9.3 (B28, B47), 9.4 (B30), 10.1 (B57, B58),
10.2 (B50), 11.2 (B35), 12.5 (B45).


## 20. Answers to the Phase 3 questions (Oct 7, 2026)

a.  How the app tells transfers, payments to people, and card fees from
    purchases: bank rules, now a setting (section 2). The setup screen
    will also suggest rules from the bank's own labels, for you to confirm
    (Phase 4). Review also offers "transfer between my accounts" (5.6,
    QUESTIONS.md A12).
b.  A pending charge whose amount changes before it posts: the new amount
    counts right away, in the same bucket (4.6, A13).
c.  A transaction the bank takes back or changes after the app counted it:
    the app follows the bank, logs the change, and tells you (4.10, 10.6,
    A14).
d.  Which purchase a refund belongs to: every refund the bank does not
    match waits in review, as now (4.5). In Phase 4, review lists the
    purchases it likely belongs to (A15).
e.  A payment to a person is handled the same whichever of your accounts
    it leaves; mom's from savings comes out of the mom reserve. Other money
    leaving savings waits in review with the usual choices (4.9, 7.4, 8.1,
    A16).
f.  A purchase from before payday that shows up after it lowers the open
    leftover question, never below zero (3.4, QUESTIONS.md B4).
g.  "For mom" is a review choice for payments to people, and a payment to
    a person can be split across needs, wants, and not mine (7.6,
    QUESTIONS.md B20 and B26).


## 21. Answers to the Phase 4 questions (Oct 7, 2026)

a.  Home shows a card payment as due every day from the first reminder
    day until it is paid, not only on the reminder days (9.6,
    QUESTIONS.md A17).
b.  A transaction the bank took back stays in Needs attention on Home
    until you mark it seen (10.6, QUESTIONS.md B84).
c.  When the bank cannot be read, Home shows the last checked safe to
    spend, greyed, with the day and time it was checked (0.5,
    QUESTIONS.md B82).


## 22. Answers to the Buckets and Review questions (Oct 7, 2026)

a.  A refund waiting in review can be matched to one of the purchases it
    likely belongs to. It then counts exactly as if the bank had matched
    it: back into the bucket the purchase came from, and a split purchase
    as in 4.5. It asks first (4.5, 6.1, QUESTIONS.md A18).
b.  A new rule sorts the waiting items it can and leaves the others
    waiting, saying which, instead of being refused whole (13.2,
    QUESTIONS.md A19).


## 23. Answers after the bucket lists, hand moves, and Payday review (Oct 8, 2026)

a.  A purchase you marked as a payment to the old card (5.6) can be undone
    from its row on Needs' list: sorting it any other way makes it the
    purchase the bank sent, in that bucket. Marking it again with the
    account it already has is not a choice (5.6, QUESTIONS.md A20, B110).
b.  A payday question that spending from before payday made smaller (3.4,
    B4) says why on its card: what the bucket held at payday, less what
    was spent before payday and has shown up since (QUESTIONS.md B109).


## 24. Answers after the Settings screen (Oct 9, 2026)

a.  A payment you marked as going to the old card from savings can be
    unmarked with its own choice, "It was not a payment to the old card",
    in review and from its bucket's list. It becomes what the bank sent
    again, and the old card owes what it did before (5.6, QUESTIONS.md
    A21).
b.  Sorting rules can be moved up or down in their list, and each move is
    logged (13.2, 13.5, A22).
c.  Bank rules come with setup day and can be changed in Settings. Each
    change is logged; a changed bank rule reads what comes from then on,
    and what was already read stays as it was (section 2, A23).
d.  Only the split and the mom reserve wait for the next paycheck.
    Settings shows them for this pay period next to the next paycheck's;
    every other setting applies right away (13.1, A24).


## 25. Answers after Setup day (Oct 9, 2026)

a.  Setup day asks about transfers with only one side showing from the last
    10 days, and 10 is a setting (section 2, 14.2, QUESTIONS.md A25).
b.  A purchase or payment waiting in review that is refunded in full leaves
    review by itself and is kept as a record. If the bank takes the refund
    back, it comes back to review (4.5, QUESTIONS.md A26).


## 26. Answers after bank rules (Oct 9, 2026)

a.  When two bank rules fit one item, the first in the list wins, as with
    sorting rules. A bank rule can be moved up or down among the rules on
    its account, and each move is logged (section 2, 13.5, QUESTIONS.md
    A27).

b.  Today is the date in his home time zone, a setting that starts at
    America/New_York, never the date in the server's own clock zone. Dates
    the bank sends stay exactly as sent (section 2).


## 27. Answers after the real server keeps everything (Oct 10, 2026)

a.  When the history no longer replays to the totals saved with it, the
    server stays stopped. A separate command shows each event whose totals
    would change, before and after, and with your yes takes the new totals
    from that event on, logged in the change log (0.6, 13.5, QUESTIONS.md
    A28).
b.  Money in to checking also offers "this refund is for this one", with
    the likely purchases on checking, the same as a card refund (4.5, 6.1,
    QUESTIONS.md A29).
c.  You stay logged in for 30 days on a device, and that is a setting
    (section 2).
d.  The app syncs with the bank by itself every 60 minutes, and that is a
    setting (section 2).


## 28. Answers after syncing on a timer (Oct 10, 2026)

a.  An old event the money math now refuses: the server stays stopped, and
    npm run replay-check says which event and why. Nothing is dropped or
    replaced (0.6, QUESTIONS.md A30).
b.  An answer about something a sync just changed is refused with how it
    is now, and nothing changes: an item that is not what the screen showed
    (13.7, QUESTIONS.md A31).


## 29. Answers after Phase 4's finish line (Oct 10, 2026)

a.  When a screen reads its numbers again and an item on it has changed,
    the item says so and takes no tap for about a second, so a tap meant
    for what was there before is not sent (13.7, QUESTIONS.md A32).
b.  A refund's likely purchases share a name with it or have exactly its
    amount left, at most five. A word on most of your purchases on that
    account, over the refund's day and the 90 days before it, is not a
    name, so "Same name" is true (4.5, QUESTIONS.md A33).


## 30. Answers after the alerts were worked out and kept (Oct 11, 2026)

a.  Card reminders and the overdue alert come at the daily review time,
    with the daily review (9.7, QUESTIONS.md A34).
b.  Quiet hours, 10:00 PM to 7:00 AM, a setting: what comes due then
    waits until they end, and says when it was due (10.8, A35).
c.  Alerts that came due while the app was not running: when it is back,
    only the newest of each kind, and only if it is still true (10.9,
    A36).
d.  "Totals do not match the bank" and "log in to the bank again" repeat
    once a day at the daily review time while they last (10.4, 10.5,
    A37).
e.  A new alert when the bank has not been read for 24 hours, a setting;
    again only after a good read (10.7, A38).
f.  Amounts on the lock screen are a setting, off to start (10.10, A39).


## 31. Answers on late alerts (Oct 11, 2026)

a.  A card reminder that goes out late counts the days to the due date
    from the day it is sent, and the line saying an alert went out late
    reads "Was due Sat, Oct 3, 8:00 PM.", not "Due" again (9.7, 10.8,
    QUESTIONS.md B185, B186).


## 32. Answers on the phone (Oct 12, 2026)

a.  Alerts the phone could not be given for a while: when it can be again,
    only the newest of each kind goes, if still true; the rest show in the
    list as not sent. This changes "once" for those alerts only (10.9,
    QUESTIONS.md A40).
b.  Notifications keep coming after a phone's login ends. Logging in again
    on that phone moves them to the new login by itself, and its card says
    "On" (10.11, A41).
c.  The phone keeps only the ids of the newest 500 alerts it showed, in the
    service worker's own storage, so a repeat stays dropped after the
    service worker restarts (10.12, A42).


## 33. Answers before Phase 7 (Oct 12, 2026)

a.  When the bank is connected, the app asks it for the last 90 days of
    history (section 2, QUESTIONS.md A44).
b.  When the bank gives the date its permission to read your accounts runs
    out, Settings shows it, and you are told 7 days before (10.13, A45).
c.  Connecting the bank, which account is which, and logging in to the
    bank again (1.1 to 1.3, QUESTIONS.md A46).


## 34. Answers in Phase 7 (Oct 14, 2026)

a.  The pay schedule can be twice a month: the 15th and the last day of
    the month, the Friday before when that day is a Saturday or Sunday.
    Every 14 days stays as the other choice. Days to payday (11.2) and the
    payoff countdown (9.5) follow it (section 2, QUESTIONS.md A48).
b.  The bank side of the daily check uses the balance the bank shows as
    available for checking and savings, with what is pending that the app
    counts only once it posts put back. A difference is told only once it
    has lasted 12 hours; until then the bank is still catching up (12.1,
    10.4, section 2, QUESTIONS.md A47, B230, B231).
c.  When a paycheck is counted, you are told what to move to savings and,
    with the payoff countdown on, the old card's share this payday (10.14,
    QUESTIONS.md A49).
d.  The app also syncs as soon as Plaid says it has something new (a
    webhook); the 60-minute timer stays (section 2, QUESTIONS.md A47).


## 35. Answers on the card statements (Oct 15, 2026)

a.  Bank of America sends each card's due date, statement balance and
    minimum, but not its statement date. The statement date is the due date
    less a number of days set for each card, read once off a statement.
    Until it is set, that card's reminders are off, and Home and Settings
    say so (9.8, section 2, QUESTIONS.md A52).


## 36. Answers on the closing day and a pending paycheck (Oct 16, 2026)

a.  Each card's statement closes on the same day of every month, and the
    number of days from it to the due date changes from month to month. So
    the statement date comes from a closing day set for each card, not a
    number of days (9.8, section 2, QUESTIONS.md A53).
b.  Bank of America puts a paycheck still pending into the available
    balance at once, and the app counts it only once it posts. So the bank
    side takes pending money in out, as it adds pending money out back;
    before, every payday showed the paycheck as a difference until it
    posted (12.1, QUESTIONS.md A54).


## 37. Answers on rule suggestions (Oct 16, 2026)

a.  The second time you sort something from the same place the same way
    by hand, the app offers to make it a rule, with the place's name as
    its text. "Always do this" starts from that name too, not the whole
    bank description, whose dates and card digits would stop the rule
    from matching the next one (13.8, QUESTIONS.md A55).


## 38. Answers on money on its way in (Oct 16, 2026)

a.  Home shows a paycheck or other deposit still pending at the bank, so
    payday morning does not look like nothing happened. It counts only
    once it posts, as before (11.4, QUESTIONS.md A56).


## 39. Answers on the app explaining itself (Oct 16, 2026)

a.  When the totals do not match, the app lists why, in lines with
    amounts that add up to the difference, from the bank's balances kept
    with each read (12.6, QUESTIONS.md A57).
b.  Money on its way in says since when it has been pending, and once
    there are 3 earlier ones like it, how long they usually take to post
    (11.4).
c.  A status page on Settings, with no amounts (0.7).
d.  A plain page instead of a blank screen when the app's server cannot be
    reached (0.8).


## 40. Trends

The Trends tab (between Review and Settings) shows what the books already
hold, over time. It only reads: it never changes a bucket, a rule, a
setting, or the history, which still replays exactly (0.6). Every number on
it is worked out on the server, and nothing on it is sent anywhere.

40.1  Two sources. From setup day on, Trends reads the books: every amount
      is what the books counted, in the pay period they counted it in
      (B97), and adds up to the books' own totals to the cent. Before setup
      day, it reads the bank history the app keeps (the 90 days asked for
      at connection, section 2), read for this tab only by today's bank
      rules and sorting rules, the same way new activity would be read;
      what no rule sorts is "unsorted". That history never goes into the
      books, and everything from it is marked "Before setup day: read by
      today's rules". A rule changed later changes how the history reads,
      never the books.
40.2  What counts as spending. Spending in needs and wants as the books
      count it (4.1 to 4.10, 5.2, 7.6, 8.3), less what was refunded, and
      spending still waiting in review, shown as "unsorted" in the current
      pay period until it is sorted. A payment to the old card is its own
      part of needs, "Old card payment". Payments to mom from the reserve
      (8.1), money held for others (7.1, 7.2), transfers between your
      accounts (5.1, 5.3), and money in are not spending. Before setup day
      the same: a transfer a bank rule names, a payment the mom rule
      matches, and money in to checking or savings are left out; money back
      on a card counts against the bucket its rule sorts it to; a charge
      still pending on setup day counts once, at the amount setup day
      counted (14.2), and any later difference is in the books. In this
      setup there is no old card ("Off in this setup"), and nothing ever
      shows "Old card payment".
40.3  Pay periods. From setup day on, the books' pay periods (3.1, B53).
      Before setup day, a pay period begins at the last paycheck you gave on
      setup day, and before that at each payday the pay schedule gives
      (section 2), going back from it. The pay period setup day fell in is
      one pay period: its part before setup day from the history, the rest
      from the books. The oldest, cut off by the 90 days, is marked "Part of
      a pay period". A pay period is full once it has ended, unless it was
      cut off.
40.4  Past: spending per pay period. A bar for each pay period in the last
      90 days and the current one, with needs, wants, old card payments,
      and unsorted, each with its amount. Tapping a bar lists the items
      behind it, which add up to it to the cent. In this setup a bar never
      shows "Old card payment" ("Off in this setup").
40.5  Past: savings over time. What the savings bucket held when tracking
      started, at the end of each pay period since, and now, as the books
      hold it, with the mom reserve beside it the same way, each its own
      amount (they are not added together). Nothing before setup day: the buckets did
      not exist then.
40.6  Past: where it went. The last 90 days of spending (40.2), grouped by
      place: the name in each item's description, found as in 13.8; the
      same name on any account is one place. Old
      card payments are one group, "Old card payment"; an item with no name
      goes in "Everything else". The five biggest places, each with its
      amount, then "Everything else". Together they add up to the 90 days'
      spending to the cent. Tapping a place lists its items.
40.7  Now: this pay period against your usual. What was spent so far this
      pay period (40.2, without old card payments, which are planned, 9.5),
      against your usual by the same day of a pay period, counting payday as
      day 1: the middle one of what each of the last 5 full pay periods had
      spent by that day (with 4, the average of the middle two, rounded down
      to the cent), and the middle one of their whole totals. With fewer
      than 3 full pay periods: "Not enough pay periods yet to know your
      usual."
40.8  Now: Wants left against an even pace. A line of what Wants held at the
      end of each day of this pay period, by the day each thing happened
      (anything dated before the pay period counts on its first day),
      ending at what Wants holds now, to the cent. Beside it, the even pace:
      a straight line from what Wants started the pay period with (10.1)
      down to $0.00 at the end of the day before the next payday (11.2). At
      the end of day n of a pay period of D days (payday is day 1, the day
      before the next payday is day D), the even pace leaves what Wants
      started with times (D - n) / D, rounded down to the cent. Today says,
      in words with the amount, not only color: "$42.10 less left than an
      even pace", "$42.10 more left than an even pace", or "On an even
      pace" when they are equal. Spending waiting in review is not in Wants
      until it is sorted, so the line is not safe to spend (11.1). If Wants
      started at zero or below, there is no even pace, and it says why. If
      the next payday passes with no paycheck, the even pace stays at $0.00.
40.9  When the totals do not match the bank (12.3), Trends shows the same
      banner as Home and Buckets; its numbers still come from the books.
40.10 Future and Habits. Trends has four parts: Past and Now (40.4 to
      40.8), Future (40.11 to 40.13) and Habits (40.14 to 40.17).
      Anything about the future is worked out from what the books
      hold, is marked "Estimate", and is never a promise. Habits read
      the last 90 days (40.6), the books and the history from before
      setup day both, and leave out old card payments, which are
      planned (9.5), unless a rule says otherwise.
40.11 Future: where Needs and Wants land by payday. For each, what it
      holds now less what it would spend at this pay period's pace:
      what was spent from it so far this pay period (40.2, old card
      payments left out), divided by the days so far (payday is day 1,
      today counted; in the books' first pay period, from setup day),
      times the days left after today up to the day before the next
      payday (11.2), rounded up to the cent, so the estimate leans
      low. "Estimate: Wants lands at about $84.20 by payday."
      Spending waiting in review is in neither until it is sorted, and
      is said beside them: "Not counting $35.00 waiting in review."
      Before day 3: "Too early in the pay period to tell." Once the
      next payday has passed with no paycheck, no estimate.
40.12 Future: savings a year out. A range, "Estimate: $X to $Y": what
      the savings bucket holds now, plus, for each payday in the next
      365 days (the pay schedule, section 2), what it gained in a pay
      period: the least of them for the low end and the most for the
      high end, from the last 5 pay periods the books ended that began
      on or after setup day. What it gained is what it held at the end
      of that pay period less what it held at the end of the one
      before, or when tracking started (40.5): moves out of savings
      count, so a gain can be negative. With fewer than 3 such pay
      periods: "Not enough pay periods yet to estimate." The mom
      reserve is not part of it.
40.13 Future: the old card. What it owes (12.4) when tracking started,
      at the end of each pay period since, and now, as the books hold
      it. With the payoff countdown on (9.5), its plan: at each payday
      left before the promo end date, what it would owe once that
      payday's share is paid, down to $0.00 at the last one.
      "Estimate, if each payday's share is paid: paid off by Mar 31,
      2027, at $412.50 a payday." With no promo end date, only what it
      owed, and "The plan starts once the promo end date is entered."
      With nothing owed: "The old card is paid off."
40.14 Habits: the payday effect. Over the full pay periods in the last
      90 days (40.3), what was spent per day on payday and the 2 days
      after (days 1 to 3), against per day on the rest of the pay
      period: each the total spent on those days, by the day each item
      is dated, divided by how many such days there were, rounded down
      to the cent. "Payday and the 2 days after: $48.20 a day. The
      rest of the pay period: $31.75 a day." With fewer than 3 full pay
      periods: "Not enough pay periods yet." Tapping either lists its
      items.
40.15 Habits: day of the week. For each day of the week, what was spent
      on it in the last 90 days, by the day each item is dated: the
      total, and an average one (the total divided by how many of that
      weekday the 90 days hold, rounded down to the cent). The weekday
      with the most on average is named in words: "Most on Saturdays:
      $52.10 on an average Saturday." The seven totals add up to the
      90 days' spending without old card payments, to the cent.
      Tapping a day lists its items.
40.16 Habits: repeat charges. Charges from one place (40.6) that come
      again and again, found in everything Trends reads (the history
      from before setup day and the books, not only 90 days): at least
      3 charges (spending, 40.2; not money back), every gap from one
      to the next within the same one of 6 to 8 days (every week), 13
      to 15 days (every 2 weeks) or 27 to 33 days (every month), and
      each amount within 10% of the newest one's. Listed while it is
      still going: today is no later than the newest charge plus the
      longest gap of its kind (8, 15 or 33 days). Each shows how
      often, the newest amount and day, the next one ("Estimate:
      around Nov 3", the newest day plus the gap before it) and a year
      of it ("Estimate: about $155.88 a year", the newest amount times
      52, 26 or 12). The biggest year first. Tapping one lists its
      charges. It only points them out: nothing is changed or
      cancelled.
40.17 Habits: the Wants streak. Of the pay periods the books have
      ended (Wants did not exist before setup day), how many in a row,
      newest back, ended with Wants at $0.00 or more (not overspent,
      3.5), and the longest such run. "Wants not overspent: 3 pay
      periods in a row. Best: 4." When the newest ended below zero:
      "Wants went over last pay period. A new run starts with this
      one." With none ended: "No pay period has ended in the books
      yet." The current pay period counts once it ends.


## 41. Answers on Trends (Oct 18, 2026)

a.  The Trends tab, Past and Now, as section 40: it only reads the books
    and the bank history the app already keeps; the 90 days before setup
    day are read by today's rules and marked so; "where it went" groups by
    place (13.8); old card payments are their own part of needs and are
    left out of "against your usual"; the usual is the middle one of the
    last 5 full pay periods; the Wants line is by the day each thing
    happened (QUESTIONS.md A58).


## 42. Answers on Trends: Future and Habits (Oct 19, 2026)

a.  Future and Habits on the Trends tab, as 40.10 to 40.17: Needs and Wants
    land by payday at this pay period's own pace, from day 3; savings a
    year out is a range from the least and most a recent pay period added;
    the old card's plan is 9.5's, drawn to $0.00; habits leave out old
    card payments; repeat charges need 3 charges, a steady gap and amounts
    within 10%, and only the ones still going are listed; the Wants streak
    counts pay periods that ended with Wants not overspent; the fixed
    numbers are not settings (QUESTIONS.md A59).


## 51. A paycheck waiting for your yes

51.1  A paycheck waiting for your yes is money in waiting in review: it
      counts in the self-check (12.2) and not in safe to spend (11.3).
      Home says "Paycheck waiting for your yes" with its amount and a way
      to Review. If the split it would get changes while it waits (a split
      change, 13.1), Review shows the new parts. A yes about parts that are
      no longer what it would get is refused, and nothing changes (13.7).
51.2  Two paychecks waiting: the older one is answered first. A yes to the
      newer one is refused while the older one waits, and says so. (60c)
51.3  The early paycheck check (3.7) still applies: a paycheck less than
      10 days after the last one says so on its card.


## 60. Answers on her setup (Oct 23, 2026)

a.  A Wishlist item bought for less or more than its price is marked
    bought, and the bucket goes down by what it really cost; nothing more
    is asked. A refunded item stays bought, and you can add it again (50.3,
    section H, docs/her-questions.txt HA1).
b.  The owner's phone is an iPhone: notifications come through the app
    added to the home screen, as upstream's (HA2).
c.  Two paychecks waiting for your yes: the older one is answered first
    (51.2, section H, HA4).
d.  Her starting values: the pay schedule every 14 days, counted from the
    last paycheck, and the home time zone America/New_York (section 2,
    HA3). Both are upstream's starting values too.
e.  The app runs on Fly.io in ewr (Secaucus, New Jersey), as upstream's
    (HA5).


## H. Approved for her setup, not built yet

His OK, Oct 23, 2026 (docs/her-plan.txt, with his answers to its Q1, Q3
and Q8). None of this is in force yet. Each part names the pull request
that moves it into its place above, with its tests; until then the rule it
replaces stands. The texts are indented here only so they are not yet
counted as rules (test/every-rule-has-a-test.test.ts); in place they are
written like every other rule. A sentence marked "(waits on HAn)" is the
recommended reading of an open question in docs/her-questions.txt, and may
change with the answer.

### PR 3. No mom reserve, no old card

  In place: "Off in this setup" after section 1, section 2, 12.2, 40.2 and
  40.4.

### PR 4. Ask before splitting a paycheck

  In place: section 2, 3.1, 10.15, 13.2 and section 51.

### PR 5. The second card

  In place: section 1, 1.2, 4.1, 4.8, 5.1, 9.1, 9.3, 9.8, 12.1, 12.6 and
  14.2.

### PR 6. Two bank connections

  In place: 0.5, 0.7, 1.1, 1.3, section 2's sync line, 10.5, 10.7, 10.13
  and 12.3.

### PR 7. Both cards on Home, set aside, reminders per card

  52.1  Home shows each card: its statement balance and due date, what the
        payments since the statement have paid toward it (9.3), what it
        owes now in all (the statement plus purchases since), and how much
        of that is set aside (52.2). From the first reminder day it says
        due, and after the due date, overdue, in words, not only color
        (9.6). With the card's reminders off (9.8), it says so instead.
        Tapping a card opens its statement (52.4).
  52.2  Set aside. Every purchase on a card already came out of its bucket
        on the day you made it (4.1), so the money to pay the card is not
        in any bucket: it stays in your bank accounts until you pay. So
        what is set aside for a card is all of what it owes now as the app
        counts it (its balance on setup day, plus purchases, fees and
        interest since, less refunds and the payments that reached it),
        pending charges included. When the totals match the bank (12.3),
        that is exactly what the bank says the card owes. Purchases still
        waiting to be sorted count too: they are held back from safe to
        spend until you sort them (4.3). If the savings account holds more
        than the buckets that live there (3.8, "extra"), Home says how much
        of the set-aside money is in savings rather than checking.
  52.3  Reminder days, for each card: 7 days and 2 days before the due date
        (section 2). Each card's reminders, due line and overdue alert are
        its own.

  In plain words, for the card's sheet in the app (made-up numbers):

    Why paying your card isn't spending. When you buy $30 of groceries on
    a card, the app takes the $30 out of Needs that same day. Your checking
    account still has the $30, because you haven't paid the card yet. So
    the $30 isn't in any bucket any more, but it's still in your account,
    waiting for the card bill. That's what "set aside" means. When you pay
    the card $30 from checking, checking goes down $30 and the card goes
    down $30, and no bucket changes, because the $30 was already counted
    on the day you bought the groceries. You don't have to work out the
    bill or save for it separately. If every purchase is sorted, the money
    for each card is already there.

### PR 8. The statement, per card

  52.4  Statement. For each card, its last statement: from the day after
        the statement before closed to its own closing day (9.8). It lists
        what is on it in lines that add up to the statement balance
        exactly, to the cent:
        - what was carried in from the statement before, less the payments
          and credits that reached the card in this statement's days;
        - each purchase, fee and interest charge, less refunds, by the
          bucket it is sorted to now (needs, wants, Wishlist, or still
          unsorted), and again by the pay period (paycheck) it was counted
          in, each with its total;
        - purchases from before setup day, read by today's rules and marked
          "Before setup day", as Trends reads them (40.1);
        - anything the app's lines do not account for is one more line,
          "Not matched to a purchase", with its amount. It is never hidden,
          and the lines still add up exactly.
        The carried-in line needs the statement before. For the first
        statement the app sees, it is "From before the app saw this card"
        instead. Tapping a bucket or a paycheck lists its purchases. It
        only reads: it never changes a bucket, a rule or the history.
  52.5  Each statement the bank sends is kept, so the statement before is
        known from the second one on.

### PR 9. The Wishlist bucket

  Section 2, the split: savings, needs, wants, Wishlist (whole percents
  that add up to 100; you pick on setup day).

  3.3   The paycheck is split by the percentages. Needs, wants and Wishlist
        are each rounded down to the cent, and savings gets the rest, so
        the parts always add up to the paycheck exactly. (No reserve comes
        off first in this setup.)
  3.4, a sentence added: Wishlist is never asked about: it always rolls
  over. (3.5 applies to Wishlist too.)
  3.8   On payday the app tells you how much should be sitting in the
        savings account (savings plus Wishlist) and how much you still need
        to move. If the account already holds more than it should, the
        amount to move is $0 and the extra is shown separately.
  4.2, the second sentence: Spending goes to needs, wants or Wishlist.
  4.4, a sentence added: A purchase can be split across needs, wants and
  Wishlist.
  11.3  Savings, Wishlist, held for others, and unsorted money in are never
        part of it. (11.1 is unchanged: safe to spend is wants only.
        Wishlist money is kept for the things on your list; counting it in
        safe to spend would let it go on everyday wants, and the list would
        never fill.)
  12.2  App side: savings + needs + wants + Wishlist + held for others
        + unsorted money in - unsorted spending.
  14.2  You assign the starting money (checking + savings - both cards'
        balances) across savings, needs, wants, Wishlist and held for
        others. (The rest of 14.2 as now.)
  13.1, a sentence added: a change to Wishlist's share waits for the next
  paycheck, like the rest of the split.
  13.4  Moving money out of savings or Wishlist asks you to confirm first.
        So does any move that would leave the bucket it comes out of below
        zero, since that is usually a typo.
  10.1 and 10.2 are unchanged: the low and empty alerts are for needs and
  wants only.
  40.2 and 40.4: Wishlist spending is its own part of each pay period's
  bar. 40.5: Wishlist over time beside savings, its own amount. 40.11: no
  estimate for Wishlist.

  50.4  Moving Wishlist money for a purchase. Wishlist money is kept in the
        savings account (3.8), and purchases are paid from checking or a
        card. So when a purchase is sorted to Wishlist, the app tells you
        to move that amount from savings to checking. Home says "Move $X
        from savings to checking" with when: "before the Amex card is due,
        Nov 3" for a purchase on a card whose statement has its due date,
        "before the Amex card's next due date" while the statement it is on
        has not closed yet, and "now" for a debit card purchase, which has
        already left checking. With purchases on both cards, it names the
        earliest due date. $X is the smaller of two amounts. One is the
        extra in savings (3.8), so money still to move into savings is
        netted in and one move covers both. The other is everything sorted
        to Wishlist since tracking started, less Wishlist refunds and less
        every move from savings to checking since tracking started. The
        card's reminders (9.1, 9.7) say it too while it is not moved. It
        goes away once $X is $0.00. A move from savings to checking is not
        spending (5.3).

### PR 10. Wishlist items

  50.1  Wishlist items: up to 20, each a name and a price, in the order you
        choose. Adding, changing, removing and moving one is logged (13.5).
        The names stay in the app's database on the server, like your
        sorting rules.
  50.2  The Wishlist bucket fills the items in order. Going down the list,
        each item gets the smaller of its price and what is left of the
        bucket after the items above it. An item that has its whole price
        says "Ready". With the bucket at zero or below, none has anything.
        What is more than all the prices together is shown as "More than
        the list needs". Each item shows what it has, its price, and how
        far along it is, in words and amount, not only a bar. The items
        only read the bucket: they never move money.
  50.3  When you sort a purchase to Wishlist, review also asks which item
        it was, or "None of them". The item you pick is marked bought, with
        the day and what was paid, and leaves the list. The bucket goes
        down by what the purchase cost, not the item's price. A purchase
        marked bought can be changed back from its row on Wishlist's list.
        A refund goes back to the Wishlist bucket (4.5). The item does not
        come back by itself; you can add it again. (60a)

### Unchanged for her setup

  The pay schedule (section 2), sorting rules (4.2, 6.2, 13.2, 13.6, 13.8)
  and bank rules (section 2) stay exactly as they are. Bank rules are per
  account, so they cover both banks without a change.
