# Open questions from Phase 1

Two kinds of questions are listed here.

Part A: the rulebook does not say. Either the case is not built yet, or,
where money has to land somewhere to keep the totals right, it goes to
review so you decide each time. Each one has options and a recommendation.

Part B: the plain reading of the rule was built, but a reasonable person
could have meant something else. Each one says what the app does now.
Nothing to do unless one of them is wrong.


## Part A. Waiting on your answer

A1. ANSWERED Oct 6, built. A refund on a split purchase, or a split
    purchase that posts at a different amount (4.4 with 4.5 and 4.6).
    Your answer: a full refund goes back to each bucket as it was split,
    and nothing waits in review. A partial refund sends the purchase back
    to review with its new total, to be split again, as before. A split
    purchase that posts at a different amount also goes back to review, as
    before. Rulebook 4.5 and 18g updated.

A2. ANSWERED Oct 6, built. A pending charge that disappears without
    posting (4.6). Your answer, the recommendation: the charge is removed
    and its money goes back to where it came from. The bank connection
    reports it as a dropped charge. Rulebook 4.6 and 18k. Worked example 18.

A3. ANSWERED Oct 6. Spending to savings or the mom reserve (4.2, 4.4).
    Your answer, the recommendation: needs or wants only, as built. To
    pay for something out of savings, move the money by hand (13.3).
    Rulebook 4.2 and 18l.

A4. ANSWERED Oct 6, built. A payment to the old card from savings (5.2).
    Your answer: it comes out of the savings bucket once you confirm it,
    and when it asks you can pick needs instead. It waits in review with
    savings suggested. Rulebook 5.2 and 18m.

A5. ANSWERED Oct 6, built. Does "income" from review start a new pay
    period? (6.1 with 3.1, 3.7)
    Your answer: two choices instead of "income". "This is my paycheck"
    starts a new pay period: mom reserve first, then the split. "Other
    income" is split by the percentages only: no mom reserve taken, no
    new pay period. Rulebook 6.1 and 18a updated. Worked examples 7 and
    15. The readings I had to pick while building it are B52 to B55.

A6. ANSWERED Oct 6, built. Paying a card in more than one payment (9.3),
    and payments below the minimum (9.4).
    Your answers: on the old card, payments since the statement add up,
    and reminders and the overdue alert stop once they total at least the
    minimum (18b). The everyday card's overdue alert now works the same
    way (option 2, 18d). Its reminders still continue until the full
    statement balance is paid (9.3). Rulebook 9.3, 9.4, 18b and 18d
    updated.

A7. ANSWERED Oct 6, built. Old card payoff countdown (9.5).
    Your answer, the recommendation: a. the paydays left are the ones
    after today and before the promo end date, not on it; b. each share is
    rounded up to the cent, so the last payment comes out a little
    smaller; c. with no paydays left, the whole amount is due now; d. it
    divides the old card debt the app tracks (5.4, 5.5). Also: with nothing
    owed, $0 per payday. It stays off until you enter the promo end date
    (section 16). Rulebook 9.5 and 18e updated. Worked example 17. The
    reading I had to pick while building it is B59.

A8. ANSWERED Oct 6, built. Low bucket alert (10.1).
    Your answer: 20% of what the bucket started the pay period with,
    including rollover. If a bucket starts at zero or below, skip the low
    alert; the empty alert covers it. Rulebook 10.1, section 2 and 18c
    updated. Worked example 16. The readings I had to pick while building
    it are B56 to B58.

A9. ANSWERED Oct 6, built. Setting the paycheck rule or the mom rule
    after the first sync. Your answer, the recommendation: what is waiting
    in review is checked again, like 13.2. A waiting deposit that matches
    the paycheck rule becomes a paycheck, oldest first, still with the
    10-day check (3.7); one older than the last paycheck stays waiting as
    an early paycheck (B54). A waiting payment that matches the mom rule
    comes out of the mom reserve (8.1, 8.3). Rulebook 13.2 and 18n.

A10. ANSWERED Oct 6. Charges still pending on setup day (14.2 with 4.6).
     Your answer, the recommendation: as built. If one later posts at a
     different amount, is refunded, or is dropped, only the difference
     waits in review. Rulebook 14.2 and 18o. Worked example 13.


## Part A, added with Phase 3, the bank connection (Oct 7). All answered.

A11. ANSWERED Oct 7. Phase 3's finish line and the test bank.
     Your answer: option 1, the recommendation. Also added, at your
     question: the simulated you (Phase 2) through the bank connection, in
     Plaid's format, with the self-check passing every day
     (packages/server/test/simulated-life.test.ts).
     The finish line says the self-check passes against the test bank's
     balances once test-bank activity flows in. Plaid's test bank never
     moves an account's balance when transactions are added; Plaid's own
     docs say its test transactions "may show income and outflow
     inconsistent with the balance shown on the account". So:
     - On setup day the self-check passes against the test bank's real
       balances, pending charges included (checked live).
     - After new test-bank activity, the app's totals move by exactly what
       the activity says ($2,230.49 in the live run), and the self-check
       shows that same amount as the gap, because the test bank's balances
       stayed put. The app is right to say so (0.5).
     - With a made-up bank that does move its balances like a real one, the
       self-check passes after every sync: 400 random scenarios, a saved
       week worked through by hand, and the scenario tests.
     Option 1: accept these as Phase 3's finish line. The check with
     balances that really move comes in Phase 7, on your real accounts.
     Option 2: something else you have in mind.
     Recommendation: option 1.

A12. ANSWERED Oct 7, built. How the app tells your transfers, payments to
     people, and card fees from purchases.
     Your answer: option 2 on top of option 1. Bank rules (text the
     description contains, on one account) join the settings in rulebook
     section 2, and the setup screen in Phase 4 will also suggest rules from
     Plaid's own labels, for you to confirm. Also, at your request, review
     offers "transfer between my accounts" for anything the rules miss.
     Rulebook section 2, 5.6 and 20a. Worked example 22. The readings I had
     to pick while building it are B74 and B79.

A13. ANSWERED Oct 7, built. A pending charge whose amount changes while it
     is still pending.
     Your answer: option 2. The new amount counts right away, in the same
     bucket. Rulebook 4.6 and 20b. Worked example 19, and example 3 for the
     bank.

A14. ANSWERED Oct 7, built. The bank removing or changing a transaction the
     app already counted.
     Your answer: option 2, with a change log entry, and you are told when
     it happens. The app takes it back, and its money goes back where it
     came from. Rulebook 4.10, 10.6 and 20c. Worked example 21, and example
     3 for the bank. The readings I had to pick while building it are B71,
     B72, B75 to B77.

A15. ANSWERED Oct 7. Which purchase a refund belongs to (4.5).
     Your answer: option 1, always ask. In Phase 4, review lists the
     purchases a refund likely belongs to (added to the roadmap). Rulebook
     20d.

A16. ANSWERED Oct 7, built. Money leaving savings that is not a transfer to
     one of your accounts.
     Your answer: change it. A payment to a person is handled the same
     whichever of your accounts it leaves: a payment to mom from savings
     comes out of the mom reserve like any mom payment. Other money leaving
     savings goes to review with the normal choices. Rulebook 4.9, 7.4,
     8.1 and 20e. Worked example 20. The reading I had to pick while
     building it is B78.

## Part A, added with the Home screen (Phase 4, Oct 7). Waiting on your answer.

A17. ANSWERED Oct 7, built. When Home shows a card payment that is due.
     Your answer: option 2. Home shows it every day from the first
     reminder day until it is paid; the phone reminders still come only on
     the reminder days. Rulebook 9.6 and 21a.
     The question was: Home showed exactly what the reminders say. "Everyday card
     due in 7 days" shows on the reminder days only (7 and 2 days before
     the due date), and "Overdue" every day after the due date until the
     minimum is paid. On the days in between, Home says nothing about the
     card.
     Option 1: keep it as built.
     Option 2: from the first reminder day until it is paid, Home shows
     "due in N days" every day. The phone reminders (Phase 5) still come
     only on the reminder days.
     Recommendation: option 2. Home is where you look for what needs you,
     and a bill due in 5 days still does.


## Part A, added with the Buckets and Review screens (Phase 4, Oct 7).

A18. ANSWERED Oct 7, built. A refund in review, and the purchase it
     belongs to. Your answer: option 2. Each likely purchase has "This
     refund is for this one"; the refund is then matched exactly as if the
     bank had matched it. It asks first, since it cannot be undone in
     review. Rulebook 4.5, 6.1 and 22a.
     The question was: Review lists the purchases a refund likely belongs to (20d), but
     rulebook 6.1 gives a refund only two choices: payback into a bucket,
     or not mine. So today, tapping "Into Wants" puts the money in Wants and
     leaves the purchase as it was: the purchase does not count as
     refunded. For a purchase in one bucket the buckets come out the same
     as if the bank had matched them. They differ later: if you re-sort the
     purchase to Needs, the purchase's money moves to Needs but the refund
     stays in Wants. And a split purchase is not sent back to review to be
     split again, as 4.5 does for a matched partial refund.
     Option 1: keep it as built. The list only helps you choose a bucket.
     Option 2: each likely purchase gets a button, "This refund is for this
     one". The refund is then matched exactly as if the bank had said so
     (4.5): back into the bucket the purchase came from, split purchases
     handled as in A1. Needs new wording in 4.5 and 6.1.
     Recommendation: option 2. A refund that follows its purchase cannot end
     up in the wrong bucket later.

A19. ANSWERED Oct 7, built. A new rule that cannot sort everything it
     matches. Your answer: option 2. The rule is made, the waiting items
     that can take it are sorted, and the others stay waiting, exactly as
     they were; the answer names them. Rulebook 13.2 and 22b.
     The question was: Making "always do this" also sorts every waiting item the new rule is
     the first match for (13.2). If one of those cannot take the choice,
     the whole rule is refused, nothing changes, and the screen says so.
     Example: "always for mom" for ZELLE TO A FRIEND, while another waiting
     payment to the same friend was partly refunded: a partly refunded
     payment cannot be for mom (B73), so no rule is made.
     Option 1: keep it. Safe, but confusing: you may not see why.
     Option 2: make the rule, sort the waiting items that can take it, and
     leave the others waiting, saying which.
     Recommendation: option 2. The rule is what you asked for; the one it
     cannot sort is still yours to decide.


## Part A, added with the bucket lists, hand moves, and Payday (Phase 4, Oct 7).

A20. ANSWERED Oct 8, built. Undoing "transfer between my accounts" from a
     list (5.6). Your answer: option 2. On that row, the sheet offers what
     the purchase could be before you marked it (Needs, Wants, a split, a
     transfer with another account); picking one brings it back as the
     purchase the bank sent, and picking Needs is no longer refused.
     Rulebook 5.6 and 23a; the details are B110.
     The question was: a purchase
     you marked as a payment to the old card comes out of Needs (5.2), so
     it shows on Needs' list as "Payment to the old card", and its sheet
     says it always comes out of Needs. Rule 5.6 also says sorting it
     another way later makes it what the bank sent again, and the money
     math can do that, but the list does not offer it. Nowhere else does
     either: it is no longer waiting in review. (A transfer that changes no
     bucket is on no list at all, so this is the only case you can reach.)
     Option 1: leave it as built. If you mark one by mistake, tell me and
     I undo it.
     Option 2: on that row, offer what the purchase could be before you
     marked it (needs, wants, split, and so on), which brings it back as
     the purchase the bank sent. One catch in the money math to fix with
     it: today picking Needs on such a payment is refused, because it is
     read as "keep it a payment to the old card".
     Recommendation: option 2. Marking is easy to get wrong, and this is
     the only way back.


## Part A, added with his answers to A20 and the Payday card (Phase 4, Oct 8). All answered.

A21. ANSWERED Oct 9, built. Your answer: option 2. A payment you marked
     as going to the old card from savings has its own choice, "It was not
     a payment to the old card", in review and on its bucket's list. It
     becomes what the bank sent again, and the old card owes what it did
     before. Rulebook 5.6 and 24a; the details are B123.
     The question was: undoing a payment you marked as going to the old card FROM SAVINGS
     (5.2, 5.6, A4). A20 is built for checking. From savings the same
     marking waits in review for you to pick Savings or Needs (A4), and
     after that it is on that bucket's list with the same two choices.
     There "Needs" already means something: keep it a payment to the old
     card, taken out of Needs. For the purchase it was (money leaving
     savings, 4.9) "Needs" would mean a different thing, with no change to
     what the old card owes. One tap cannot mean both, so I did not offer
     the purchase's choices there. Today there is no way back from the
     list or from review; you would tell me.
     Option 1: leave as built.
     Option 2: a separate choice on that row and in review, "It was not a
     payment to the old card". It brings the item back as what the bank
     sent, money leaving savings, which waits in review with the usual
     choices (4.9), and the old card owes what it did before.
     Recommendation: option 2. Same reason as A20: marking is easy to get
     wrong. It is its own button, so nothing changes meaning.


## Part A, added with Settings (Phase 4, Oct 9). All answered.

A22. ANSWERED Oct 9, built. Your answer: option 2. Each rule's sheet on
     Settings has Move up and Move down; each move is logged. Rulebook 13.2
     and 24b; the details are B122.
     The question was: the order of the sorting rules (4.2, B9). The first rule that matches
     wins, so the order matters, but nothing lets you change it. Today a new
     rule goes to the end of its list (B39), a changed rule keeps its place,
     and "always do this" puts its rule just ahead of the rule it corrects
     (13.6). Settings numbers each list (purchases, money in, payments to
     people; only rules of the same kind compete) and says "the first rule
     that matches wins".
     Option 1: no reordering. To move a rule to the end, remove it and add it
     again.
     Option 2: "Move up" and "Move down" on each rule's sheet. Each move is in
     the change log (13.5). After a move, what is waiting in Review that the
     rule is now the first match for is sorted, as after a changed rule
     (13.2); what is already sorted stays where it is.
     Option 3: drag the rules into order. Harder to use with a large text
     size, and harder to make work with VoiceOver.
     Option 4: no order at all: the rule with the longest matching text wins
     ("MAIN ST RESTAURANT" beats "RESTAURANT"). Changes 4.2 and B9.
     Recommendation: option 2. Built: option 1, as the rulebook has it, until
     you answer.

A23. ANSWERED Oct 9. Your answer: option 1. Nothing to build now: they
     come with Setup day. Rulebook section 2 and 24c.
     The question was: bank rules on Settings (section 2, A12). They tell the bank connection
     which bank items are transfers between your accounts, payments to
     people, and card fees or interest. They live in the server's database,
     not in the book (the money math), and the demo has no database, so
     Settings does not show them yet. Three things to settle:
     a. Where: on Settings now, or with Setup day (the next chunk), where they
        are first set and suggested from the bank's own labels?
     b. Does a change to a bank rule go in the change log (13.5)?
     c. What does a changed bank rule do to items the bank connection has
        already read?
     Option 1: build them with Setup day; Settings then shows the same list
     and can change it. (b) Yes: every change is in the change log, like the
     others. (c) A changed bank rule reads what the bank sends from then on;
     what was already read stays as it is (like 13.2, and 0.3), and one item
     read wrong is fixed in Review with "transfer between my accounts" (5.6).
     Option 2: as option 1, but (c) a changed bank rule also reads again what
     is still waiting in Review.
     Option 3: put them on Settings now, in the demo only, made up and kept
     in memory, before Setup day exists.
     Recommendation: option 1. Reading items again (option 2) means the bank
     connection redoing what it already decided, on items already in the
     book, which risks counting something twice; 5.6 already fixes one item
     at a time. Option 3 is a mock-up that Setup day would replace. Not built.

A24. ANSWERED Oct 9. Your answer: option 1, as built. Rulebook 13.1 and
     24d.
     The question was: what is in force this pay period (13.1). The book gave out only the
     settings as they are now, so Settings could not show this pay period's
     split next to the next paycheck's. The book had always kept the split
     and the mom reserve in force for the pay period (other income uses them,
     B38); it now gives them out (Book.splitInForce).
     Option 1: only the split and the two mom reserve numbers (per paycheck,
     and the cap) have a "this pay period" and a "from next paycheck", shown
     side by side; every other setting applies right away (B38) and is shown
     once. The leftover setting says it is used at the next payday.
     Option 2: the book keeps every setting as it was when each pay period
     began, and Settings shows both columns for all of them (Payday could
     then also show the old ones for a past pay period).
     Recommendation: option 1. It is what 13.1 says, and nothing else waits
     for a paycheck. Built: option 1, since this chunk asks Settings to show
     both; option 2 would go on top of it, with nothing built thrown away.


## Part A, added with Setup day (Phase 4, Oct 9). All answered.

A25. ANSWERED Oct 9, built. Your answer: option 1, the last 10 days, as a
     setting. Rulebook section 2, 14.2 and 25a. The transfers step on Setup
     day says how far back it looks, with a sheet to change it (any whole
     number of days from 0, today only); the details are B134.
     The question was: how far back Setup day asks about transfers with only one side showing
     (B48, B64). The rulebook says they are offered for you to confirm, but
     not from how long ago. A transfer whose other side is just before the
     start of the bank's history, or one whose other side no bank rule
     names, would show up however old it is, and you would be asked about
     each one.
     Option 1: only the last 10 days, and 10 is a setting (rule 0.2). A
     card payment or a transfer lands within a few days, so anything older
     is history.
     Option 2: every one in the whole history, however old.
     Option 3: the last 10 days, and the older ones listed apart as "older,
     not asked about", so you can see them.
     Recommendation: option 1. An old one is not on its way any more, and a
     long list of old card payments to answer "no" to would hide the one
     that matters.

A26. ANSWERED Oct 9, built. Your answer: option 2. A purchase or payment
     waiting in review that is refunded in full leaves review by itself, is
     kept as a record, and comes back to review if the bank takes the
     refund back. Rulebook 4.5 and 25b. Worked example 39. The simulated
     life now leaves some online orders unsorted while they go back to the
     store, and has the bank take some refunds back; the details are B135.
     The question was: a payment refunded in full still waits in Review at $0.00 (4.5, B7,
     B11). When a purchase (a card or debit payment) is still waiting in
     Review and the bank refunds all of it, it stays in Review with nothing
     left to sort (checked: a 25.00 purchase, refunded 25.00, waits at
     0.00). It holds nothing back from safe to spend (4.3),
     but it still counts as waiting: the Review badge, "1 waiting in review"
     on Home, and the daily review reminder (10.3, B32) come for it, and you
     have to pick a bucket for $0.00 to clear it.
     Option 1: leave it as is. Sorting it anywhere changes no bucket.
     Option 2: it leaves Review by itself once it is refunded in full, since
     there is nothing to decide. It is kept as a record (sorted nowhere), and
     if the bank later takes the refund back (4.10), the purchase comes back
     to Review to be sorted.
     Option 3: it stays, marked "Refunded in full, nothing to sort", with one
     "Got it" button, like a new purchase on the old card (5.4).
     Recommendation: option 2. Nothing is left to decide, and a reminder for
     $0.00 teaches you to ignore reminders. Needs a line in 4.5.


## Part A, added with bank rules (Phase 4, Oct 9). All answered.

A27. ANSWERED Oct 9, built. Your answer: option 1. The first bank rule in
     the list wins; each bank rule's sheet, on Settings and on Setup day, has
     Move up and Move down, which ask first, and each move is logged.
     Rulebook section 2 and 26a; the details are B146 to B148.
     The question was: two bank rules that match the same item (section 2). A bank rule
     matches when the item is on its account, its description contains the
     rule's text (ignoring case), and the money went a way the rule fits (a
     fee is money out, say). If two of them match one item, the rulebook does
     not say which wins. Example: "Zelle payment to" on checking says a
     payment to a person, and "Zelle payment to MOM" on checking says a
     transfer to savings.
     Option 1: the first in the list wins, as with sorting rules (B9). A new
     rule goes to the end; before you save one, Settings says how many of
     the items it would have matched a rule before it reads first, and how
     many it would take from a rule after it. Add Move up and Move down, as
     for sorting rules (A22), so you can put a narrow rule ahead of a wide one.
     Option 2: as option 1, without Move up and Move down: to put a rule
     first, remove the ones ahead of it and add them again.
     Option 3: the rule with the longest matching text wins ("Zelle payment
     to MOM" beats "Zelle payment to"), whatever the order.
     Option 4: a rule that would match an item another rule already matches
     is refused when you save it.
     Recommendation: option 1. It is how the sorting rules work, so there is
     one way to think about both, and the preview already shows the overlap
     before you save. Built: the first in the list wins (the bank connection
     always worked that way), with the preview saying so, and no Move up or
     Move down yet.


## Part A, added with the real server keeping everything (Oct 9). All answered.

A28. ANSWERED Oct 10, built. Your answer: option 1. npm run replay-check
     shows each event whose totals would change, before and after, and with
     your typed yes takes the new totals from the first of them on; the
     change log says so. Rulebook 0.6 and 27a; the details are B155 to B157.
     The question was: when the replay check finds a difference. Every time the real server
     starts, it replays the book's history and compares the totals after each
     event with the ones saved then. If they differ, it does not start, and
     says at which event (as you asked). That is right when the code changed
     by mistake. But one day a real fix to the money math may change what an
     old event does (a bug like B124, found after months of use). Then the
     server will not start until something is decided. The rulebook does not
     say what.
     Option 1: the server stays stopped. A separate command shows each event
     whose totals would change, before and after, and with your yes takes
     the new totals from that event on. It goes in the change log (13.5),
     dated, with what changed.
     Option 2: the same, but the server starts anyway, read-only, with the
     difference shown on every screen, until you say yes.
     Option 3: never: an old event must always replay as it was saved, so a
     fix only applies to events after it (the code keeps the old way for the
     old ones).
     Recommendation: option 1. Nothing about money changes without you seeing
     it first, and the past stays explained. Built: the server does not start
     and says at which event; there is no way past it yet.

A29. ANSWERED Oct 10, built. Your answer: option 2. Money in to checking
     lists its likely purchases on checking under "A refund to your debit
     card?", each with "This refund is for this one". Rulebook 4.5, 6.1 and
     27b; the details are B158 and B159.
     The question was: a store's refund to the debit card. The bank connection reads money
     coming into checking as a deposit (6.1): it cannot tell a store's refund
     from any other money in. So a refund to the debit card waits in review
     with the deposit choices, and cannot be matched to the purchase it is for
     (4.5, A18); a refund to the everyday card can. Found while playing the
     simulated life through the database: its bank says which purchase each
     refund is for, and those to checking came out as deposits.
     Option 1: keep it. You pick payback, into the bucket the purchase came
     from. A partial refund of a split purchase then does not send it back to
     review to be split again (4.5).
     Option 2: money in to checking also offers "this refund is for this one",
     with the likely purchases on checking (same account, on or before it, at
     least that much not yet refunded), as a card refund does.
     Option 3: a bank rule that says "a refund" for text the bank shows
     ("REFUND", a store's name), so it is read as one.
     Recommendation: option 2. It works whatever the bank writes, and is the
     same choice you already have for a card refund. Built: option 1, as it
     always was.


## Part A, added with your answers to A28 and A29 (Oct 10). All answered.

A30. ANSWERED Oct 10, built. Your answer: option 1. The server stays
     stopped and npm run replay-check says which event and why; nothing is
     dropped or replaced. Rulebook 0.6 and 28a.
     The question was: an old event the money math now refuses (0.6). A28 covers an event
     whose totals change. But a fix can also make an old answer impossible:
     say a fix finds that a purchase you sorted in March could never have
     been sorted that way. Then the history cannot be replayed at all, and
     there are no new totals to take. The rulebook does not say what then.
     Option 1: the server stays stopped; npm run replay-check says which
     event and why, and nothing can be taken. The fix has to keep the old
     answer working (or a person decides by hand, in a later chunk).
     Option 2: the command offers to drop that one answer from the history
     (with your yes, logged), so the item goes back to Review to be answered
     again.
     Option 3: the command offers to replace that answer with one you pick
     now, from the choices the money math gives today (with your yes,
     logged).
     Recommendation: option 1 for now. It should be rare, nothing about
     money changes without a person looking, and options 2 or 3 can be added
     the first time it happens, when we know what the fix was. Built: option
     1 (the command says which event and why, and the server stays stopped).


## Part A, added with syncing on a timer (Step 3, Oct 10). All answered.

A31. ANSWERED Oct 10, built. Your answer: option 1, as built. Rulebook 13.7
     and 28b; the details are B172 and B173.
     The question was: what counts as "something a sync just changed". You asked that an
     answer about something a sync just changed be refused with why, and
     nothing change. The rulebook does not say what counts as changed.
     Option 1: an item (waiting in Review, on a bucket's list, or a payday
     question) that is not what the screen showed when you tapped: its
     amount, day, description, pending or posted, what a payday question
     asks, where it is sorted now, or what "this is my paycheck" would do.
     The screen sends back what it showed; if the item is not that any
     more, the answer is refused with how it is now ("MADE UP CAFE changed
     since you looked: it is now $13.50. Look at it again, then choose.
     Nothing was changed."), and the screen shows it again. What it is
     offered is not part of it: a new purchase joining a refund's likely
     purchases does not refuse the purchase you picked, and a choice no
     longer offered is refused anyway. A hand move and the settings are not
     about one item: a move still asks first if it would leave a bucket
     below zero (13.4), and the paycheck rule and the mom rule ask again
     when what they would do has changed (B113).
     Option 2: only its amount. A pending charge that posts at the same
     amount, or with a new description, goes through.
     Option 3: any sync that brought anything new refuses every answer from
     a screen shown before it, whatever it was about.
     Option 4: option 1, and a hand move too, when a bucket it takes from or
     gives to changed since the screen showed it.
     Recommendation: option 1. It refuses exactly what you could have seen
     differently, and nothing else; a refusal costs one more tap. Built:
     option 1 (the details are B172 and B173).


## Part A, added with Phase 4's finish line (the agent's pay period, Oct 10). All answered.

A32. ANSWERED Oct 10, built. Your answer: option 2. Rulebook 13.7 and 29a;
     the details are B178.
     The question was: a screen that changes an instant before your tap (13.7). Found by the
     agent on Oct 7 of the pay period. Review had sat in a background tab
     since the evening before, showing the cinema charge at $18.00, pending.
     The agent tapped Wants on it. Bringing the tab forward made the screen
     read its numbers again (it does that after being in the background),
     and about 75 ms later the card showed $21.50, posted; the tap
     counted against that. The app did what 13.7 says as built: the answer
     was about the item as the screen showed it at the moment of the tap.
     But nobody can read a change in a tenth of a second, so in effect it
     answered about something the person did not see. The rulebook does not
     say how long the screen must have shown something. (On the phone the
     same can happen when you come back to the app and tap at once.)
     Option 1: as now: what the screen shows at the moment of the tap
     counts, however briefly.
     Option 2: a card whose item changed when the screen read its numbers
     again says so ("Changed: now $21.50, posted") and does not take a tap
     for about a second, so a tap meant for what was there before is not
     sent.
     Option 3: the server refuses an answer about an item that changed in
     the last few seconds, as if the screen had not shown it yet.
     Recommendation: option 2. It shows what changed right where you are
     looking, refuses nothing you saw, and costs one more tap only when
     something really changed. Built: option 1. (The scripted pay period,
     Step 1, taps from a screen that did not read its numbers again, and the
     refusal comes, with how the item is now.)

A33. ANSWERED Oct 10, built. Your answer: option 3. Rulebook 4.5 and 29b;
     the details are B177.
     The question was: which purchases are "likely" for a refund (4.5, B88). Rule 4.5 says a
     likely purchase is on the same account, made on or before the refund,
     with at least the refund's amount not yet refunded. B88, as built, adds
     two things: it must also share a name word with the refund or have
     exactly the refund's amount left, and at most five are listed, each
     saying why ("Same name", "Same amount"). In the pay period every
     made-up store's name starts with "MADE UP", so "made" is a word every
     purchase shares: every likely purchase was labelled "Same name", which
     the agent found misleading. A real statement does the same with words
     on every card purchase (a city such as "NEW YORK", or "POS").
     Option 1: keep B88 as built, and write its extra condition and the five
     into 4.5.
     Option 2: 4.5 as written: every purchase on the same account, on or
     before the refund, with enough left to refund, best first (same name,
     same amount, newest), all of them listed.
     Option 3: option 1, but a word counts as a name word only when it is
     not in most of his purchases on that account (over the last 90 days),
     so "made up" or a city never makes things "the same name".
     Recommendation: option 3, with 4.5 saying so. It keeps the short list
     and makes "Same name" true. Built: option 1 (B88).


## Part A, added with Phase 5, part one (alerts worked out and kept, Oct 10). All answered.

A34. ANSWERED Oct 11, built. Your answer: option 1, as built. Rulebook 9.7
     and 30a: card reminders and the overdue alert come at the daily review
     time, with the daily review.
     The question was: what time of day card reminders (9.1 to 9.3) and the
     overdue alert (9.4) come; the rulebook gave a day, not a time.

A35. ANSWERED Oct 11, built. Your answer: option 2, quiet hours from 10:00 PM
     to 7:00 AM, a setting. Rulebook section 2, 10.8 and 30b; the details are
     B185 and B188.
     The question was: whether an alert caused by a sync in the night waits
     until morning (a purchase posting at 3 AM that makes wants low, a
     take-back, the bank wanting a login). Built before: it went at once.

A36. ANSWERED Oct 11, built. Your answer: option 2. Rulebook 10.9 and 30c;
     the details are B186.
     The question was: what to do with alerts that came due while the server
     was down (the 8:00 PM daily review, a reminder day). Built before:
     option 1, each one sent when it was back, oldest first.

A37. ANSWERED Oct 11, built. Your answer: option 2. Rulebook 10.4, 10.5 and
     30d; the details are B187.
     The question was: how often "totals do not match the bank" (10.4) and
     "log in to the bank again" (10.5) repeat while they stay true. Built
     before: option 1, once when it starts.

A38. ANSWERED Oct 11, built. Your answer: option 2, 24 hours, a setting.
     Rulebook section 2, 10.7 and 30e; the details are B189.
     The question was: a new alert when the bank has not been read for a day
     (the sync keeps failing, or the server was down). Built before: none.

A39. ANSWERED Oct 11, built. Your answer: option 3, amounts off by default.
     Rulebook section 2, 10.10 and 30f; the details are B190.
     The question was: whether the lock screen shows amounts. Built before:
     the words kept had the amounts; how the phone shows them comes with the
     phone, later in Phase 5.


## Part A, added with the phone (Phase 5, Oct 11). All answered.

A40. ANSWERED Oct 12, built. Your answer: option 2, with your OK to change
     "once" this way for those alerts only. Rulebook 10.9 and 32a; the
     details are B202.
     The question was: alerts the phone could not be given for days. 10.9 says that when the
     app was not running, only the newest of each kind goes when it is back,
     if still true. It does not say what happens when the app was running
     but the phone could not be given its alerts (the push service could not
     be reached, B181: each is tried again, never given up on). Built now:
     every one of them goes when the phone can be reached, oldest first. With
     your answer on late reminders (B185), that can now read oddly: the
     phone cut off from Oct 3 to Oct 8 gets both the 7-day and the 2-day
     reminder for Oct 10 on Oct 8, both saying "due in 2 days", and the
     daily reviews of each day missed.
     Options:
     1. As built: everything kept goes, each once, saying when it was due.
     2. Like 10.9: when the phone can be reached again, of what waited, only
        the newest of each kind goes, and only if still true; the rest stay
        in the list in the app as not sent ("Not sent: a newer one went").
     Recommendation: option 2. It is what you chose for the app being down
     (A36), and the phone being cut off is the same to him. It changes what
     "once" means for those alerts (one goes instead of each), so it is
     yours to decide; nothing is built for it yet.

A41. ANSWERED Oct 12, built. Your answer: option 3. Rulebook 10.11 and
     32b; the details are B203.
     The question was: notifications on a phone whose login has ended. A phone's notifications
     are tied to its login: logging out on it turns them off, and so does
     "Turn off" on its Settings card. A login also ends by itself after 30
     days (section 2), and the rulebook does not say what that does to the
     phone's notifications. Built now: they keep coming until he logs out
     there or turns them off. After he logs in again on that phone, its card
     says "Off on this phone. 1 other device gets them." (the other is the
     same phone's old login) until he taps Turn on, which moves them to the
     new login (the same phone is never sent anything twice).
     Options:
     1. As built: they keep coming after the login ends, so a phone he has
        not opened the app on for a month still gets card reminders.
     2. They stop when the login ends, like everything else the login lets
        a phone see. The card after the next login says "They stopped Nov 9,
        when this phone's login ended. Turn them on to start again.", and it
        is a line in the change log.
     3. As 1, and logging in again on a phone that already gets them moves
        them to the new login by itself (the card says "On").
     Recommendation: option 3. A card reminder matters most when he has not
     opened the app for a while, and the words on the lock screen hold no
     amounts unless he turns that on (10.10). If he turns amounts on, option
     2 is the safer one.

A42. ANSWERED Oct 12, built. Your answer: option 2. Rulebook 10.12 and
     32c; the details are B204.
     The question was: remembering the alerts the phone has shown. You asked for the service
     worker to remember the ids it has shown, so a repeat is dropped (a
     repeat happens when the push service took an alert but the server
     stopped before marking it sent, B181). The screens' rule is that
     nothing is kept on the phone (rule 0.4's test forbids every kind of
     storage, IndexedDB too), so it remembers them only while it runs, plus
     the alerts still on the screen (their tag is the id). The phone stops
     the service worker when it likes, so a repeat of an alert he already
     swiped away, arriving after that, shows again.
     Options:
     1. As built: nothing kept on the phone; a rare repeat can show twice.
     2. Keep only the ids (never words or amounts), the newest 500, in the
        service worker's own storage (IndexedDB), and allow exactly that in
        rule 0.4's test, for sw.ts only.
     Recommendation: option 2. It is what you asked for, it keeps no number
     of the app's, and only the service worker can read it. Either way, on
     an iPhone a push that shows nothing may count against the app (Apple
     can end a subscription whose pushes show nothing); a dropped repeat
     shows nothing. That can only be seen on a real iPhone (Phase 6).


## Part A, added with Phase 6, hosting (Oct 12). All answered.

A43. ANSWERED Oct 12, built (B215). Your answer: option 5, found while
     planning Phase 7 and recommended. Litestream's own heartbeat goes to the
     app's server on the machine (it never leaves it); a new address,
     /health/backups, says "not ok" when none has come for 10 minutes; a
     second UptimeRobot monitor watches it, so you hear on the iPhone app you
     already have. No new account, no new secret. /health stays as it is:
     Fly uses it, and if it said "not ok" for the backups Fly would stop
     sending you to the app. Tried on this PC with Litestream 0.5.17 (the
     image's): with heartbeat-url and heartbeat-interval 1m it called about
     once a minute while nothing in the books changed, and not once while
     the backup could not be reached. Also found: Healthchecks.io (option 2)
     has no iPhone app that I could confirm; it alerts by email and the like.
     The question as it was:
     How you hear that the backups have stopped. The uptime monitor watches
     /health, which says "ok" when the server is running and can read its
     books (B206). It says nothing about the backups: if Litestream cannot
     reach R2 (a wrong or expired key, R2 down, a full bucket), the books are
     no longer copied, and nothing tells you. Litestream says so in Fly's log,
     and the monthly restore check (docs/phase-6-setup.txt, step 6) would
     find it, up to a month late.
     Option 1: as built. The monthly restore check, and Fly's log.
     Option 2: Litestream's own heartbeat. Litestream can call an address
     only while every copy has gone through within a set time (5 minutes, at
     least 1). Point it at a free Healthchecks.io check: if the calls stop,
     Healthchecks.io emails you (and its phone app tells you). One more free
     account, and the check's address as one more Fly secret. One line in
     litestream.yml. To check when built: that Litestream calls it while
     nothing changes in the books (a quiet night).
     Option 3: /health says "not ok" while Litestream is not running (the
     supervisor knows), so the one uptime monitor covers both. It does not
     catch a wrong key or R2 down: Litestream keeps running then.
     Option 4: option 2 and option 3.
     Recommendation: option 2. It catches every way the copies stop, from
     Litestream's own point of view, within minutes. Option 3 adds little to
     it. Built: option 1.


## Part A, added while planning Phase 7 (Oct 12).

What the app still needs before a real bank: today it connects only through
the test bank's shortcut (no screens), so it has no way to connect Bank of
America, to log in to the bank again, or to say which account is which (the
test bank's are picked by made-up account numbers).

A44. ANSWERED Oct 12. How much history to ask the bank for when it is
     connected. It cannot change afterwards. Your answer, the
     recommendation: 90 days, Plaid's default, which covers everything the
     app looks back at (setup day's 10 days, a refund's 90 days). Up to 2
     years was possible, with more of your real data kept. Rulebook section
     2 and 33a.

A45. ANSWERED Oct 12, built (B222, B223). Bank of America's permission to read
     your accounts now runs out a year after you connect or log in again
     (Plaid, 2026). Your answer, the recommendation: Settings shows the date
     when the bank gives it, and you are told 7 days before (a setting),
     once, at the daily review time. Rulebook 10.13, section 2 and 33b.

A46. ANSWERED Oct 12 ("do all of that"), built (B216 to B221): the wording below,
     as written. Rulebook 1.1 to 1.3 and 33c.

     1.1  Connecting the bank. "Connect the bank" is offered only while
          there is no connection. It asks first: it uses 1 of the 10
          connections Plaid allows, and one that is removed never comes
          back. The bank's own login opens (through Plaid). The app keeps
          the connection the moment it gets it, sealed, on the server only.
          There is only ever one connection: the app never makes a second,
          and never removes one.
     1.2  Which account is which. After connecting, before setup day, you
          say which of the bank's accounts is checking, savings, the
          everyday card, and the old card, each once. Nothing is read from
          the bank until all four are picked. If one is missing, log in to
          the bank again to add it (1.3). Once tracking starts they cannot
          change. An account that is none of the four is never read.
     1.3  Logging in to the bank again. When the bank needs it (10.5), when
          its permission is running out (10.13), or to add an account that
          is missing, Settings offers "Log in to the bank again". It keeps
          the same connection: it never uses another of the 10, and nothing
          already read changes.

     Recommendation: as written.


## Part A, added in Phase 7 (Oct 14).

A47. ANSWERED Oct 14 ("can we do option A"; "Okay, I want to add the
     webhooks and this change"), to build in the next session (handoff in
     docs/later.txt, items 3 and 11). The "totals do not match" gaps of Oct 13
     and 14 were the bank's timing, not the books (B230, B231). His choice:
     option A, and Plaid's webhooks with it.
     12.1  Bank side: checking + savings - everyday card. For checking and
           savings, the balance the bank shows you (what is available), plus
           any transfer between your accounts still pending (it counts once
           it posts). If the bank does not give that balance, its posted
           balance less pending charges. For the everyday card, what it
           owes, including pending charges.
     10.4  Totals do not match the bank: told once the difference has lasted
           12 hours (a setting), then once a day at the daily review time
           while it lasts. Until then Home says the bank is still catching
           up.
     Section 2, syncing: also as soon as Plaid says it has something new
           (a webhook); the 60-minute timer stays.
     The exact rulebook text is shown to him before it is committed.
     WEBHOOKS BUILT Oct 15 (branch webhooks-and-payday): POST /plaid/webhook,
     every call checked by Plaid's signature (jose 6.2.12: Plaid's own advice
     is a vetted JWT library), a sync after each one that says something
     new, the 60-minute timer kept. Section 2's sync line and 34d in the
     rulebook (draft 23). His OK to the sync line and to jose, Oct 15. His existing
     connection gets the address with one call on the machine, at his word,
     after the deploy (docs/phase-7-connection-day.txt). B236 to B240.
     His OK to the text, Oct 14 ("I am okay with both"), with one change
     from the note above: besides transfers, a pending payment to a person
     and money leaving savings are put back too (the books count them once
     posted). In the rulebook as 12.1, 10.4, section 2 and 34b (draft 22).

A48. ANSWERED Oct 14 ("add the twice a month"): his pay comes twice a
     month, on the 15th and on the last day of the month, on the Friday
     before when that is a Saturday or Sunday (every paycheck since July
     says so). The pay schedule becomes a setting with that choice; every
     14 days stays as the other choice. Days to payday (11.2), the payoff
     countdown (9.5) and Payday read it. A bank holiday can still move a
     payday by a day: the app shows it late until the money comes (B35).
     His pay now lands all in checking (his change, Oct 14).
     BUILT Oct 14 (branch accuracy-and-webhooks; rulebook draft 22, section
     2 and 34). One change to the wording he OK'd: the next payday is the
     one after the scheduled payday NEAREST the last paycheck, not the first
     one more than a week after it. In February the 15th and a last day
     moved back to Friday can be 11 days apart (Feb 15 and Feb 26, 2027),
     so "more than a week" would skip a payday when the 15th's pay came 4
     or more days late. The app starts with every 14 days; he picks twice a
     month on Settings, Pay schedule. A history saved before the setting
     existed opens as every 14 days (as it then was). 3.7's 10 days still
     let the shortest twice-a-month gap (11 days) through. His OK to the
     nearest-payday wording, Oct 14.

A49. ANSWERED Oct 14 ("yes lets do that"): a payday alert. When a paycheck is
     counted, he is told the amount to move to savings (3.8) and, with the
     payoff countdown on, the amount for the old card this payday (9.5).
     At once, quiet hours apply (10.8).
     BUILT Oct 15 (branch webhooks-and-payday) as rule 10.14, with the text
     he wrote in his handoff (shown to him Oct 14). He was away all day, so
     the text went in the rulebook (draft 23, 10.14 and 34c). His OK to the
     text, Oct 15, before the pull request was merged. B233 to B235.

A50. ADDED Oct 14 on Claude's recommendation (his to strike): (a) before
     every deploy, the new image rebuilds the real books from the backup on
     a throwaway machine and replays every event (0.6), so an update can
     never stop the app from starting; it serves as the roadmap's real
     history test without the data leaving his own server and backup.
     (b) Items read one way while pending and another once posted (a
     purchase that posts as a transfer, and the other way round): tested,
     and fixed if the books do not end right. (c) A read-only look, with his
     OK at the time, that both cards' statements (balance, minimum, due
     date) came through, which the reminders depend on.
     BUILT Oct 14: (a) npm run deploy-check, first run at the next deploy;
     (b) one fix (B232). (c) waits for his OK at the time.
     (a) RAN Oct 15 before the deploy and stopped it (B242, B243).
     (c) DONE Oct 15, with his OK at the time (read-only, on the machine):
     both cards' statements come through with the due date, the statement
     balance, the minimum and the last payment, but Bank of America (through
     Plaid) sends no statement date (last_statement_issue_date is null on
     both, every sync since Oct 12). cardStatement refuses a statement with
     no statement date, and the Keeper drops it without a word: no card
     reminders, no "due" on Home, no overdue alert, on either card. A52.

B232. Found by A50b's tests (Oct 14): a posted item linked to a pending
     purchase (pending_transaction_id) always replaced it as a purchase,
     even when the bank rules read the posted words as a card payment or a
     payment to a person. A card payment whose pending words no rule knew
     stayed counted as spending, with its arriving half left in transit.
     Now only a posted purchase replaces its pending one; anything else is
     what the bank rules read, and the pending purchase is dropped when the
     bank removes it (A2). Reading: as if the bank had sent only the posted
     item.


A51. ADDED Oct 15 (docs/later.txt 20, the last item of his handoff, "if
     time is left"): the weekly statement check for Phase 7. It is a new
     screen, so its shape is his call before it is built. Options:
     1. (Recommended) Settings, "Check against the bank": pick one of the
        four accounts and a week (Monday to Sunday, the last 6 weeks). It
        lists every item the app read for it, as the bank sent it (day,
        description, amount, pending or posted), how the app reads it (a
        purchase in needs, a transfer to savings, ...), and the week's money
        in and money out, all worked out on the server. One tap per week, no
        typing on the phone; matches "once a week, compare" (roadmap Phase 7).
     2. Any date range: two date fields. More freedom, more typing.
     3. By statement: from one statement date to the next for the cards, by
        month for checking and savings. Matches the paper statements, but a
        month is a long wait in Phase 7.
     Not built: waiting on his pick.

A52. ADDED Oct 15 (A50c found it): Bank of America sends each card's due
     date, statement balance and minimum, but no statement date, and 9.3
     counts payments since the statement. Today a card with no statement
     date is dropped silently: no reminders, no "due" on Home, no overdue
     alert (9.1 to 9.4, 9.6, 9.7). Options:
     1. (Recommended) A setting per card: days from the statement date to
        the due date, which he reads once off a statement (two months, to
        see it holds). Each statement date is worked out from the due date
        Plaid sends. Until it is set, that card's reminders stay off and
        Home says so.
     2. A setting per card: the day of the month its statement closes.
        Easy to read off a statement, but a day off when the cycle's
        length changes.
     3. The bank's own minimum: remind while it is above $0, and the bank's
        "overdue". Nothing to enter, but not known to be how Bank of America
        reports it, and it does not give the everyday card's full-balance
        rule (9.3).
     With any of them: a card whose statement cannot be read says so on Home
     and Settings ("Card reminders are off for the old card: the bank did
     not send its statement date"), never dropped without a word.
     ANSWERED Oct 15 (option 1, "make a card with no readable statement say
     so on Home and Settings"): rulebook draft 24, 9.8, section 2 and 35.
     BUILT Oct 15 (branch a52-statement-days): Settings has "Everyday card:
     statement to due date" and "Old card: statement to due date" (not
     entered to start, 1 to 60 days, can be cleared). B242 to B244 below.
     REPLACED Oct 16 by A53 (the closing day), before he entered any days.

A53. ADDED Oct 16 (he read both cards' last two statements in the bank's
     app): each card's statement closes on the same day of every month,
     and the due date falls on the same day of the next month, so the
     number of days between them changes with the length of the month
     (fewer still after February). A52's days would put the statement date
     a day or more off in some months, and with it which payments count
     (9.3). Options:
     1. (Recommended) A setting per card: the day of the month its
        statement closes. The statement date is the last such day before
        the due date the bank sends; a month without that day closes on its
        last day.
     2. Keep the days (A52), and he corrects them when a month is off.
     ANSWERED Oct 16 (option 1, "you have okay for all of it"): rulebook
     draft 25, 9.8, section 2 and 36a.
     BUILT Oct 16 (branch closing-day-and-pending-pay): Settings has
     "Everyday card: statement closing day" and "Old card: statement
     closing day" (not entered to start, 1 to 31, can be cleared). A52's
     days are no setting any more; they were never set on his books (read
     on the machine, Oct 16, his OK). B246 below.

A54. ADDED Oct 16 (a read-only look at his live books, his OK, after "Off
     by" showed on a payday): the difference was exactly his paycheck,
     still pending at the bank in two parts (checking and savings). Bank of
     America put both parts into the available balances at once; the app
     counts money in only once it posts, and 12.1 (A47) put back only
     pending money going out. With the pending money in taken out, the
     check matched to the cent. Every payday would show the paycheck as a
     difference until it posted, and tell him after 12 hours (10.4).
     Options:
     1. (Recommended) 12.1 takes pending money in out of the available
        balance, as it puts pending money going out back.
     2. Nothing: "The bank is still catching up" until the paycheck posts.
     ANSWERED Oct 16 ("Yes, fix it tonight"): rulebook draft 25, 12.1 and
     36b. BUILT Oct 16 (branch closing-day-and-pending-pay). B247 below.

A55. ADDED Oct 16 (his ask, after the look at his live books: he had sorted
     about twenty purchases by hand in his first days, with no sorting rule):
     offer "always do this" by itself the second time he sorts the same
     place the same way. Found with it: "always do this" started from the
     whole bank description, and a debit card purchase's has its date and
     card digits in it, so a rule made from it never matched the next one.
     ANSWERED Oct 16 (his OK to rule 13.8 as written): rulebook draft 26,
     13.8 and 37a.
     BUILT Oct 16 (branch rule-suggestions). B249 below.

A56. ADDED Oct 16 (docs/later.txt 30, from the payday "Off by" of A54):
     on payday morning his paycheck sat pending at the bank and Home
     showed nothing about it, so payday looked like nothing happened
     until it posted. Recommended: Home shows money still pending into
     checking or savings, "Paycheck on its way" when the paycheck rule
     matches it, with "counted when it posts". Nothing about money
     changes.
     ANSWERED Oct 16 (his OK to all of the recommended changes, before
     he went to sleep): rulebook draft 27, 11.4 and 38a.

A57. ADDED Oct 16 (his ask, "Layer 1": the app explains itself, with no AI
     and nothing sent anywhere new). Three things confused him that day:
     the paycheck pending on payday morning, a black screen for 16 minutes
     while the host restarted, and "The bank is still catching up, off by"
     a few dollars, which a read-only look found was Bank of America's
     balances moving before Plaid sent the transactions (a card charge
     posted at the bank but still pending in Plaid, so counted twice, and a
     rise in checking's available balance with no transaction yet).
     Recommended, four pieces: lines that add up to the difference and say
     why, from the bank's balances kept with each read (12.6); "pending
     since" and "usually posts within" on money on its way in (11.4); a
     status page (0.7); a plain page when the server cannot be reached
     (0.8). Nothing about money changes. The fixed numbers in them (3
     examples, three in four of the last 10, 15 seconds) are not settings,
     like 4.5's five and 10.12's 500.
     ANSWERED Oct 16 (his OK to the text as written, "OK, build it"):
     rulebook draft 28, 0.7, 0.8, 11.4, 12.6 and section 39.

A58. ADDED Oct 18 (the redesign's PR 4, docs/redesign-plan.txt): the Trends
     tab, Past and Now. Drafted as rulebook section 40 (40.1 to 40.9); the
     text is the question. Nothing about money changes: Trends only reads
     the books and the bank history the app already keeps, nothing is sent
     anywhere, and the history still replays exactly (0.6). The choices in
     it, each with the recommendation as written:
     1. The 90 days before setup day (40.1, 40.3). Recommended: shown,
        read by today's bank rules and sorting rules, marked "Before setup
        day", never put in the books. Without it Trends has almost nothing
        for weeks (the books began Oct 12), and no usual until about the
        end of November.
     2. What "where it went" groups by (40.6). Recommended: the place's
        name, found the same way as the rule offers (13.8), five biggest
        then "Everything else". Other choices: Plaid's own category labels
        ("Food and drink"; broad, but Plaid's guesses, which he cannot
        correct), or only needs and wants.
     3. Old card payments (40.2, 40.7). Recommended: their own part of
        needs on the bars, and left out of "against your usual", so a
        planned payoff does not look like spending more. Other choice:
        counted like any other needs spending.
     4. Your usual (40.7). Recommended: the middle one of the last 5 full
        pay periods, by the same day of the pay period, so one odd pay
        period does not move it. Other choice: the average.
     5. The Wants line (40.8). Recommended: by the day each thing happened,
        so a tip that posts later lands on the day of the meal. Other
        choice: what Wants held each evening as the books stood then, which
        never changes after the day but jumps when late items post.
     6. The fixed numbers (90 days, five places, 5 and 3 pay periods) are
        not settings, like 4.5's five and A57's numbers. Recommended as
        written; each could be a setting instead.
     Worked into the draft from a second look (Oct 18), still waiting on
     his OK: the even pace rounded down to the cent, with payday as day 1
     (40.8); today said in words with the amount ("$42.10 less left than
     an even pace") instead of "Ahead of pace", which reads either way; the
     Wants line is not safe to spend (40.8); savings and the mom reserve
     as two amounts, never added (40.5); one place across accounts (40.6).
     ANSWERED Oct 18 ("I've read section 40 and A58. OK to the text as
     written."): rulebook draft 29, section 40 and 41a.

A59. ADDED Oct 18 (the redesign's PR 5, docs/redesign-plan.txt): the Trends
     tab, Future and Habits. Section 40 covers only Past and Now, so the
     new parts need rule text. Drafted below as 40.10 to 40.17; the text is
     the question. It goes in the rulebook (draft 30) only with his OK.
     Nothing about money changes: like the rest of Trends it only reads the
     books and the bank history the app already keeps, nothing is sent
     anywhere, and the history still replays exactly (0.6).

     THE DRAFT

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

     THE CHOICES IN IT, each with the recommendation as written:
     1. The pace for Needs and Wants (40.11). Recommended: this pay period's
        own pace, from day 3. Other choice: your usual (40.7) for the days
        left, which is steadier but needs 3 full pay periods first (about
        the end of November for the books).
     2. Savings a year out (40.12). Recommended: the least and most a pay
        period actually added to savings (paycheck share, leftovers moved,
        less moves out), times the paydays in a year. Other choice: from the
        split only (50% of the last paychecks), which ignores moves out and
        leftovers and so is usually too high.
     3. The old card (40.13). Recommended: the 9.5 plan drawn as a line to
        $0.00, and what it owed so far. Other choice: also "at the pace
        you have paid", a payoff date from what was paid in recent pay
        periods.
     4. Habits leave out old card payments (40.10), as "against your usual"
        does (40.7, A58 3).
     5. Repeat charges (40.16). Recommended: at least 3 charges, the three
        kinds of gap, amounts within 10%, and only the ones still going.
        Other choices: 2 charges are enough (more found, more wrong ones),
        or list stopped ones too.
     6. The streak (40.17). Recommended: Wants not overspent ($0.00 or
        more at the end). Other choice: Wants ended at or above its low
        alert level (10.1), a harder bar.
     7. The fixed numbers (day 3, 365 days, 5 and 3 pay periods, the 3
        days after payday, 3 charges, the gaps, 10%) are not settings, like
        A58's. Recommended as written; each could be a setting instead.
     ANSWERED Oct 19 ("I've read A59. OK to 40.10 to 40.17 as written, with
     all the recommended choices."): rulebook draft 30, 40.10 to 40.17 and
     42a.

## Part A, added Oct 30, 2026. Both answered.

A60. ANSWERED Oct 30 (his ask, his OK to build): a friend gives him cash, he
     deposits it, and he sends it on through Zelle. The Zelle came out of
     savings, read as money leaving savings, whose only choices were needs,
     wants, a split, or a transfer. Now 7.7: "not mine" for money leaving
     checking or savings. Rulebook draft 31, section 43.

A61. ANSWERED Oct 30 (his ask): he could not tell whether a statement was
     coming, since a card shows only from the first reminder day. Now 9.9: a
     card on Buckets with each card's statement at any time.

## Part A, added Nov 1, 2026. All answered.

A62. ANSWERED Nov 1 (his ask, and "build all three"): he did not want money
     marked as someone else's when it is just not needs or wants. Options
     were one line called Other, or a choice that comes out of savings; he
     took Other. Only the words change: the books keep their old names inside,
     so the history replays as it was. Rulebook draft 32, section 44.

A63. ANSWERED Nov 1: cash that is part a friend's and part what the friend owed
     him could not be sorted in one step. Now 7.8: money in can be split.

A64. ANSWERED Nov 1: something bought for a friend on the everyday card had to
     go through a bucket until the friend paid back. Now 7.7 covers that card.

A65. ANSWERED Nov 1: no cash balance. Everything in the app is checked against
     the bank, and nothing could check a wallet. Moving money in by hand (13.3)
     covers money sent on against cash he keeps.

## Part B. Built on the plain reading. Tell me if any is wrong.

WAITING FOR YOU TO CHECK (Oct 10, 2026, the end of Phase 4). Each was
built as it says; nothing to do unless one is wrong. All in one place, by
number. B1 to B79 (Phases 1 to 3) were never on a "still to check" list; say
so if you want them here too. B4, B20, B82 and B84 are answered.

  B80. Home shows "Move $X to savings" (3.8) whenever there is money still to move, not only on payday.
  B81. When the totals do not match (0.5), Home holds back safe to spend and shows the difference instead (B37).
  B83. The bucket bars say "Low" or "Empty" whenever the bucket is below its level right now (10.1, 10.2).
  B85. A late paycheck (B35) shows "Paycheck is 2 days late" with the date it was expected.
  B86. With B82: "last checked" means the last time the bank was read and the totals matched, and the number Home...
  B87. With B84: "seen" means you tapped the take-back and pressed "Got it" on the sheet that shows what, how...
  B88. Which purchases a refund likely belongs to (20d, A15).
  B89. Which choices an item gets is decided by the money math for that kind of item, from the rulebook, and the...
  B90. "Always do this" (13.6, B49).
  B91. What asks first.
  B92. Sending the same choice twice.
  B93. The order on Review.
  B94. What the Buckets screen shows.
  B95. Splitting on the screen.
  B96. Money back waiting in review.
  B97. What "this pay period" covers on a bucket's list.
  B98. Each item is one row, with everything it did to that bucket this pay period added up.
  B99. Newest first, by the day it happened (the day of the purchase, the payday for a leftover).
  B100. Which rows can be sorted again from the list, and with what.
  B101. Sorting something where it already is changes nothing and says "It is already in Wants".
  B102. "Always do this" from a list works exactly as in review (13.6, B49, B90): it asks first, the rule goes...
  B103. Hand moves (13.3, 13.4, 13.5), from Buckets and from the list of each bucket.
  B104. Payday shows what the last paycheck did, step by step, from the money math: the mom reserve first (how...
  B105. "The pay period that just ended" is the one before the current one: from its paycheck (setup day for the...
  B106. What became of each leftover is one of four things: nothing to ask (the bucket held nothing, or was...
  B107. Payday opens from Home and from Buckets, and Back goes to the one you came from.
  B108. On Buckets, each bucket is a link to its list, there is a "Move money" entry, and a Payday row.
  B109. The payday question says why it is smaller.
  B110. Undoing a payment marked as going to the old card (A20), from checking.
  B111. A kept leftover is what the question asked.
  B112. What asks first on Settings.
  B113. His yes to the paycheck rule or the mom rule names the preview he saw.
  B114. Only what changes is changed.
  B115. The sorting rules on Settings.
  B116. The change log on Settings shows every line the book keeps: settings, rules (with a rule made from a...
  B117. "This pay period" on Settings is what the paycheck that began it was worked out with (setup day's settings...
  B118. Changes that apply right away, as B38 says: a new pay schedule moves the next payday at once, on Home too...
  B119. Card reminder days can be any whole days, in any order, or none (then no reminder comes, and Home shows a...
  B120. Amounts on Settings are typed in dollars and cents ("1,500.00", "1500", "$1,500.00"), read as whole cents,...
  B121. Before setup day there are no settings to change: Settings says so.
  B122. Moving a sorting rule (A22).
  B123. "It was not a payment to the old card" (A21) is only for a payment you marked as going to the old card...
  B124. Found by you (Oct 9), fixed with a test first: setting the mom rule while a payment to her waited, partly...
  B125. Where Setup day is.
  B126. Every transfer with one side showing must be answered, "On its way" or "Not on its way", before tracking...
  B127. The last paycheck (B42) can be any real day up to and including setup day.
  B128. Handing out the starting money (14.2).
  B129. Starting (14.3) asks first, and your yes names the last look you saw (like B113): if anything changed...
  B130. After setup day, Home says what is still to set, the paycheck rule and the mom rule, with a way to...
  B131. Tracking starts with the rulebook's starting settings (section 2): no paycheck rule, no mom rule, and no...
  B132. Bank rules on Setup day: the ones that came with the bank connection, used as they are.
  B133. A charge pending on the old card is shown with the old card, as part of its debt (12.4, A10), not in the...
  B134. How far back Setup day looks (A25).
  B135. A purchase or payment refunded in full while it waits (A26).
  B136. The labels. Plaid gives each item a label (personal_finance_category). What its test bank...
  B137. What a suggestion says.
  B138. Each suggestion shows the label, the account, the text, what it means, how many items in the whole history...
  B139. Adding a suggestion as it is does not ask again: its matches were on its card.
  B140. Every change to a bank rule asks first, on Setup day and on Settings, with what it would have matched in...
  B141. A bank rule is refused, in words, when it cannot be: no text, more than 200 characters, a transfer with...
  B142. A new rule goes to the end of the list; a changed rule keeps its place.
  B143. From then on (24c).
  B144. The change log (13.5).
  B145. In the demo, a life that is tracking already has five made-up bank rules, and what a rule would match is...
  B146. Which rules a bank rule moves past (A27).
  B147. A move asks first, like every other change to a bank rule (B140): it says how many items from the last 90...
  B148. The change log (13.5): "Bank rule moved up" or "moved down", with the rule, its number in the list now,...
  B149. What is kept. Every answer that changes the book (sorting, splits, moves, payday answers,...
  B150. Decision numbers.
  B151. The replay check.
  B152. When the bank cannot be read (0.5, B82): the bank wants you to log in again (10.5), or its balances cannot...
  B153. The home time zone on Settings offers the US zones by name (Eastern, Central, Mountain, Arizona, Pacific,...
  B154. The real server: npm run serve.
  B155. What npm run replay-check shows (A28, 0.6).
  B156. Your yes is for exactly what you saw (like B113): if the history replays to anything else by the time you...
  B157. The change log line (13.5): "History took new totals", dated today in your home time zone, with the first...
  B158. Money in to checking only (A29): a deposit to savings is never a debit card refund, so it has nothing to...
  B159. A matched deposit becomes that refund (4.5): it is sorted nowhere else, it cannot be sorted again (asked...
  B160. What needs a login on the real server: every screen (Home, Buckets, Review, Settings, Payday, each...
  B161. The one-time code: 12 digits in three groups (1234-5678-9012), typed with or without the dashes (the...
  B162. Logging in: one passkey for this app, checked with Face ID, Touch ID, or the computer's own check (the...
  B163. Staying logged in (section 2): 30 days on a device from when you logged in, then the login page again.
  B164. Another passkey (Settings, "Add a passkey"): only logged in, it asks first, and the passkey is made on the...
  B165. The change log (13.5): "Logged in", "Logged out", "Passkey added" (each with the device in words, such as...
  B166. Kept in the database: his passkeys' public keys only (the private key never leaves his device), each...
  B167. How often (section 2, 27d): a whole number of minutes, 15 to 1,440 (once a day), 60 to start.
  B168. When a sync is due: one interval of real time after the last sync started, whether it worked or not, so a...
  B169. What a sync asks the bank: /transactions/sync, /accounts/get and /liabilities/get, as --sync always did;...
  B170. A sync that fails (the bank cannot be reached, or answers something the app cannot read) saves nothing:...
  B171. Checked at: the moment the last sync read the bank, whether or not it brought anything new, saved with...
  B172. A sync and your answers never write at the same time.
  B173. How the screen says what it showed (A31): each item on Review, on Payday and on a bucket's list comes with...
  B174. Money on its way between your accounts is listed on Buckets (12.5, B44).
  B175. Payday and Home show what is on its way to the savings account (3.8, B46).
  B176. A purchase made on payday itself is not "made before payday" (3.4, B4).
  B177 to B184 (Phase 5, part one), B185 to B192 (your answers to A34 to A39, Oct 11) and B193 to B201 (the phone, Oct 11 and 12) and B202 to B204 (your answers to A40 to A42, Oct 12) and B205 to B214 (hosting, Phase 6, Oct 12): in their own sections at the end of part B.

B1. Paycheck smaller than the mom reserve (3.2).
    A $1,200 paycheck can only give the reserve $1,200, not $1,500. The
    whole paycheck goes to the reserve (up to the cap; any part that does
    not fit goes to savings), and nothing is left to split, so needs and
    wants get $0 that payday. Worked example 3.

B2. Leftover amount is fixed at payday (3.4).
    The question "roll over or move?" is about what was left in the bucket
    when the paycheck arrived. If you answer a few days later, that same
    amount moves, even if you have spent from the bucket since. Since your
    B4 answer, spending made before payday that shows up later does change
    it (B4, B70).

B3. A second payday before you answer the first leftover question (3.4).
    The old question is replaced by a new one covering everything now in
    the bucket (the old leftover plus anything unspent since). Answering
    both would otherwise move the same money twice.

B4. ANSWERED Oct 7, built. A purchase that shows up after payday but was
    made before it (3.4 with 4.1).
    Your answer: option 2. While the question is still open, it goes down
    by the late purchase, never below zero. Rulebook 3.4 and 20f. Worked
    example 24. The reading I had to pick while building it is B70.

B5. "Less than 10 days" (3.7) counts calendar days between the two dates.
    Exactly 10 days splits normally. A paycheck dated on or before the last
    one also goes to review. The 10 is a setting.

B6. A paycheck that lands in savings instead of checking is still a
    paycheck, as long as it matches the paycheck rule (3.1).

B7. A refund of a purchase you have not sorted yet lowers the unsorted
    spending. When you sort the purchase, only what is left of it goes to
    the bucket. Re-sorting a partly refunded purchase moves only what is
    left (4.5, 4.7).

B8. Which purchase a refund belongs to comes from the bank connection
    (Phase 3). A refund bigger than what is left of its purchase goes to
    review (4.5).

B9. A rule matches when the bank description contains its text, ignoring
    upper and lower case. If two rules match, the first one in your list
    wins (4.2).

B10. When a pending charge posts, it keeps the bucket it already had, even
     if the posted description would match a different rule (4.6). It also
     keeps the date you made the purchase (4.1).

B11. "The parts must add up to the total" (4.4) means what is left of the
     purchase after any refunds.

B12. Paying the everyday card from savings is treated like paying it from
     checking (5.1): not spending, no bucket changes.

B13. A refund on the old card lowers the debt and touches no bucket. It has
     to: the old card is outside the self-check (12.4), so moving a bucket
     would break it.

B14. Paying the old card more than it owes leaves a negative debt (a
     credit). The whole payment still comes out of needs (5.2).

B15. A pending old card purchase that posts at a new amount changes only
     the debt (5.4). It stays flagged until you have seen it.

B16. Updated after your A5 answer. A store refund the app cannot match
     (4.5) can be payback or not mine, but not "this is my paycheck" or
     "other income".

B17. Deposit rules (6.2) never apply to a paycheck. The paycheck rule is
     checked first, and an early paycheck (3.7) always goes to review.

B18. Updated after your A5 answer. "Other income" takes nothing for the
     mom reserve; it is only split by the percentages. "This is my
     paycheck" is a paycheck, so the reserve comes off first, up to its
     cap, even when the deposit is smaller than the reserve (B1). Worked
     examples 7 and 15.

B19. Updated after your A5 answer. A 3.7 early paycheck in review gets the
     same four choices as any other deposit. Rulebook 6.1 now says so.

B20. ANSWERED Oct 7, built. Your answer: "for mom" is also a review choice
     for payments to people (out of the mom reserve, counted toward the
     month), and a payment to a person can be split across needs, wants,
     and not mine. Rulebook 7.6 and 20g. Worked example 23. The reading I
     had to pick while building it is B73.

B21. A person rule matches the payee as the bank shows it, for example
     "ZELLE TO <name>" (7.4).

B22. Held for others (7.3) is shown with what it means: settled (zero),
     holding money for others (positive), or someone owes you (negative).
     Nothing nags you when it stays above or below zero; section 10 lists
     no alert for it.

B23. The difference on a mom payment (8.3) goes to one bucket, needs or
     wants. It cannot be split. Savings: see A3.

B24. "Carries over between months, up to its cap" (8.4): nothing happens
     at the start of a month. The cap limits what a paycheck adds (3.2).
     A reserve already above the cap, for example after you lower the
     cap, is not cut back; it just gets nothing more until it is under
     the cap.

B25. Same-day order. Things are applied in the order the bank sends them.
     If a paycheck and a mom payment land on the same day, the order
     changes how much of the reserve overflows to savings.

B26. Only payments to people (Zelle and the like) are checked against the
     mom rule (8.1). Since your B20 answer, any other payment to a person
     can be marked "for mom" in review (7.6).

B27. Updated after your A5 answer. Re-sorting money in can no longer pull
     the mom reserve below zero: other income never fills the reserve,
     and "this is my paycheck" cannot be re-sorted (B52). A hand move you
     confirm can still take it below zero (13.4). Whenever the reserve is
     at zero or below, a mom payment takes nothing from it and all of it
     waits in review (8.3).

B28. Card reminders go out exactly 7 and 2 days before the due date
     (calendar days; both are settings). A payment counts toward a
     statement when it reached the card after the statement date and left
     on or before today (9.1 to 9.3; see B47 for payments in two halves).
     Now in the rulebook (9.3).

B29. Updated with your review of 9.3. Everyday card: a statement with
     nothing owed (or a credit) gets no reminder; one with a balance but a
     $0 minimum still reminds until it is paid. Old card: a $0 minimum gets
     no reminder. Neither card gets an overdue alert when the minimum is
     $0, since nothing was due.

B30. Updated after your A6 answers. The overdue alert (9.4) is due on
     every day after the due date until the payments seen since the
     statement add up to at least the minimum, on either card. Making
     sure it reaches the phone once is Phase 5.
     Now in the rulebook (9.4).

B31. Changed after your review: see 10.2 in the rulebook. The empty-bucket
     alert now comes once per bucket per pay period. The book remembers
     which buckets it has already alerted about this pay period
     (takeAlerts). The other alerts come every time they are due; sending
     them at the right time is Phase 5.

B32. "Only if something is unsorted" (10.3) counts everything waiting in
     review: money in, spending, leftover questions, and old card flags.

B33. The bank login alert (10.5) follows the bank connection's status,
     which comes from Phase 3.

B34. Safe to spend (11.1) can go below zero when wants are overspent or
     unsorted spending is bigger than what is left in wants. It is shown
     as the negative number.

B35. Next payday (11.2) is the last paycheck plus 14 days. If that day
     passes with no paycheck, the days to payday go negative (the paycheck
     is late) instead of jumping ahead another 14 days.
     Now in the rulebook (11.2).

B36. Changed after your review: see 12.5 in the rulebook.
     The bank balances for the self-check still come from the bank
     connection with pending charges included (12.1); pending deposits and
     refunds count when they post. New: a transfer can come in as two
     halves on different days, the money leaving and then landing. Between
     the two the money is "in transit", and the check is bank side + in
     transit = app side. A card payment on its way is no longer a mismatch,
     and safe to spend stays on (0.5).

B37. When the totals do not match (0.5), the app holds back the
     safe-to-spend number and shows the difference instead. It still shows
     the days to payday, which does not depend on the bank.

B38. "The split or the mom reserve" (13.1) covers the split and both mom
     reserve numbers: the amount per paycheck and the cap. Other income
     sorted before the next paycheck still uses this pay period's split.
     "This is my paycheck" starts a new pay period, so it uses the new
     split (updated after your A5 answer). Every other setting applies
     right away.

B39. Changed after your review: see 13.6 in the rulebook. A rule made by
     correcting something ("always do this") goes just ahead of the rule
     it corrects, so the fix sticks. Any other new rule still goes to the
     end of your list. A new or changed rule sorts only the waiting items
     it is now the first match for (13.2, found in the review). An older
     rule never sorts them along the way: a purchase waiting because its
     split stopped adding up (A1), or a setup-day difference (A10), stays
     yours to decide unless the new rule itself is the first match.

B40. Changed after your review: see 13.4 in the rulebook. A hand move that
     would leave the bucket it comes out of below zero now asks you to
     confirm first, as moves out of savings and the mom reserve already
     did. The app says why it is asking. Held for others can still be
     moved (for example when a friend says "keep it"), and counts as a
     bucket for this check.

B41. The change log (13.5) records settings changes, rule changes, and
     hand moves, each with its date. How each transaction was sorted is
     kept on the transaction itself.

B42. Setup day also asks for the date of your last paycheck. Section 14
     does not list it, but the pay schedule (section 2, 11.2) and the
     10-day check (3.7) need somewhere to count from until the first
     paycheck arrives.

B43. Setup day takes the bank's posted balances and its list of pending
     charges, and works out the starting money with the pending charges
     included, the same way as the self-check (12.1). The assignment has
     to match it to the cent (14.3). Starting money can be below zero, if
     the everyday card owes more than checking and savings hold.


## Part B, added with the review changes (Oct 6). Tell me if any is wrong.

B44. Money on its way to the old card (12.5): needs pays when it leaves
     checking, since that is when you spent it. The debt goes down when it
     lands, so it matches the old card's balance. It is listed as in
     transit but not counted in the check (12.4).
     Confirmed by you (Oct 6): keep as built.

B45. The two halves of a transfer pair up by the link the bank connection
     gives, when it has one. Otherwise each half pairs with the oldest
     unpaired half between the same two accounts for the same amount. If
     the landing is seen first, it shows in transit as a negative until
     the leaving half shows up.
     Now in the rulebook (12.5).

B46. Money already on its way to savings counts as moved for "still to
     move" (3.8).

B47. For card reminders (9.3, 9.4), a payment is seen from the day it left
     checking or savings. Which statement it counts toward goes by the day
     it reached the card, the way the card applies it (found in the
     review): a payment that left before the statement date and landed
     after it counts toward the new statement. One still on its way counts
     toward the new statement too. A transfer seen in two halves is one
     payment, and the answer is the same whichever half shows up first.
     Now in the rulebook (9.3).

B48. Setup day also takes the transfers with only one half showing that
     day. Money that has left and not landed is added to the starting
     money. A payment that has landed but does not show leaving yet is
     taken off, since it is still counted where it left (found in the
     review). Halves going to the old card do not count either way: the
     old card is outside the starting money, and its balance already
     shows whatever has landed.

B49. "The rule it corrects" (13.6) is the first rule that matches the
     item, as it first showed up or as it posted, even if you had already
     re-sorted the item by hand. Banks often change a purchase's
     description when it posts (found in the review). The new rule's text
     has to match the item one way or the other, otherwise it is refused.
     The app also says whether the fix will catch the next one: text that
     only matches the posted description will not catch the next charge
     while it is still pending. A rule from a correction cannot split
     (rules never split), and fees, early paychecks, store refunds, and mom
     payments cannot get a rule, as before.

B50. "Once per bucket per pay period" (10.2): if a bucket is refilled and
     empties again in the same pay period, there is no second alert. A
     bucket that starts a new pay period still empty alerts again then.
     Now in the rulebook (10.2).

B51. The below-zero check (13.4) looks at the bucket the money comes out
     of. It asks whenever that bucket would end below zero, including when
     it is already below zero and more would come out. Leaving it at
     exactly zero does not ask. Moving money into a bucket that is below
     zero never asks.


## Part B, added with your part A answers (Oct 6). Tell me if any is wrong.

B52. "This is my paycheck" (6.1) works for any deposit in review: a 3.7
     early paycheck, or a deposit the paycheck rule did not recognize
     (a new employer, say). It also works on a deposit you had already
     sorted another way; that earlier choice is undone first. Once it is
     your paycheck it is final, like any paycheck: it cannot be re-sorted,
     because the pay period it started may already have leftover answers
     and spending in it.

B53. The new pay period starts on the day the deposit arrived, not the
     day you answer. So the 14-day schedule (11.2) and the 10-day check
     (3.7) count from that day, and the leftover question covers what was
     in each bucket when you answered.
     Now in the rulebook (6.1).

B54. A deposit older than the last paycheck cannot be "this is my
     paycheck", since pay periods would then run backwards. The app says
     so and the deposit keeps waiting; it can still be other income. A
     deposit on the same day as the last paycheck can be your paycheck.

B55. A deposit rule (6.2) and "always do this" (13.6) can pick other
     income, payback, or not mine, but not "this is my paycheck". Telling
     the app which deposits are paychecks is the job of the paycheck rule
     in settings (section 2), which keeps the 10-day check (3.7). A rule
     that skipped it would split a mistaken second deposit automatically.

B56. "What the bucket started the pay period with" (10.1) is what was in
     it right after the paycheck split, rollover and carried-over
     overspending included. A leftover you then move to savings (3.4)
     comes out of it, since it did not roll over. Paybacks and hand moves
     during the pay period do not change it. Before the first paycheck,
     it is what you gave the bucket on setup day.

B57. "Falls below" is strictly below, to the exact cent: with a start of
     899.99, the level is 179.998, so 180.00 left does not alert and
     179.99 does.
     Now in the rulebook (10.1).

B58. At zero or below only the empty alert comes, never both at once. If
     money then comes back in (a payback, a hand move) and the bucket is
     above zero but still under the level, the low alert comes then, if
     it has not come yet this pay period.
     Now in the rulebook (10.1).


## Part B, added with the A7 answer (Oct 6). Tell me if any is wrong.

B59. The countdown (9.5) counts paydays from the pay schedule, starting at
     the last paycheck. If a payday passes and that paycheck has not come
     yet, the payday is behind today, so it is not one of the paydays left,
     even though the money will still come. Until it does, the countdown
     asks a little more per payday.

## Part B, added with Phase 3, the bank connection (Oct 7). Tell me if any is wrong.

B60. Plaid's "current" balance is the posted one, and the app adds the
     pending charges to it (12.1). Checked against the test bank: there
     "available" is current minus pending money out (plus pending money
     in), so current leaves pending items out. Your real bank gets checked
     the same way in Phase 7.

B61. Only pending purchases count while pending (4.6). Pending money in,
     pending transfers, and pending payments to people (Zelle) wait until
     they post: meanwhile they are in neither the book nor the bank side of
     the self-check (B36). A pending Zelle to mom counts toward the month
     (8.2) once it posts.

B62. A purchase's day (4.1) is the day the bank says it was authorized,
     when it says; otherwise Plaid's date. Everything else is dated the day
     the bank shows it (for money arriving, the day it landed).

B63. A pending charge the bank drops (A2) is dated the day the sync sees
     it dropped, since the bank does not say.

B64. Everything Plaid sends before setup day is history: it is already in
     the starting balances and never reaches the book. Setup day waits
     until Plaid has sent all of the history. Charges pending in it are
     counted on setup day (A10). Halves of transfers with no other half in
     the history are offered as "on their way" for you to confirm (B48).

B65. Bank rules and sorting rules match the bank's own description when
     Plaid has it, otherwise Plaid's tidied-up name. Plaid's name can be
     shorter ("ExxonMobil" for "EXXON VILLAGE SHOP STO").

B66. A card payment's arriving half pairs with money seen leaving for that
     card for the same amount, even when it left savings and the card's
     rule names checking: a card statement often does not say where a
     payment came from (12.5).

B67. Within one sync, items are applied in date order, keeping the bank's
     order within a day (B25); removals come after.

B68. Amounts that are not whole cents, and amounts not in dollars, wait for
     your decision. They are never rounded or converted (0.1). The test
     bank sends some, like 37.804077; real Bank of America amounts should
     never need it.

B69. Accounts in the connection that are not one of your four are left out
     of everything.


## Part B, added with your Phase 3 answers (Oct 7). Tell me if any is wrong.

B70. With B4, the leftover question changes by however much spending made
     before payday takes from that bucket changes between payday and your
     answer: a late purchase, a pending charge posting at a new amount (a
     tip), a re-sort, a refund, or one the bank takes back. Money coming
     back can raise it again, but never above what it asked at payday, and
     it never goes below zero. A purchase still waiting in review counts
     once you sort it into the bucket.

B71. A paycheck the bank takes back (4.10) keeps the pay period it started,
     since its days have passed: only its money comes back out of the
     buckets, the way the paycheck put it in. Leftover answers already
     given stay as they are.

B72. A posted transaction whose amount the bank changes is taken back, and
     the new version counts as new: sorted by your rules, or waiting in
     review. It does not keep the bucket you gave the old version. (A
     pending charge's new amount does keep its bucket, A13.)

B73. A payment marked "for mom" by hand, or by a rule for that person, can
     be sorted again later. It then stops counting toward the month (8.2),
     and the reserve gets back what it gave. One the mom rule matched
     cannot be sorted another way (8.1). A payment partly refunded cannot
     be marked for mom. The difference on a payment for mom (8.3) still
     goes to one bucket, as before (B23).

B74. "Transfer between my accounts" (5.6) works for money out of checking
     or savings (a purchase, a payment to a person, a withdrawal) and for
     money in (a deposit, or a refund on a card, which becomes a card
     payment's arriving half). It works only once a charge has posted, and
     not on one partly refunded or counted on setup day. The app keeps what
     the bank sent: sorting it any other way later makes it that again
     first, and the bank sending it again is still a duplicate. "Always do
     this" cannot make a transfer rule; that is what the bank rules are for
     (section 2).

B75. The take-back alert (10.6) comes once, the next time the alerts are
     taken: one for each transaction taken back, in the order it happened.
     Getting it to your phone at the right time is Phase 5.

B76. A charge pending on setup day, which later posts and is then taken
     back by the bank: its money comes back and waits in review as a
     difference, the same as when such a charge is dropped (A10).

B77. If the bank takes back the half of a transfer that left, and the half
     that arrived names it, the arriving half pairs like one the bank did
     not link: with the oldest unpaired half that left between the same
     accounts for the same amount, or else it shows in transit as arrived
     (12.5).

B78. The bank connection sends money leaving savings that no bank rule
     names as a withdrawal, a kind of its own, never as a purchase. No
     sorting rule sorts it, and "always do this" cannot make one for it
     (4.9). A pending one counts while pending, like a pending purchase
     (4.6, 12.1).

B79. The bank connection now follows the bank when a pending charge's
     amount changes (A13) and when a posted transaction is removed or its
     amount changes (A14), so these no longer wait for your decision or
     show as a self-check difference. A change it still cannot follow (a
     pending charge moved to another account, or a posted one shown as
     pending again) waits for you, as before.


## Part B, added with the Home screen (Phase 4, Oct 7). Tell me if any is wrong.

B80. Home shows "Move $X to savings" (3.8) whenever there is money still
     to move, not only on payday. It stays until the money is moved (or
     is on its way, B46). Tapping it shows what should be in the savings
     account and what is there.

B81. When the totals do not match (0.5), Home holds back safe to spend and
     shows the difference instead (B37). The bucket bars and the other
     items on Home still show.

B82. ANSWERED Oct 7, built, changed. When the bank cannot be read, Home
     shows the last safe to spend the bank backed up, greyed, with "As of"
     and the day and time it was checked, in the phone's time zone. It is
     the number from that moment, not one worked out now. If there has
     never been one, Home says "Can't check against the bank" as before.
     Rulebook 0.5 and 21c. Worked example 6. The reading I had to pick
     while building it is B86.

B83. The bucket bars say "Low" or "Empty" whenever the bucket is below
     its level right now (10.1, 10.2). The once-per-pay-period limit is
     for the alerts on your phone (Phase 5); looking at Home never uses
     an alert up.

B84. ANSWERED Oct 7, built, changed. The bank taking something back
     (10.6) shows in Needs attention until you have seen it. Rulebook 10.6
     and 21b. Worked example 5. The reading I had to pick while building
     it is B87.

B86. With B82: "last checked" means the last time the bank was read and
     the totals matched, and the number Home showed then. The server
     remembers it each time that happens (saving it is wired up with the
     rest of the server in a later step; the demo makes one up).

B87. With B84: "seen" means you tapped the take-back and pressed "Got it"
     on the sheet that shows what, how much, and when. Just opening Home
     does not count, and neither does the phone alert (Phase 5). Each
     take-back is its own row, oldest first. Marking one seen changes no
     money. (Since the Review screen, his choices are sent to the server
     too, B91; neither moves money at the bank.)

B85. A late paycheck (B35) shows "Paycheck is 2 days late" with the date
     it was expected.


## Part B, added with the Buckets and Review screens (Phase 4, Oct 7). Tell me if any is wrong.

B88. Which purchases a refund likely belongs to (20d, A15). A purchase is
     listed when it is on the same account as the refund, on or before the
     day of the refund, has at least the refund's amount left to refund
     (4.5), and either shares a name word with the refund or has exactly the
     refund's amount left. A name word is a word of three or more letters
     or digits, ignoring case and punctuation, and not a word that says what
     the bank item is (refund, return, credit, reversal, adjustment,
     purchase, payment). The best come first (same name and amount, then
     same name, then same amount; the newest first among equals), at most
     five. A purchase you already sorted is still listed, with where it
     went. If none qualifies, the screen says "No likely purchase found."
     What tapping does is A18. Since A33 (Oct 10), a word on most of his
     purchases on that account is not a name word (B177).

B89. Which choices an item gets is decided by the money math for that
     kind of item, from the rulebook, and the screen shows exactly those
     (packages/money/src/review-options.ts). In short: a deposit gets my
     paycheck, other income, payback into any of the four buckets, not
     mine, and a transfer from your other account; an early paycheck the
     same; a store refund payback and not mine; a purchase needs or wants,
     or a split between them; money out of savings the same; a fee or
     interest the same; a payment to a person needs, wants, not mine, or
     for mom, or a split across needs, wants and not mine; the difference
     on a mom payment needs or wants; a payment to the old card from
     savings savings or needs; a payday question roll over or move to
     savings; an old card purchase "Got it". A choice that exists for the
     kind of item but cannot be made right now (my paycheck for a deposit
     older than the last paycheck, B54; a transfer for something pending,
     partly refunded, counted on setup day, or taken back, B74) is not
     offered, and the sheet says why. A split needs at least two cents,
     one for each part, so one cent cannot be split.

B90. "Always do this" (13.6, B49). It is in the "More choices" sheet. Its
     text starts as the whole description the bank gave, which you can
     shorten (a store's name, say), and it must match the description
     (as it first showed or as it posted). With it on, only the choices a
     rule can make are offered: not my paycheck (B55), not a split or a
     transfer. Fees, money out of savings, early paychecks and store
     refunds have no "always do this" (4.9, B17, B49). After it, the
     screen says how many other waiting items the rule sorted too (13.2),
     and whether the next one will go there by itself or may still wait
     while it is pending (B49).

B91. What asks first. "This is my paycheck" (it shows the split it would
     get, from the money math, and the day the pay period starts, B53),
     both answers to a payday question (3.4), and anything with "always do
     this". They are the ones that cannot be taken back here. Everything
     else is one tap, since sorting can be done again (4.7). The server
     refuses them without the "yes" in the request too, so a tap that
     skipped the question would do nothing. The screens send his choices
     to the server, which hands them to the money math; this changes the
     app's own books, never the bank (0.4).

B92. Sending the same choice twice. Each decision gets a number on the
     phone when he makes it, and a retry sends the same number. A repeat of
     a number gets the first answer back and changes nothing, even if the
     answer was lost on the way. A different number for an item that is no
     longer waiting (a double tap that somehow got two numbers, or the
     other window already did it) is told "already dealt with", and
     changes nothing. A choice that was refused is not remembered, so
     fixing it and sending again with the same number is fine. In the demo
     the numbers are kept in memory; the real server must keep them with
     the book's history (hosting, Phase 6), or a restart would forget
     them. The item being no longer in review still protects him then.

B93. The order on Review. Payday questions first, then money in, then
     spending, then old card flags, each oldest first (the book's order for
     the same day). The one main number is how many wait; under it, what
     is held back from safe to spend (4.3), or, when only money back is
     waiting, how much higher safe to spend is until it is sorted (11.1).

B94. What the Buckets screen shows. The one main number is everything in
     the buckets (12.2): savings, needs, wants, mom reserve, held for
     others, and unsorted money in, less unsorted spending. The parts are
     shown, and what waits in review is shown apart, in and out, so they
     add up on the screen. Mom this month is the calendar month of today
     (8.2). Against the target, "Under target" is below the low end, "In
     the target" includes both ends, "Over target" is above the high end.
     The old card debt is shown on its own and is not in the total (12.4);
     a negative one is a credit (B14). Like Home, Buckets says when the
     totals do not match the bank (0.5) and when the bank cannot be read.

B95. Splitting on the screen. You type the amount for the first part (or
     two parts, for a payment to a person); the last bucket gets "the rest",
     worked out by the money math, never by the screen. A rest of nothing,
     or less, is refused and says so, in dollars and cents. The answer says
     what the rest came to.

B96. Money back waiting in review. If a charge counted on setup day posts
     for less, or the bank takes back a purchase after part of it was
     refunded, what is left waiting is money back, shown as a negative
     amount with a minus sign. It can go to needs or wants (it adds to
     that bucket) but cannot be split (4.4).


## Part B, added with the bucket lists, hand moves, and Payday (Phase 4, Oct 7). Tell me if any is wrong.

B97. What "this pay period" covers on a bucket's list. Everything the app
     counted into or out of the bucket since the paycheck that began the
     pay period was counted, up to now. That is the same moment the
     leftover question uses (B53), so the list and the question always
     agree. In practice:
     - A purchase made before payday that first shows up after it (B4) is
       in the new pay period's list, dated the day it was bought.
     - A change after payday to something from the old pay period (a tip, a
       refund, sorting it again, the bank taking it back) puts only that
       change in the new pay period. The old pay period's list stays as it
       was.
     - "Carried in" is what the bucket held when the pay period began,
       before the paycheck. Carried in + came in + went out = what it
       holds now, to the cent; every pay period adds up and joins the next.
     - Before the first paycheck the pay period is the stretch from setup
       day.
     Every bucket has a list: needs, wants, savings, the mom reserve, and
     held for others. Spending and money in that wait in review belong to
     no bucket yet, so they are on no list until they are sorted.

B98. Each item is one row, with everything it did to that bucket this pay
     period added up. Pending and posted versions of a charge are one row.
     A purchase split across buckets has a row in each, with its own part,
     saying "Part of a split". A hand move and a leftover moved to savings
     have a row in both buckets, saying where the other side is. A row
     whose total for the bucket is zero is left out: it was sorted
     somewhere else, marked a transfer, taken back, or dropped while
     pending. The one exception is a purchase refunded in full, which stays
     at $0.00 and says "Refunded $X", so you can see where the refund went.
     A part-refunded purchase shows what is left of it and says how much
     came back. Money that came in has a plus and money that went out has a
     minus.

B99. Newest first, by the day it happened (the day of the purchase, the
     payday for a leftover). On the same day, the one the app counted last
     is first.

B100. Which rows can be sorted again from the list, and with what. Tapping
      a row shows what it is. If the rulebook lets it be sorted again
      (4.7), the sheet gives the same choices review gives that kind of
      item: other bucket, split, "always do this" (13.6), a transfer
      between your accounts (5.6), for mom, not mine, payback, other
      income, "this is my paycheck" (it asks first, B52). The choice it is
      already on is shown as "here now" and cannot be tapped. It cannot be
      sorted again from the list, and the sheet says why:
      - a paycheck (it started a pay period, B52)
      - your answer to a payday question (3.4; move the money by hand to
        change it)
      - a hand move (13.3; move the money back)
      - a refund the bank matched to its purchase (4.5)
      - a payment the mom rule matched (8.1)
      - a payment to the old card from checking, which always comes out of
        needs (5.2), including a purchase you marked as one (A20 asks
        whether to offer undoing that)
      - anything the bank took back or dropped (4.10, 4.6)
      - anything still waiting in review (sort it there)
      Which choices are offered comes from the money math, which also checks
      that the book accepts every one offered and refuses every other.

B101. Sorting something where it already is changes nothing and says "It is
      already in Wants". That also catches a double tap: the second tap has
      its own decision number, and finds it already there. One exception:
      "always do this" on an item that is already where the rule would
      put it is allowed, since the rule is what you asked for. A request
      from a list says it is sorting again; without that, only an item
      waiting in review can be sorted, as before.

B102. "Always do this" from a list works exactly as in review (13.6, B49,
      B90): it asks first, the rule goes just ahead of the rule it
      corrects, anything waiting that it now matches is sorted too, and the
      answer says whether the next one will go there by itself.

B103. Hand moves (13.3, 13.4, 13.5), from Buckets and from the list of each
      bucket. You pick where the money comes from, where it goes, and an
      amount in dollars and cents above zero; any two different buckets of
      the five. It asks first only when 13.4 says: out of savings, out of
      the mom reserve, or if it would leave the bucket below zero. It says
      which, in words, and until you say yes nothing moves. A refused move
      changes nothing and says why. If there is no signal, trying again is
      the same decision, so it moves once. Two separate taps with the same
      amount are two moves, since that can be what you mean. Each move is
      in the change log with the day it was made, and shows on the lists of
      both buckets. Home's safe to spend changes right away. The demo keeps
      the decision numbers in memory, like Review's (B92); the real server
      must keep them with the book's history (Phase 6).

B104. Payday shows what the last paycheck did, step by step, from the
      money math: the mom reserve first (how much came off, how much went
      into the reserve, how much did not fit under the cap and went to
      savings), then the rest split by the percentages (the cents left over
      from rounding go to savings), and what each bucket got, which adds up
      to the paycheck. The percentages and reserve shown are the ones that
      paycheck was worked out with, not the ones in settings now (13.1).
      Before the first paycheck it says there is none and when the next is
      expected. A paycheck the bank took back says so; its pay period
      stays (B71).

B105. "The pay period that just ended" is the one before the current one:
      from its paycheck (setup day for the first) to the day the last
      paycheck was counted. It shows what was spent from needs and wants
      (what purchases, fees and payments took out, after refunds), what was
      sent to mom, and what was left in needs and wants at payday, which is
      what the leftover questions are about.

B106. What became of each leftover is one of four things: nothing to ask
      (the bucket held nothing, or was overspent, so it carries over, 3.5),
      kept (rolled over, by your answer or your setting), moved to savings
      (by your answer or your setting), or still waiting. The setting
      shown is the one in force at that payday. While a question is open
      it asks about what is left after spending from before payday that
      showed up late (B4), which can be less than what the bucket held at
      payday; the amount shown for a leftover that was moved is what
      actually moved.

B107. Payday opens from Home and from Buckets, and Back goes to the one you
      came from. The payday questions you can answer on Payday are the same
      ones as in Review: same desk, same promises, and an answer given in
      one place is answered in the other.

B108. On Buckets, each bucket is a link to its list, there is a "Move money"
      entry, and a Payday row. Home has a Payday row too.

B109. The payday question says why it is smaller. When spending made before
      payday shows up or changes after it (B4), the question asks about
      less than the bucket held at payday. The card says so, in words and
      numbers worked out by the money math: "$657.11 at payday, less
      $34.67 spent before payday and sorted since." It is the same card on
      Payday and in Review, and the line stays on the summary after you
      answer. Nothing is said when nothing was taken off. "Sorted since" is
      your wording; it also covers spending whose amount changed since, such
      as a tip.

B110. Undoing a payment marked as going to the old card (A20), from
      checking. The row is on Needs' list as "Payment to the old card".
      Its sheet says you marked it, and offers what the purchase could be
      before you marked it: Needs, Wants, a split (and, for a payment to a
      person, not mine and for mom), and a transfer with another account,
      but not savings, and not the old card again (marking it with the
      account it already has is refused). Picking a bucket makes it the
      purchase the bank sent, in that bucket. To Needs, nothing changes
      in Needs; to Wants, Wants pays it and Needs has it back. "Always do this"
      makes the rule for the purchase it was. A refused choice changes
      nothing. One the bank sent as a payment to the old card, rather than
      one you marked, still cannot be sorted again.

B111. A kept leftover is what the question asked. If late spending (B4)
      lowered the question and you rolled it over, the report used to say
      you kept what the bucket held at payday; it now says what the
      question asked when you answered, the same as for a leftover you
      moved to savings, with what was taken off shown beside it (B109).
      Nothing moves when you roll over, so no bucket changed; only what
      the Payday screen said.


## Part B, added with Settings (Phase 4, Oct 9). Tell me if any is wrong.

B112. What asks first on Settings. Setting, changing, or clearing the
      paycheck rule or the mom rule always asks first, and shows what it would
      do to what is waiting in Review, from the money math (A9): each item it
      would handle, and every bucket and the number waiting, now and after.
      Removing a sorting rule asks first. Nothing else asks: a new split or
      reserve waits for the next paycheck and can be changed back before
      then, and the other settings can be changed back at any time. Adding or
      changing a sorting rule does not ask (in Review, "always do this" does,
      B91): on Settings the rule is what he set out to make, it can be changed
      or removed right there, and whatever it sorted can be sorted again
      (4.7). The answer says what it sorted, and names what it could not
      (A19).

B113. His yes to the paycheck rule or the mom rule names the preview he saw.
      If what the change would do is no longer that (something arrived in the
      meantime, so an item or a bucket after it would differ), nothing
      happens and it asks again, with what it would do now. The yes uses the
      same decision number as the question, so a retry is still one change
      (B92).

B114. Only what changes is changed. A sheet sends all of its fields (the
      reserve with its cap, say); a setting sent as it already is, is left out,
      so the change log names only what changed. If nothing changes, it says
      "That is already the setting" and nothing is logged (like B101). A rule
      changed to what it already says is the same.

B115. The sorting rules on Settings. A new rule goes to the end of its list
      (B39); a changed rule keeps its place, and can even change kind
      (purchases, money in, payments to people). Each kind is numbered on its
      own, since only rules of the same kind compete (B9). Each kind offers
      only what the money math lets that kind of rule pick (RULE_CHOICES): a
      purchase rule needs or wants (4.2), a money-in rule other income, a
      bucket, or not mine, never "this is my paycheck" (B55), a rule for a
      person needs, wants, not mine, or for mom (7.6). Fees, money out of
      savings, and paychecks have no rules (4.8, 4.9, B55); Settings says so.

B116. The change log on Settings shows every line the book keeps: settings,
      rules (with a rule made from a correction, and the rule it went ahead
      of, as that rule was then, 13.6), hand moves, and the bank taking
      something back (4.10). A settings change that changed several settings
      is one line for each. Newest first; on the same day, the one made last
      first. Each line has its day (13.5 says "with the date"; no time of
      day). A split or reserve change says "from the next paycheck".

B117. "This pay period" on Settings is what the paycheck that began it was
      worked out with (setup day's settings before the first paycheck); "From
      next paycheck" is the setting now, with the day of the next payday from
      the pay schedule. A row that differs says "Changes", in words. A
      paycheck the bank takes back keeps what it put in force, like its pay
      period (B71). See A24.

B118. Changes that apply right away, as B38 says: a new pay schedule moves
      the next payday at once, on Home too (11.2 counts from the last
      paycheck); a new low-bucket percent changes the level of this pay
      period's buckets at once; a new 10-day number applies to the next
      paycheck-looking deposit; a new leftover setting is used at the next
      payday (this payday's questions stay as they are).

B119. Card reminder days can be any whole days, in any order, or none (then
      no reminder comes, and Home shows a card only once it is overdue,
      9.4). A day listed twice reminds once. The promo end date can be any
      real date, even one already past (then all of the old card debt is due
      now, 9.5); "Clear the date" turns the countdown off.

B120. Amounts on Settings are typed in dollars and cents ("1,500.00",
      "1500", "$1,500.00"), read as whole cents, never through a
      floating-point number (0.1); percentages and days are whole numbers.
      What cannot be read is said on the sheet and Save waits. Whether a value
      makes sense (a split adding up to 100, a target's low end not above its
      high end, a real date) is the money math's to say; a refusal says why,
      in words, with what the split adds up to, and changes nothing.

B121. Before setup day there are no settings to change: Settings says so.


## Part B, added with your review of Settings (Oct 9). Tell me if any is wrong.

B122. Moving a sorting rule (A22). Move up and Move down are on the rule's
      sheet on Settings; the first rule of its kind has no Move up and the
      last no Move down. A rule moves one place among the rules of its own
      kind (purchases, money in, payments to people), past the next one of
      its kind; rules of other kinds stay where they are, since only rules
      of the same kind compete (B9). It does not ask first: moving it back
      is one tap. The change log says which way, past which rule, and its
      number now. After a move, what is waiting in review that either of
      the two rules is now the first match for is sorted, and what one
      cannot sort is named and stays waiting (13.2, A19); nothing already
      sorted moves.

B123. "It was not a payment to the old card" (A21) is only for a payment you
      marked as going to the old card from savings, in review (where it
      waits for savings or needs, A4) and on the list of the bucket it was
      sorted to. One marked from checking already offers what it was (A20,
      B110). It does not ask first: it can be marked again. For one marked
      from savings, its choices are exactly savings, needs, or this: to put
      it in Wants or split it, unmark it first. (Before, the money math also
      took Wants, a split, or a transfer with another account for it,
      undoing the marking without a word, though none was offered. A test
      this round found it; the money math now takes only what is offered.)

B124. Found by you (Oct 9), fixed with a test first: setting the mom rule
      while a payment to her waited, partly refunded, counted the full
      payment against the mom reserve and lost the refund. It now stays
      waiting exactly as it was (13.2, B73), and Settings names it before
      and after your yes. Worked example 34. The random test of the preview
      now refunds some waiting payments, and found the mistake on its own
      with the fix turned off. The simulated life now clears the mom rule
      and the paycheck rule now and then and sets them again while things
      wait, some of it refunded meanwhile, and checks what happens against
      the rulebook (2,000 simulated years). The other places that take a
      waiting item out and make it again from what the bank first sent were
      checked: marking for mom by hand and marking a transfer already refuse
      a partly refunded payment; undoing a marked transfer or "for mom"
      cannot meet a refund, since a refund is never matched to those; a
      deposit has nothing that can change after it arrives.


## Part B, added with Setup day (Phase 4, Oct 9). Tell me if any is wrong.

B125. Where Setup day is. Before setup day, Home says "Not set up yet" with
      "Start setup day". The five steps each have an address (/setup/bank,
      transfers, paycheck, assign, check), with Back and Next; the tab bar
      stays. Your answers are kept by the server until tracking starts, so
      leaving and coming back loses nothing. The demo keeps them in memory;
      the real server keeps them with the book's history (Phase 6, like B92).

B126. Every transfer with one side showing must be answered, "On its way" or
      "Not on its way", before tracking starts; nothing is assumed. One you
      say is not on its way stays history: it never reaches the book. Each
      shows the bank rule that read it as a transfer, and what saying "on
      its way" does to the starting money (plus what left, minus what
      arrived first, nothing for the old card, B48).

B127. The last paycheck (B42) can be any real day up to and including setup
      day. A day after it is refused: that paycheck has not come. A day long
      ago is allowed; the next payday then shows as late (B35).

B128. Handing out the starting money (14.2). Each bucket takes any amount in
      dollars and cents: zero, or below zero (B43, typed with a minus sign).
      "Put what is left here" adds what is left to assign to that bucket,
      worked out by the money math; when too much is assigned it takes the
      extra back out of it. The same amount again says "That is already the
      amount" and changes nothing (like B114). What is left is shown after
      every amount, from the server.

B129. Starting (14.3) asks first, and your yes names the last look you saw
      (like B113): if anything changed since, it asks again. It starts only
      when every transfer is answered, the last paycheck is in, it adds up to
      the cent, and the self-check passes. Otherwise it says what is missing,
      in words, with how much is left or too much ("$0.01 is still to
      assign"). Setup day happens once: after it, every new answer is
      refused, and the Setup day screens say it is done.

B130. After setup day, Home says what is still to set, the paycheck rule and
      the mom rule, with a way to Settings, for as long as either is not set.
      It is in Needs attention, after what waits in review: until they are
      set, your paycheck and payments to mom wait there.

B131. Tracking starts with the rulebook's starting settings (section 2): no
      paycheck rule, no mom rule, and no sorting rules yet. All can be set in
      Settings right after.

B132. Bank rules on Setup day: the ones that came with the bank connection,
      used as they are. The last look lists them, and each transfer names the
      one that read it. (Since Oct 9, suggested from the bank's labels and
      changed on Setup day and in Settings: B136 to B145.)

B133. A charge pending on the old card is shown with the old card, as part
      of its debt (12.4, A10), not in the list of charges that are part of
      the starting money.


## Part B, added with your answers to A25 and A26 (Oct 9). Tell me if any is wrong.

B134. How far back Setup day looks (A25). It starts at 10 days (section 2)
      and is changed on the transfers step: any whole number of days, 0
      meaning today only. A transfer exactly that many days old is asked
      about; one a day older is not. A smaller number drops your answers
      about the transfers it no longer asks about (they are history now),
      so looking further back again asks about them again, unanswered.
      The same number again says "That is already the setting" and changes
      nothing. It is part of Setup day, like your other answers there, so
      it is not on Settings: after setup day it has nothing left to do.

B135. A purchase or payment refunded in full while it waits (A26). It leaves
      review the moment the last cent comes back, whether the bank named the
      purchase or you matched the refund to it (A18); a refund one cent short
      leaves it waiting for that cent. It holds nothing back and is in no
      bucket's list, since it was sorted nowhere. If the bank takes back a
      refund (4.10), what is no longer refunded waits in review again, with
      a take-back alert (10.6) as for anything taken back. A purchase that
      was refunded in full while pending and then posts at a larger amount
      waits for the difference. One already sorted into a bucket and then
      refunded in full stays on that bucket's list at $0.00, as before
      (B98). The same goes for a payment to a person waiting in review: one
      refunded in full leaves review, so setting the mom rule does not see
      it (13.2).


## Part B, added with bank rules (Phase 4, Oct 9). Tell me if any is wrong.

B136. The labels. Plaid gives each item a label (personal_finance_category).
      What its test bank really sends was checked first (Oct 9, saved as
      test/fixtures/test-bank-labels.json): transfers between checking and
      savings are TRANSFER_OUT_SAVINGS, TRANSFER_OUT_ACCOUNT_TRANSFER and
      TRANSFER_IN_ACCOUNT_TRANSFER; a card payment leaving checking is
      LOAN_PAYMENTS_CREDIT_CARD_PAYMENT and arriving on the card
      TRANSFER_IN_OTHER_TRANSFER_IN; Zelle and Venmo out are
      TRANSFER_OUT_TRANSFER_OUT_FROM_APPS; card fees are BANK_FEES_LATE_FEES,
      BANK_FEES_FOREIGN_TRANSACTION_FEES and BANK_FEES_OTHER_BANK_FEES, and
      interest BANK_FEES_INTEREST_CHARGE. Only these suggest a rule, and only
      on the kind of account they fit (a fee on checking, money in from Zelle,
      a paycheck, a purchase suggest nothing). A label is only ever a
      suggestion: nothing about money is decided from it.

B137. What a suggestion says. The text is what the descriptions with that
      label share from the start, ending at a whole word ("Zelle payment to"
      for "Zelle payment to ANNA" and "Zelle payment to BEN"); if they share
      nothing, one suggestion for each first word. For a transfer, the other
      account is the one the history shows the other side on (the same
      amount the other way, the nearest day). One still on its way takes the
      other account of one with the same description whose other side shows.
      When none shows, the suggestion says to pick the account, Add waits,
      and "Change it first" picks it; such ones are suggested one description
      at a time, so one wider text never covers transfers to different cards.

B138. Each suggestion shows the label, the account, the text, what it means,
      how many items in the whole history it matches (with up to three,
      newest first), and your answer. Every one must be answered (added,
      changed, or skipped) before tracking starts. One your bank rules
      already read the same way says so and asks nothing. One you added can
      be undone by removing its rule; it then asks again. Skipping one you
      added is refused: remove its rule instead.

B139. Adding a suggestion as it is does not ask again: its matches were on
      its card. Changing it first asks, like any new rule (B140).

B140. Every change to a bank rule asks first, on Setup day and on Settings,
      with what it would have matched in the last 90 days (a number fixed
      for this preview, not a rule about money), up to three of them, how
      many a rule before it reads first, and how many it would take from a
      rule after it (A27). Removing asks first too, with what it reads. Your
      yes names the preview you saw: if what it would match changed since,
      it asks again (like B113).

B141. A bank rule is refused, in words, when it cannot be: no text, more
      than 200 characters, a transfer with the same account, money reaching
      a card from a card, a payment to a person from a card, a fee or
      interest on checking or savings, or the same rule as one you have
      (ignoring case). Changing one to what it already says is refused too.

B142. A new rule goes to the end of the list; a changed rule keeps its place.
      A rule's id is never used again for another rule, even after it is
      removed, since the change log and Setup day's answers name rules by it.

B143. From then on (24c). The bank connection reads each item with the bank
      rules as they are when it first reads it, and keeps what it read. A
      transfer or payment still pending when it is first seen is read when
      it posts, since only then does it go to the book. One the bank changes
      after it was counted is read again as the bank sends it (4.10). Before
      tracking starts, the whole history is read again with the rules as they
      are now, and a change drops your answers about transfers it no longer
      asks about (like B134). 300 random histories with random rules
      changing between syncs passed: nothing read before changed, and the
      self-check passed after every sync.

B144. The change log (13.5). Each change to a bank rule is one line, dated,
      among the other changes, in the order they were made, newest first.
      Changes made on Setup day come before anything in the book's own log.

B145. In the demo, a life that is tracking already has five made-up bank
      rules, and what a rule would match is read from what its made-up bank
      sent its book. A life not set up yet has its made-up bank's history,
      with labels. The life "setup-suggest" starts with no bank rules at all;
      "setup-day" starts with them set, so every suggestion there is covered.


## Part B, added with your answer to A27 (Oct 9). Tell me if any is wrong.

B146. Which rules a bank rule moves past (A27). Only rules on the same
      account can fit the same item, so a rule moves one place up or down
      among the rules on its account, past the next one there, and the two
      trade places in the list; rules on other accounts stay where they are.
      The first rule on its account has no Move up, and the last no Move
      down. Settings numbers the whole list, so a move can jump more than one
      number ("now number 3"). Worked example bank 5.

B147. A move asks first, like every other change to a bank rule (B140): it
      says how many items from the last 90 days a different one of the two
      rules would read first (moving up, the ones it would take from the rule
      it passes; moving down, the ones that rule would take from it), and
      what the rule would match in its new place. Your yes names that
      preview. A move reads what the bank sends from then on; what was
      already read stays as it was (24c). On Setup day, before tracking
      starts, the history is read again with the new order (like B143).

B148. The change log (13.5): "Bank rule moved up" or "moved down", with the
      rule, its number in the list now, and the rule it passed, dated, among
      the other changes in the order they were made.


## Part B, added with the real server keeping everything (Oct 9). Tell me if any is wrong.

B149. What is kept. Every answer that changes the book (sorting, splits,
      moves, payday answers, "this is my paycheck", settings, sorting rules
      and their order), each Setup day answer before tracking starts, each
      change to the bank rules, and each take-back marked seen. Each is one
      event in the book's history, after what the bank sent before it, with
      the day it was made on and the totals after it. A refused answer, a
      question that only asks first, and a preview are not kept.

B150. Decision numbers. Each is kept with its first answer, in the same step
      as its event: both or neither. A refused answer keeps nothing, so the
      same number can be sent again with your yes. Sent again after a
      restart, it gets its first answer back and changes nothing; a number
      already used for something else is refused.

B151. The replay check. The totals checked after each event are every
      bucket, the money waiting in review each way, the old card debt, money
      in transit, and how many items wait; before setup day there are none.
      A change that alters none of these (a rule's name, a setting's value)
      is not caught by it; the tests cover those. Events an older version
      saved without totals get them the first time they replay, and are
      checked from then on.

B152. When the bank cannot be read (0.5, B82): the bank wants you to log in
      again (10.5), or its balances cannot be worked out. Home then shows the
      last checked safe to spend. The last checked is saved each time Home
      shows a safe to spend the bank backed up, with the time in your home
      time zone.

B153. The home time zone on Settings offers the US zones by name (Eastern,
      Central, Mountain, Arizona, Pacific, Alaska, Hawaii); a zone set some
      other way is shown by its name. A change applies right away (13.1) and
      is logged. Nothing already dated is dated again. Before setup day, today
      is in New York, the zone tracking starts with.

B154. The real server: npm run serve. This computer only, Plaid's test bank
      only (the sandbox lock), no login yet. The books are in
      data/budget.sqlite (git leaves data/ out). --connect connects the test
      bank with made-up accounts like yours and sets the four accounts by
      their last four digits; --sync syncs once. (Since Step 3 it also syncs
      by itself, every 60 minutes: B167 to B172.) Setup day starts tracking with the settings in section 2, so the
      paycheck rule and the mom rule are set afterwards on Settings, as in
      the demo. The demo is separate and never opens the database.


## Part B, added with your answers to A28 and A29 (Oct 10). Tell me if any is wrong.

B155. What npm run replay-check shows (A28, 0.6). Every event whose saved
      totals differ from what it replays to now, in order, each with its
      number, its day, what it was ("his answer: sort", "from the bank:
      purchase ..."), and each total that differs, before and after, in
      dollars. After the first such event usually every later one differs
      too, since the buckets carry on; each is listed. It changes nothing
      until you type yes (exactly "yes"); anything else leaves everything as
      it was. Run it with the server stopped; it never talks to the bank.

B156. Your yes is for exactly what you saw (like B113): if the history
      replays to anything else by the time you answer, nothing is changed
      and it says to run it again. The new totals are saved for every event
      listed, all in one step, together with the change log line.

B157. The change log line (13.5): "History took new totals", dated today in
      your home time zone, with the first event that changed (what and its
      day), how many events changed, and what changed at the first one
      ("There: Wants $176.55 → $200.00, ..."). The line keeps every event's
      before and after in the database. It sits among the other changes in
      the order they happened. Totals edited by hand in the database are
      shown and taken the same way.

B158. Money in to checking only (A29): a deposit to savings is never a
      debit card refund, so it has nothing to match. A paycheck-looking
      deposit held back under 3.7 gets it too. The likely purchases are the
      same as for a card refund (20d, A15): on checking, made on or before
      the day the money came in, with at least that much not yet refunded,
      and the same name or the same amount. With none, nothing extra shows.

B159. A matched deposit becomes that refund (4.5): it is sorted nowhere
      else, it cannot be sorted again (asked again, it is refused the way a
      matched card refund is), and if the bank later takes it back (4.10),
      the refund is undone as for one the bank matched. One already sorted
      as payback can still be matched from its bucket's list, as A18 allows
      for a card refund; the payback is undone first.


## Part B, added with passkey login (Step 2, Oct 10). Tell me if any is wrong.

B160. What needs a login on the real server: every screen (Home, Buckets,
      Review, Settings, Payday, each bucket's list, the Setup day steps, and
      the bare address), every screen's numbers, and everything the screens
      send (his answers, a take-back seen, how often to sync with the bank). Without a login, a screen sends
      him to the login page and the numbers are refused (401, nothing of
      his). Open: the login page, the app's own files it needs (scripts,
      styles, icons: nothing of his), and the login's own addresses (whether
      he is logged in and whether a passkey exists yet; asking to log in;
      the one-time code). A test lists every address and checks each.

B161. The one-time code: 12 digits in three groups (1234-5678-9012), typed
      with or without the dashes (the phone's digit pad has none). npm run
      serve prints one in its own window when there is no passkey yet; npm
      run login-code prints one any time, on this computer. Only the newest
      code is good, once, for 15 minutes (at 14 minutes 59 seconds yes, at
      15 no). After 10 wrong codes in a row, no code is good until a new one
      is printed; a good code typed in between starts the count again (since
      Oct 10: before, 10 wrong ones in all voided it). A code makes a passkey on the device it is typed on, and
      logs that device in.

B162. Logging in: one passkey for this app, checked with Face ID, Touch ID,
      or the computer's own check (the check is required). Each login
      question can be answered once, within 5 minutes. A passkey whose use
      count goes backwards (a copy) is refused. Passkeys are made for the
      app's host name: on this computer, http://localhost:5190 (npm run
      serve prints it); http://127.0.0.1:5190 sends you there. The phone
      gets its own address with hosting (Phase 6).

B163. Staying logged in (section 2): 30 days on a device from when you
      logged in, then the login page again. A setting on Settings, a whole
      number of days from 1 to 365; a change applies right away to every
      device logged in (13.1) and is logged. Log out (Settings) ends the
      login on that device only.

B164. Another passkey (Settings, "Add a passkey"): only logged in, it asks
      first, and the passkey is made on the device you are using. The same
      passkey cannot be added twice. Removing a passkey is not built yet.

B165. The change log (13.5): "Logged in", "Logged out", "Passkey added"
      (each with the device in words, such as "Safari on iPhone") and "Stay
      logged in" (before → after), dated, among the other changes in the
      order they happened. Not logged: a wrong code or a refused passkey.

B166. Kept in the database: his passkeys' public keys only (the private key
      never leaves his device), each device's login only as a hash (the
      login itself is only in that device's cookie), and the one-time codes
      only as a hash. The cookie is HttpOnly and SameSite=Strict, for the
      whole app; Secure once the app has a https address (Phase 6). Every
      POST must come from the app's own address, or it is refused.


## Part B, added with syncing on a timer (Step 3, Oct 10). Tell me if any is wrong.

B167. How often (section 2, 27d): a whole number of minutes, 15 to 1,440
      (once a day), 60 to start. On Settings, real server only, in a Bank
      card with when it last read the bank. A change applies right away
      (13.1) and is logged ("Sync with the bank: every 60 minutes → every 30
      minutes"). The demo has no bank, so it has no Bank card.

B168. When a sync is due: one interval of real time after the last sync
      started, whether it worked or not, so a clock change never moves it.
      Across Nov 1 the syncs come at 1:30 AM EDT, then 1:30 AM EST; across
      Mar 14 at 1:30 AM EST, then 3:30 AM EDT. When the server starts, one
      interval after the last time it read the bank: due by then, it syncs
      at once; one that never read the bank syncs at once. With no bank
      connection yet there is nothing to sync, and it looks again each
      minute. It sleeps at most a minute at a time, so a computer waking up,
      or a shorter setting, is noticed within a minute.

B169. What a sync asks the bank: /transactions/sync, /accounts/get and
      /liabilities/get, as --sync always did; never /transactions/refresh. A
      test checks every call over a simulated day, and that nothing in the
      server makes that call. Never two syncs at once: the timer and --sync
      share the books' own lock; asked again while one is on its way, it is
      that one.

B170. A sync that fails (the bank cannot be reached, or answers something
      the app cannot read) saves nothing: not the bank's activity, not where
      the next sync starts, not Checked at. The next one is one interval
      later. When the bank wants you to log in again (10.5), the sync keeps
      only that, as before: Home says so, shows the last checked safe to
      spend (0.5), and Checked at stays at the last read.

B171. Checked at: the moment the last sync read the bank, whether or not it
      brought anything new, saved with what the sync saved, in the same step
      (database step 4). Home shows it under safe to spend, in your home
      time zone: "Checked at 3:05 PM" on the same day there, "Checked at Fri,
      Oct 9, 3:05 PM" on another. Nothing shows before the first read. The
      "As of" time of the last checked safe to spend (0.5) is now shown in
      your home time zone too (it was the phone's), so the two never
      disagree. The demo shows a made-up time, this morning.

B172. A sync and your answers never write at the same time. An answer that
      comes while a sync is reading the bank is saved first, and the sync's
      save works from it. The sync's save and the books in memory reading it
      again are one step, so an answer after it is given to the book with
      the sync in it. Found while building this: before, an answer arriving
      the instant a sync had saved could be saved against the book from
      before the sync, with totals that do not replay, and the server would
      then not start (0.6). A test now sends one at exactly that moment.

B173. How the screen says what it showed (A31): each item on Review, on
      Payday and on a bucket's list comes with a short fingerprint of what
      it is, and the tap sends it back. A refusal for a change says how it
      is now, the sheet closes, and the screen asks for its numbers again.
      The same decision number can be sent again after it (B150: a refusal
      keeps nothing). The demo works the same way; it has no syncs, so
      there nothing changes under a screen.


## Part B, added with Phase 4's finish line (Oct 10). Tell me if any is wrong.

B174. Money on its way between your accounts is listed on Buckets (12.5,
      B44). Found by the agent: it was shown nowhere. Each transfer with one
      side showing is a row, "On its way": where it is going, its amount,
      the day it left (or the day it reached the other account first, before
      it showed leaving), and for one to the old card, that it is not part
      of the check with your bank (12.4). Home's check sheet still shows the
      total the check counts. A row goes when its other side shows.

B175. Payday and Home's "Money for savings" sheet show what is on its way to
      the savings account, next to what the account holds and what is still
      to move, so the numbers add up on the screen (3.8, B46). Found by the
      agent: Payday said "The account already holds what it should" while
      $2,350.00 was still on its way. When what is on its way covers the
      rest, Payday now says "Nothing more to move: the rest is on its way to
      the account." Money that reached savings before it showed leaving is
      in the account already, so it is not shown as on its way.

B176. A purchase made on payday itself is not "made before payday" (3.4,
      B4): it does not lower a payday question, and it is on the new pay
      period's lists (B97). The agent asked: the cafe charge on Oct 2, the
      day of the paycheck, did not lower the wants question.


## Part B, added with your answers to A32 and A33 (Oct 10). Tell me if any is wrong.

B177. A33, "most of his purchases": the purchases on the refund's account
      dated on the refund's day or in the 90 days before it (so a purchase
      exactly 90 days before counts, one 91 days before does not), each
      counting a word once however often it is written. A word on more than
      half of them is not a name; on exactly half it still is. Purchases
      after the refund, and purchases on his other accounts, do not count.
      One thing that follows: with only one purchase on that account in
      those days, every word it has is on all of them, so nothing there is
      "the same name"; it is still listed when it has exactly the refund's
      amount left. The five, and the 90 days, are fixed in the money math,
      not settings, though 4.5 now names them (0.2): say if you want them on
      Settings. Worked example 40 now has two other debit card purchases
      first, so the shoes are still "the same name" there; its numbers are
      as before. The older tests that failed because all their purchases
      were at one store (A33 now reads its name as words on most purchases:
      7 in the money math, 5 in the server) each got a purchase or two at
      other stores; none of their checks changed.

B178. A32, what the screens do: Review, Payday and each bucket's list
      remember each item's key as they show it. When the screen reads its
      numbers again (coming back from the background, after an answer, or
      Try again) and an item's key is not the one it showed, its card says
      "Changed: now $21.50, posted" (a payday question: "Changed: now
      $612.44"; a row on a bucket's list: a "Changed" label), and its
      buttons, its row, and its sheet take no tap for a second. The words
      stay as long as the screen shows the item. An item he answered
      himself is not marked: its change is his own. The second is fixed in
      the screens, not a setting, though 13.7 now names it (0.2): say if you
      want it on Settings. A tap that comes too early does nothing at all:
      the button is greyed while it holds, and no request is sent.


## Part B, added with Phase 5, part one (Oct 10). Tell me if any is wrong.

B179. The overdue alert (9.4, B30) comes every evening after the due date
      while the payments since the statement add up to less than the
      minimum, at the daily review time (A34), once each evening. It is for
      the latest statement of each card the bank has sent: once a new
      statement comes, the old one is not reminded about any more.

B180. "Once" is kept by a name for each alert: needs low in pay period 3,
      the daily review of Oct 12, the 7-day reminder for the everyday card's
      Oct 23 due date, the take-back of one transaction, the 2nd time the
      bank wanted a login. What went out is in the book's history (an
      "alerts" event, with each alert's words and when it came due) and in
      the outbox, saved in one step. A history that gives the same alert
      twice, or handles an evening out of turn, does not replay, and the
      server does not start (0.6). The alerts start with the first look on a
      database (right after setup day): take-backs already there then get no
      alert, and evenings count from then on.

B181. Sending: each alert is tried, the oldest first; one that fails is tried
      again after 1 minute, then 2, 4, 8 and so on, never more than an hour
      apart, and never given up on. Every try of an alert has the same id, so
      a try the server could not mark as done (it stopped in between) is
      shown on the phone once. Until the phone gets them (web push, later in
      Phase 5), npm run serve writes each alert in its own window, and that
      counts as sent.

B182. The evening is the daily review time on the clock in his home time
      zone, whatever the clocks did (8:00 PM EDT before Nov 1, 8:00 PM EST
      after). A time the clock shows twice (1:30 AM on Nov 1) is the first of
      the two; one it skips (2:30 AM on Mar 14) is the moment it jumps (3:00
      AM). Changing the review time moves the next evening at once.

B183. The list of alerts sent (his point 4): Settings has a row "Alerts
      sent" (on the real server only: "12 alerts, all sent", or "1 not sent
      yet"), which opens the list, newest first: each alert's words, then
      "Due 8:00 PM, sent 8:00 PM", or "Due 8:00 PM. Not sent yet: tried 3
      times, trying again at 8:07 PM." Times are his home time zone's, with
      the day when it is not today. It shows the newest 100 and says so when
      there are more. It only reads: nothing on it can be tapped but Back.

B184. The take-back alert (10.6) says the day the bank took it back
      ("MADE UP CAFE, $11.50, taken back Sat, Oct 3."), the same day Home's
      sheet calls "When". It used to say "from Sat, Oct 3", which read as the
      day of the purchase.


## Part B, added with your answers to A34 to A39 (Oct 11). Tell me if any is wrong.

B185. ANSWERED Oct 11, built, changed. Your answer: the line saying it is
      late does not use "Due" again, and a late card reminder counts the
      days from the day it is sent (rulebook 9.7, 10.8, 31a). An alert that
      goes out later than the minute it came due says when it was due, on
      his clock: "Was due 3:10 AM." on the same day, "Was due Fri, Oct 2,
      9:55 PM." on another. That is held for quiet hours (10.8), worked out
      when the server is back (10.9), and tried again after the phone could
      not be reached. One sent in the minute it came due says nothing more.
      A card reminder sent on a later day than its own says the days left
      then: the 7-day reminder for Oct 10, sent Tue Oct 6, says "due in 4
      days"; sent on the due date, "due today". Only one the phone could not
      be given until after the due date goes then (B181: never given up on),
      and it says "was due yesterday" or "was due 3 days ago". The list of
      alerts in the app keeps the words as they were when the alert came
      due, with when it was due and sent. Built before: "Due 3:10 AM.", and
      the days counted from the reminder's own day.

B186. "Still true" when the server is back (10.9, A36), for each kind:
      - the daily review: something waits in review now; it says how many
        wait now, and is due at the newest evening it missed;
      - one reminder per card (a reminder and the overdue alert are one
        kind): the newest one that came due; a reminder goes only if the card
        is still due today (9.6: from the first reminder day to the due date,
        not paid enough), the overdue alert only if it is still overdue. Back
        the morning after the due date, the 2-day reminder is no longer true,
        and the overdue alert comes that evening;
      - "totals do not match" and "log in again" (A37): once, for the newest
        evening, if still true;
      - the bank not read for a day (10.7): it goes when the server is back,
        due when it came due.
      Each keeps its own due moment, and a reminder counts its days from the
      day it is sent (your answer, B185): Oct 3's 7-day reminder for Oct 10,
      sent Tue Oct 6, says "Everyday card payment due in 4 days" and "Was
      due Sat, Oct 3, 8:00 PM.". The same rule handles one evening missed and
      several: with one, it is that evening's alerts, as before. Example 14.

B187. "Once a day" for 10.4 and 10.5 (A37): told when it starts, at once;
      then at the daily review time on each later day it lasts. A day it
      started on gets no second one that evening (started at 3:00 AM or at
      7:55 PM: nothing more at 8:00 PM). The repeat says the difference then
      ("Your totals still do not match the bank"; "The bank still wants you
      to log in again"). While the bank cannot be read (it wants a login),
      the mismatch is not repeated, as it is neither told nor cleared then;
      the login alert is. After it stops and starts again it counts from
      the 1st again.

B188. Quiet hours (10.8, A35): nothing at all is sent in them, so a send
      that failed before 10:00 PM is not tried again until 7:00 AM either.
      The setting in force when an alert is sent counts: changed to end
      earlier, what waits goes then. What waits goes at 7:00 AM even if it is
      no longer true by then (a login wanted at 3:10 AM and fixed at 6:30
      AM, say), saying when it was due: 10.8 says it waits, not that it is
      dropped. Two times on his clock, in his home time zone; the same time
      twice means no quiet hours. On Settings, "Quiet hours", with From and
      To. The list of alerts says "Waits for quiet hours to end at 7:00 AM."

B189. The bank not read (10.7, A38): due at the last good read plus the hours
      of the setting (24 to start), to the minute. A good read is a sync
      that reached the bank (one that failed, or found the bank wanting a
      login, is not). Told once; again only after a newer good read, so
      making the setting longer while it is told does not tell it again.
      Before the first read there is nothing to count from, and no alert.
      The words: "The bank has not been read for 24 hours. Last read Sat, Oct
      3 at 6:00 PM. Your numbers may be out of date until it is read again."
      The setting is whole hours from 1 to 168 (a week), on Settings as
      "Bank not read".

B190. The lock screen (10.10, A39): with the setting off, each alert's words
      without its amounts: "Needs is low. Open the app to see what is left
      this pay period." "Everyday card payment due in 7 days. Due Fri, Oct
      23." "Your totals do not match the bank. Safe to spend is hidden until
      they match." "MADE UP CAFE, taken back Sat, Oct 3." The count in the
      daily review is not an amount and stays. The list of alerts in the
      app always has the amounts. The setting in force when it is sent
      counts. On Settings, "Amounts on the lock screen", off ("words only")
      or on. Until the phone gets them (web push, later in Phase 5), npm run
      serve writes them in its own window, as it did.

B191. The three new settings (quiet hours, the bank-not-read hours, amounts on
      the lock screen) are kept with the others in section 2: changed on
      Settings like any setting, in force at once (13.1), each change in the
      change log (13.5).

B192. Review, the bucket lists and Payday (Step 1 of this chunk, as B92 did for
      Setup day): after an answer went through, their buttons stay off until
      the numbers asked for after it are shown. Before, a second tap in that
      moment sent a second decision (refused by the server as already dealt
      with, so the books changed once, but two requests went). His PC found
      it under full load in WebKit (Oct 11).


## Part B, added with the phone (Phase 5, Oct 11). Tell me if any is wrong.

B193. Raising the low alert level (10.1) above where a bucket stands sends
      the low alert right then, once for the pay period, as any setting other
      than the split and the mom reserve applies at once (13.1). Raised to
      exactly where the bucket stands, nothing comes (below means strictly
      below, B57). Lowered and raised again in the same pay period, it does
      not come a second time. Found by the simulated life (seed 1507): the
      money math and the server already did this; the simulator itself
      checked the alerts after the change with the old level, and now changes
      its own record with the book's.

B194. After a sheet closes, the screen takes no tap for half a second (found
      by the Settings test "B92 a double tap on Save sends one decision",
      WebKit, CI Oct 11; a real bug, not the test). A sheet closes the moment
      its answer comes back, and the second tap of a double tap then landed
      on whatever was under it: a Settings row, which opened another sheet
      and took the "saved" message away, or the Review tab; on Review and a
      bucket's list it could land on another item's card. An invisible cover
      over the whole screen now takes those taps, on every sheet (the
      sheets are one shared block). It is shorter than 13.7's "about a
      second" because a double tap is quicker than reading a change. A tap
      a person means for the screen within that half second does nothing,
      and he taps again.

B195. How an alert reaches the phone (Phase 5, the phone): web push, through
      the web-push library (3.6.7), the usual one for Node. Each alert is
      encrypted on the server for that phone alone (RFC 8291) and the
      request is signed with the app's own key (VAPID, RFC 8292), which is
      what Apple's push service asks of a home-screen app. The private key
      is only in the server's environment (VAPID_PRIVATE_KEY; npm run
      push-keys makes a pair; .env.example has the names only). The phone
      is given the public key alone. The server sends only to a push
      service's own address (Apple's, and Chrome's, Firefox's and Edge's
      for a browser on his computer), checked when a phone turns
      notifications on and again before each send.

B196. What one push carries: the alert's id, its title and line, when it
      was due if it went late (B185), and the screen a tap opens. With
      "amounts on the lock screen" off (10.10) the words are the ones
      without amounts, so no amount leaves the server. A push service keeps
      an alert for a phone that is off for a day at most; a phone off for
      longer does not get them when it is back on, and they are all in the
      list in the app (Settings, Alerts sent). Each alert has its own topic,
      so a second try waiting at the push service replaces the first.

B197. With no phone that has notifications on, an alert is not sent: it
      waits in the outbox and is tried again like any failed send (B181),
      and goes once a phone turns them on: of what waited, the newest of
      each kind, if still true (A40, B202).
      With two phones, each alert goes to both; if one fails it is tried
      again for both, and the one that had it already shows it once (A42).

B198. A phone whose push service says its subscription is gone (it answers
      404 or 410) is taken off and logged in the change log ("Notifications
      stopped on Safari on iPhone"). Its card says: "Off on this phone. They
      stopped Oct 12: this phone's push service would not take them any
      more. Turn them on to start again." Any other answer is a failure,
      tried again later, and the phone stays on. So is a phone that turned
      them on under push keys that have since been replaced (npm run
      push-keys makes a new pair): its push service turns each alert away
      until he turns notifications on again there.

B199. The Notifications card on Settings (real server only, like the Bank
      card), in words: "On for this phone" (since when, and how many other
      devices get them), "Off on this phone", "Blocked in the phone's
      settings" (how to allow them), "Open the app from the home screen
      first" (iPhone sends notifications only to home-screen apps), "Not on
      this address" (they need https, so they work once the app is hosted),
      "This browser can't show them", and "Not set up on the server" (no
      push keys: npm run serve then writes each alert in its own window, as
      before). Turn on asks the phone only from his tap. Turning on, off,
      and a push service stopping them are each a line in the change log.
      Logging out on a phone turns its notifications off with it.

B200. "Send a test alert" goes to this phone only, at once, even in quiet
      hours (he asked for it), and is not one of the rules' alerts: it is
      not kept in the history, the outbox or the list. Its words have no
      amounts: "Test alert. Notifications are on for this phone. Alerts
      come like this one." A tap on it opens Settings.

B201. A tap on an alert opens the screen it is about: Review for the daily
      review, the bucket's list for low and empty, Home for a card, the
      totals, the bank and a take-back; one kept before the outbox kept
      each alert's facts (database step 6) opens the list of alerts. An
      address that is not one of the app's own screens opens Home.


## Part B, added with your answers to A40 to A42 (Oct 12). Tell me if any is wrong.

B202. Alerts the phone could not be given (10.9, A40). "Waited for the
      phone" means tried at least once and not sent: the push service could
      not be reached, or no phone had notifications on (B197). The kinds, of
      which only the newest goes: one daily review; one per card (a reminder
      and the overdue alert are one kind, as in B186); each bucket's low
      alert and its empty alert, each a kind of its own; one of each lasting
      alert (totals not matching, the bank wanting a login, the bank not
      read). Each take-back is its own kind, as each is something the bank
      did, so every one goes. "Still true" is checked at each look while it
      waits, with the books as they are then: the daily review, something
      waits in review now; a card, as B186 says; low or empty, the bucket is
      at that level now in that same pay period; a lasting alert, it is still
      on, the same time it started; a take-back, always. The newest of a kind
      that is no longer true is dropped at once, with the older ones of its
      kind that waited: "Not sent: no longer true." Older ones wait behind
      the newest ("Not sent yet: only the newest of its kind goes.") and are
      marked "Not sent: a newer one went." the moment it reaches the phone.
      What only quiet hours held (never tried) still all goes at 7:00 AM, as
      B188 says. The daily review that goes keeps the count it was made with,
      and says when it was due. Tries are an hour apart after a while (B181),
      so the newest goes at its next try, not the moment the phone is back.
      Settings' row: "12 alerts, 10 sent" when some never went.

B203. A phone's notifications after its login ends (10.11, A41). The login
      page sends the address of the phone's own push subscription with the
      login, asked after the passkey step so nothing comes between his tap
      and Face ID. If another login has notifications on at that address
      (the same phone, logged in before), they move to the new login in the
      same step as the login is saved, and keep the day they were turned on
      ("On for this phone. Since Oct 3."). An address no other login has
      moves nothing: one turned off there, or logged out there, stays off
      (logging out takes them away, B199). There is no line in the change log
      for the move; the login has its own line. A phone whose browser cannot
      say its address logs in as before, and its card says "Off on this
      phone. 1 other device gets them." until he taps Turn on.

B204. What the phone keeps (10.12, A42): in the service worker's own storage
      (IndexedDB, database "budget-alerts-shown"), the id of each alert it
      showed, the newest 500, and nothing else: no words, no amounts. Looking
      an id up, adding it and dropping the oldest past 500 is one step, so
      two at once cannot both count as new. If that storage cannot be used
      (a private window, the phone short of space), the alert still shows,
      and a repeat is caught only while the worker runs or while the first
      one is still on the screen, as before. Rule 0.4's test allows that one
      database in the service worker only; every screen still keeps nothing.
      Tested in Chromium and WebKit by running the built worker twice in a
      page (Playwright cannot hand a real worker a push); only a real iPhone
      can show it on the phone itself (Phase 6).


## Part B, added with hosting (Phase 6, Oct 12). Tell me if any is wrong.

B205. The hosted address is https://budget-app-x7q2.fly.dev (fly.toml: the
      app's name and APP_ORIGIN, which a test keeps the same). It is the only
      host name the server answers to and the only Origin it takes a POST
      from; localhost and 127.0.0.1 are refused there too. A request Fly's
      proxy did not take over https is sent to the https address (GET and
      HEAD, 308) or refused (anything else, 403). Every answer says "https
      only, for two years" (HSTS, max-age 63072000, includeSubDomains; not
      preload, which a fly.dev name cannot have). The login cookie is Secure,
      HttpOnly, SameSite=Strict. The headers the screens already had stay, and
      Cross-Origin-Resource-Policy: same-origin is added.

B206. /health answers GET and HEAD with no login, under any host name (Fly's
      own check comes from inside, under the machine's address), over https
      or not. "ok" (200) when the server can read its books, "not ok" (503)
      when it cannot; nothing else, ever. It does not look at the bank (the
      app's own alerts do, 10.5, 10.7) or the backups (A43).

B207. Hosted, the server never writes a one-time code in its log (Fly keeps
      the log). With no passkey yet it says how to get one: fly ssh console
      -C "node /app/serve/login-code.mjs", which shows it in your own window.
      The code is the same as npm run login-code's: 12 digits, once, for 15
      minutes (B161).

B208. The first start connects Plaid's test bank with made-up accounts like
      yours, by itself (--connect-once), after the server is up and before
      its first sync. If that fails it is in the log, and the next start
      tries again. It never connects a second time. In Phase 7 the real
      connection replaces this.

B209. When the volume has no books (the first start, a new machine, a lost
      volume), they are rebuilt from the backup before anything starts. With
      no backup yet, they start empty. If the backup cannot be read (R2 down,
      a wrong key), nothing starts, so empty books never cover the backup:
      Fly starts it again (up to 10 times, fly.toml).

B210. The backups: Litestream copies each change to R2 within a second, and
      a full copy once a day, kept for 30 days. The hosted server does not
      start without a backup set. The bucket's key is given to Litestream
      only, not to the server; the bank key, Plaid's keys and the push keys
      are given to the server only, not to Litestream.

B211. Only one machine. Before anything starts, the server asks Fly's private
      DNS which machines the app has started (vms.<app>.internal). With two
      or more, nothing starts on any of them (all are down until you remove
      the extra one; the uptime monitor tells you), and the log says how. If
      Fly's DNS cannot be asked, it starts, and says so in the log.

B212. On the machine, the supervisor (start.ts) keeps Litestream running: if
      it stops, it is started again after 5 s, then 10, 20, 40, and every
      minute after (from 5 s again after 10 minutes running well), each time
      in the log. The server is not started again if it stops by itself: it
      stopped for a reason (the history does not replay, 0.6; a wrong
      secret), the log says what to do, Litestream keeps copying, and the
      uptime monitor sees the app down. A stop from Fly stops the server first
      (up to 20 s), then Litestream (up to 35 s), so the last answer is saved
      and then copied; fly.toml gives it 60 s.

B213. What is in Fly's log: what the server always wrote (syncs by counts,
      Plaid's answers by status, phones by their kind, such as "Safari on
      iPhone"), Litestream's own lines (they name the bucket and its address,
      which holds your Cloudflare account's id, never its key), and, without
      push keys, each alert's title only, never its words (they can hold
      amounts: 10.10). Every key the server is given is hidden if it ever
      turned up.

B214. The restore check rebuilds into a new file, in the machine's temporary
      folder unless told another (fly ssh console -C "node
      /app/serve/restore-check.mjs"); that folder is emptied when the machine
      restarts. It never touches the live books, refuses a file that is
      there, and checks the copy with SQLite's integrity check and the replay
      check (0.6). It cannot run on Windows (Litestream cannot restore
      there), so on your PC it says to run it on the server.


## Part B, added before Phase 7 (Oct 12). Tell me if any is wrong.

B215. The backups' health (A43): Litestream calls the server once a minute
      while every copy goes through. After the copies stop it can still call
      once more, up to about 75 s later (seen at 59 s), so /health/backups
      says "not ok" about 11 minutes after the copies stop, and the monitor
      sees it within its 5 minutes after that. With nothing to copy (no
      change in the books) it keeps calling, as there is nothing behind; the
      books change at least once an hour (each sync notes its read). At a
      start Litestream gets the same 10 minutes before its first call. The
      call is taken only from the machine itself, never through Fly's proxy.

B216. Connecting (1.1) happens on the Bank screen (/bank), opened from
      Settings (Bank card, "Bank connection") and from Setup day's "can't
      start yet" screen. That page is always loaded as a page of its own:
      its rules let Plaid's login in (Plaid's script from its own address
      with a fresh nonce, its frame, its styles, and the bank in use), and
      the bank's own login may open in a window of its own. Every other page
      keeps the strict rules. The screen says it is best done on a computer.

B217. "Nothing is read from the bank until all four are picked" (1.2): no
      transactions, balances or statements are read, and no sync is due.
      The list of the bank's accounts is read once when connecting (and
      when logging in again), so there is something to pick from; only each
      account's name, last digits and kind are shown.

B218. Which account is which (1.2) can be picked again any time before
      tracking starts, each time asking first; picking an account for a
      second of the four takes it off the first. Once setup day is done it
      cannot change. Each pick is in the change log by name and last digits.

B219. Right after the four are picked, and right after logging in again
      (1.3), the bank is read at once, not at the next hourly sync. While
      Plaid is still sending the history, the Bank screen says so and has
      "Look again" (it reads the bank now); setup day waits for it.

B220. If Link closes without logging in, or fails, nothing is connected and
      the screen says so. If the bank's accounts cannot be read right after
      connecting, the connection is kept all the same, and the screen offers
      "Read them now".

B221. The connection is kept the moment Plaid hands it over: sealed, in one
      step with its change log line. A second answer from Link while one is
      being kept (a double tap) is refused, never exchanged, so a second of
      the 10 can never be used by the app.

B222. The bank's permission end date (10.13) comes from Plaid with every
      sync (/item/get, consent_expiration_time), kept as Plaid gives it, and
      shown on the Bank screen as your date in your home time zone. A bank
      that gives none shows none and is never warned about.

B223. The warning (10.13) is told at the daily review time on the evening
      the setting's days before the end date (7 to start, 1 to 60), once
      for each end date. If the server was down then, or learns the date
      with fewer days left, it is told at the next daily review time, if
      the permission has not run out by then (10.9). After logging in again
      the date moves, and a warning still waiting for the phone is not sent
      ("no longer true"); the new date gets its own warning in its time. A
      tap opens the Bank screen. It shows no amounts, so the lock screen
      setting does not change it.

B224. History at connection (A44): 90 days, Plaid's default, asked for once
      when connecting (days_requested 90). Logging in again asks for no
      products and no history: the same connection.


B225. The rehearsal (npm run rehearsal, Oct 12): on the Bank page the
      browser's console shows one style refused by the page rules. It is
      Plaid's script testing whether a style with no nonce works (it does
      not, on purpose); the style Link itself uses carries the page's
      nonce, and Link opened and closed normally. The console also shows
      the 422 of "Connect the bank" before the yes: the server refusing
      until you say yes (1.1), which is what makes the screen ask.


## Part B, added on connection day (Phase 7, Oct 12). Tell me if any is wrong.

B226. Found on setup day: a card payment still pending was read as a
      purchase. The bank words a pending payment differently from the posted
      one ("PAYMENT TO ACCT #nnnn ON mm/dd VIA WEB" against "Mobile Banking
      payment to CRD nnnn Confirmation#"), so the bank rule made from the
      posted wording did not fit it, it counted as a pending charge (14.2),
      and the starting money came out low by its amount. Fixed on the day
      with bank rules for the pending wording on checking, one per card;
      the starting money then matched his own sum to the cent. Still to do,
      a test first: setup day should point out a pending item the bank
      labels as a card payment or a transfer that is being read as a
      purchase, and offer a rule for its wording.
      BUILT Oct 15 (branch webhooks-and-payday): B241.

B227. The suggestions covered the leaving side of each card payment but not
      the arriving side ("PAYMENT FROM CHK nnnn" on each card, money in): the
      bank labels it with a label the suggestions do not know. Without a rule
      it reads as a refund. He added one on each card by hand; each matched
      exactly the payments from checking. Still to do, a test first: suggest
      it from the history (the same amount the other way, a day or so later).

B228. His paycheck was split by his employer, part to savings and part to
      checking. The rulebook knows one deposit per paycheck: the first would
      have been the paycheck and the other held in review (3.7). His call:
      all of it to checking from now on (the Payday screen says how much to
      move to savings, 3.8). Until that takes effect, the paycheck rule stays
      unset, and a split payday is answered in review: the checking part
      "this is my paycheck", the savings part "other income" (the reserve
      once, then the split of all of it, 6.1).

B229. The mom rule is "Zelle payment to Mom", not "Mom": the rule matches
      text anywhere in a payment to a person's description, ignoring capitals,
      so the longer text cannot catch another name or a confirmation code
      that happens to contain the word.

B230. Oct 13, 9:34 AM: the "totals do not match" alert (10.4) for a gap
      that was Plaid's timing, not the books. The everyday card's balance at
      the bank already showed the card payment and some charges as posted,
      while Plaid's list of transactions (unchanged since connecting) still
      had them pending, so the bank side was ahead by the difference. It
      clears when Plaid sends the posted items. Whether to tell such a gap
      only once it has lasted a few syncs is his call (docs/later.txt 3).

B231. Oct 14: the second gap, the other way round. Every pending checking
      item posted (Plaid sent them as posted), but the checking balance the
      bank calls posted ("current") did not include them yet: it only takes
      them in its overnight processing. Its "available" balance did, and with
      it the books matched to the cent. The bank side counted them nowhere
      (not pending any more, not in the balance yet), so it came out high by
      their sum. This will happen most days things post. His fix: A47.

B233. The payday alert (10.14) is once per paycheck: keyed by the pay period
      the paycheck began, and given at the first look after it is counted
      (the sync that brought it, "this is my paycheck" in review, or setting
      the paycheck rule while it waited). Two paychecks counted before one
      look: one alert, for the newer. A paycheck taken back (4.10) keeps its
      pay period, so nothing more is told. Its amounts are what Payday and
      Home show at that moment: what is still to move to savings (3.8, money
      on its way counting as moved), the extra when the account holds more,
      and the old card's share as the payoff countdown says then (9.5). With
      the bank not readable, it says to open Payday once the bank can be read.

B234. A history kept before the payday alert existed (his real books): the
      first look after the deploy notes the pay period then and tells
      nothing, so a paycheck counted before the deploy never gets a late
      payday alert. The next paycheck is told.

B235. Words, lock screen and app (10.10): the title is "Payday". With
      amounts: "Move $1,234.56 to savings. Old card: $600.00 this payday."
      ("Nothing to move to savings." or "... it holds $X more than it
      should." when nothing is to move; "Nothing is owed on the old card."
      when the countdown is on and nothing is owed). Without: "Open Payday to
      see what to move to savings and pay on the old card." A tap opens
      Payday. Of payday alerts that waited for the phone, only the newest goes
      while its pay period lasts (10.9).

B236. Webhooks are a trigger only (A47): the app syncs and reads from the
      bank itself; nothing in a webhook is taken as money. What syncs:
      TRANSACTIONS SYNC_UPDATES_AVAILABLE; ITEM ERROR, LOGIN_REPAIRED,
      PENDING_DISCONNECT, PENDING_EXPIRATION, USER_PERMISSION_REVOKED,
      USER_ACCOUNT_REVOKED, NEW_ACCOUNTS_AVAILABLE (the sync reads the login
      state, 10.5, and /item/get's permission end date, 10.13); LIABILITIES
      DEFAULT_UPDATE (new statements). WEBHOOK_UPDATE_ACKNOWLEDGED is noted in
      the log. TRANSACTIONS' older codes (INITIAL_UPDATE and the rest) and any
      other type do nothing: the app reads with /transactions/sync only.

B237. A burst of webhooks makes one sync: the sync starts 2 seconds after the
      first, so the rest of the burst is in it. Webhooks while a sync is on its
      way make exactly one more after it. One that waits on the timer's sync
      starts its own after it, so what Plaid has now is read. Never two syncs
      at once (the books' lock).

B238. What is refused, and how: no or a bad signature, too old (over 5
      minutes) or made over a minute ahead of the server's clock, a body that
      is not the one signed: 401. Another connection's webhook, or one before
      there is a connection: 403. Plaid's key not to be had (Plaid out of
      reach, or more than 10 unknown key ids asked about this hour): 503, so
      Plaid tries again later. More than 30 calls a minute: 429. Not POST:
      405; not JSON: 415; over 8 KB: 413. The same signed call again within
      its 5 minutes: 200, and nothing more is done. Plaid stops sending after
      24 hours of failures; the hourly sync goes on regardless.

B239. Plaid's keys are kept by key id; one kept a day is asked for again, so
      a key Plaid has since let expire is seen to be. A key id Plaid says it
      never made is not asked about again for an hour.

B240. Where webhooks go: a new connection's link key carries the hosted
      address (https only; on this computer none, Plaid cannot reach it).
      Logging in again (1.3) keeps the connection's own address. His existing
      connection is pointed at it once, at his word, with
      fly ssh console -C "node /app/serve/webhook-address.mjs": one
      /item/webhook/update call on the same connection, nothing new made,
      nothing read; refused unless the address is the hosted https one ending
      in /plaid/webhook. Checked against Plaid's real test bank
      (live/webhooks.live.ts): an unknown key id is Plaid's INVALID_INPUT
      (INVALID_WEBHOOK_VERIFICATION_KEY_ID), and the address is taken for the
      same connection.

B241. B226 as built. A pending item the bank labels as a card payment or a
      transfer (or a payment to a person), which his bank rules read as a
      purchase now, is pointed out on Setup day: its suggestion is for the
      item's wording (the words before the first one holding a digit or #,
      with its own spacing: "PAYMENT TO ACCT"; all of it when it starts with
      a number), and the card says "Pending now, and read as a purchase until
      a rule fits it" with its description, amount and day. Two pending ones
      worded alike make one suggestion, naming the newest. Its other account
      is the one the history shows the other side on, and a pending payment
      usually has none yet, so he picks it ("Change it first"), as for any
      such suggestion. In Review, such an item says what the bank's label is,
      names the bank rule for its wording, and links to Settings, Bank rules
      (the rule is added there, as any other; it is not added from Review);
      this one he marks "Transfer between my accounts" once it posts (5.6:
      not while pending). Posted items, and items his rules already read
      right, are as before. Demo life setup-pending-payment.


B242. Found by the deploy check's first real run (A50a, Oct 15, 2026),
      before the deploy: his real setup day was saved on Oct 12, before the
      12-hour wait for "totals do not match" (10.4, A47) existed, and the
      code from PR #29 on refused to replay it ("the totals-do-not-match
      alert must be a whole number of hours from 1 to 168"). Deployed, the
      app would not have started (0.6). A setup day saved before that setting
      now opens with the 12 hours he OK'd (34b), as one saved before the pay
      schedule opens as every 14 days (A48). It changes no money: the
      setting only says when the alert is told. A test now keeps a setup day
      with only the settings there were on his real setup day, so a setting
      added later without a value for older histories fails npm test, not
      the deploy check.
B243. The deploy check's first real run: Fly built and pushed the new image,
      and the throwaway machine could not start from it, Fly's registry not
      knowing the new label yet ("manifest unknown"; no machine was made).
      The same command a few minutes later ran. The check now tries that step
      again after 30 seconds, at most 3 times, only for that answer. Seen on
      that run: the throwaway machine was new (in iad), with no volume, no
      ports, the server never started (it sleeps until the check runs),
      removed when it ended; the app's own machine was not touched.
B244. A52 as built (9.8). The bank's own statement date wins whenever it
      sends one; the days are used only when it sends none. With the days
      set, the statement date is the due date less them; the due date, the
      balance and the minimum still come from the bank, and the days never
      make up for one of those missing. A card is said to be off only for a
      statement the bank sent: "no statement date" when the days would read
      it (setting them turns the reminders on, and its row on Home opens
      Settings), "cannot be read" otherwise (nothing on Settings would fix
      it, so its row opens nothing). A card account the bank sends no
      statement for at all is as before, not said: his bank sends one for
      each card, and the made-up bank in the tests has none unless a test
      sets one. On Home the off cards come right after an overdue card; on
      Settings they are notices at the top of "Alerts and reminders", above
      the two rows that set the days. A setup day saved before the setting
      (his, Oct 12) opens with no days set, as it was (B242's guard covers
      it). Demo life cards-off. Worked example bank 17.
B245. Settings' Notifications card, the same gap B192 closed for Review, the
      bucket lists and Payday (found on CI's WebKit runner, PR #31, run
      38829682106: "a double tap on Turn on" sent two). After Turn on, Send a
      test alert or Turn off was answered, the card's buttons took taps
      again before Settings showed the numbers asked for after it. In that
      moment the card still said Off after Turn on (a second /api/push/on,
      harmless: the server kept the same subscription again), sent a second
      test alert, and after Turn off it already said Off with Turn on taking
      taps, so the second tap of a double tap on Turn off turned them back
      on. Now the buttons stay off until those numbers are shown, also when
      the numbers were read again while the request was on its way (back
      from the background); after Turn on the button says "Turning on…"
      until then, and after Turn off, "Turn on" (off). Phone side only:
      nothing on the server changed.
B246. A53 as built (9.8). The statement date is the last day before the due
      date that falls on the closing day: in the due date's own month when
      that day comes before the due date, otherwise the month before. A
      closing day on the due date's own day of the month means the month
      before. A closing day a month does not have (29, 30 or 31) closes on
      that month's last day, and Settings says so ("The 30th of each month,
      or its last day"). The bank's own statement date still wins whenever
      it sends one, and the closing day never makes up for anything else
      missing. A52's days are no setting any more, and a change that names
      them is refused; a setup day saved before the closing day opens with
      none (B242's guard covers it). The date worked out is not checked
      against today: if the bank ever sent the next due date before the
      statement closed, the statement date would come out in the future, and
      no payment would count toward it yet. Not seen; his bank keeps the old
      due date until the new statement. Worked example bank 17.
B247. A54 as built (12.1). Every pending item the books do not count yet is
      put back from the available balance at the bank's latest amount:
      going out added back, coming in taken out. A pending purchase (counted
      at once, 4.6) is already out of the available balance and is left as
      it was. With no available balance from the bank, the posted balance
      less pending charges, as before (pending money in is not in it).
      Only a paycheck has been seen pending in his accounts so far: if the
      bank ever leaves some pending money in (a refund, say) out of the
      available balance, the bank side comes out low by it until it posts,
      shown as the bank still catching up (10.4) and told only after 12
      hours. Setup day reads the same bank side, so a paycheck pending on
      setup day is not starting money; it waits in review once it posts.
      The made-up bank in the tests now puts pending money in into the
      available balance, as his bank does. Worked example bank 2.
B248. Seen on his live books, Oct 16, not changed: the minimum payment his
      bank sends looks like what is left of the minimum after payments, not
      the statement's minimum (one card showed none left after its payment
      this month). 9.3 counts the payments since the statement against it,
      so a payment of part of the minimum would count twice, and the
      reminders could stop with some of it unpaid. Paying the minimum or
      more, as he does, is not affected. To check at the next statements:
      what the bank sends before a payment. If it is the statement's
      minimum, nothing to do; if not, a question for him.
B249. A55 as built (13.8). The offer comes with the answer to a tap, in the
      notice that says what was done, on Review and on the bucket lists:
      "You sorted “GREEN LEAF MARKET” the same way before. Make it a rule so
      the next one sorts itself?" and a button, "Make it a rule". It opens a
      sheet with the rule's text, which he can change, and what the rule
      would do; "Yes, always" makes it from the item already sorted (13.6,
      B101: nothing moves, and it goes just ahead of a rule it corrects);
      "Not now" sends nothing, and nothing about it is kept. Sorted by hand:
      a sort or a sort again of his into one place (a bucket, other income,
      not mine, for mom). A split is no one way; one he marked a transfer,
      matched to a purchase or unmarked is no longer one he sorted; one a
      rule sorted is not by hand. Which were by hand is worked out again from
      the history at every start: no new kind of event. The words: split at
      spaces; a word with a digit ends the run (dates, store numbers, card
      digits); marks (- * #) inside the run stay as the bank wrote them, at
      its ends they are left off; a word is common when it is on more than
      half of his items of that kind on that account (each counted once, by
      the description as it first showed up) on that day and in the 90 days
      before; the longest run wins, the first of two as long. The kinds:
      purchases (not money leaving savings, 4.9, which no rule sorts),
      payments to people (with those counted for mom, for the common words),
      and deposits. Not offered: for a payment counted for mom, which takes
      no rule once counted (as on its list), so a rule could not be made from
      it; and when no name is left, as for a place on most of his items of
      that kind on that account (his first few items, or a card used mostly
      at one place), whose own words are then the common ones. "Always do
      this" starts from the same name on Review and the bucket lists (a
      payment he marked to the old card, from the purchase it was); with no
      name, from the description, as before. The offer is part of the answer
      kept with its decision number, so a repeat gets it back too.
B250. A56 as built (11.4). "On its way in" is a card on Home under
      "Checked at", shown only when something is pending. A row for each
      deposit still pending into checking or savings: money in that no bank
      rule reads as a transfer between his accounts (a card's pending refund
      is not one: it is on the card). Oldest first, checking before savings
      on the same day; a paycheck in two parts is two rows. "Paycheck on its
      way" when the paycheck rule matches the pending item's description
      (the bank's words while pending); with no paycheck rule, as on his
      books now (B228), every row says "Money on its way in". Each says "To
      checking, counted when it posts" and the amount. None while the bank
      cannot be read (10.5). Nothing about money changes: 12.1 already takes
      pending money in out of the bank side (A54), and the item counts once
      it posts, as before.


## Part B, added with the app explaining itself (A57, Oct 16). Tell me if any is wrong.

B251. A57 as built (12.6). Each read of the bank keeps, in the sync's own
      transaction (database step 11, bank_reads.bank and .difference), each
      account's posted and available balances, what the check counted for it,
      the bank's own transactions on it that the books count added up (posted
      ones and pending charges, in Plaid's sign), the pending items Plaid
      listed, and the check after the read. The read that matched is the last
      one whose check was 0; starting tracking marks the last read before it
      as one (14.3: the check passed then). For each account, its part of the difference is what
      its figure moved since, beyond its own transactions: checking and
      savings what they counted plus their transactions' change, the card the
      opposite (it is taken away in the bank side). What the three accounts
      do not account for is "the rest" (the books moving otherwise than the
      bank's transactions, such as an item waiting for his decision); so the
      lines add up to the difference by construction, and a test with random
      lags through the real books checks there is never a rest when the books
      follow the bank. A cause is named only when the parts of some pending
      items add up exactly to an account's move: the fewest of them, the
      oldest first among as few, every way tried up to 12 items, beyond that
      up to 4 at once or all of them. On the card (and checking or savings
      with no available balance) each pending item listed now: the bank
      posted it. On checking or savings: a posted item since with a pending
      one of the same amount still listed, a pending item whose amount Plaid
      changed since, and a pending item listed since; an account read one way
      then and the other now names none. The lines are worked out each time
      Home or Buckets is read; nothing about them is kept. Reads kept before
      the update have no bank: until a read after it matches, the sheet says
      no earlier read that matched is kept. Worked example bank 18.
B252. A57 as built (11.4). Pending since: the read that saved the sync that
      first brought the item (database step 11, bank_reads.sync). Reads kept
      before the update get their sync from the order of the reads that saved
      something, but only when every sync kept was saved with a read (true on
      a server that only syncs through its timer and webhooks, as his does);
      otherwise, and for anything first seen in a sync with no read, the day
      the bank dated it. Shown like "Checked at": the time today, the day and
      time before today. Usually posts within: examples are posted deposits
      into checking or savings (not transfers arriving, not refunds on a
      card) with their pending one, the bank's link or, with none, the
      pending one dropped in the same read for the same amount on the same
      account; timed from the read that first saw the pending one to the read
      that first saw the posted one; a posted one seen before its pending one
      is no example. The kind (a paycheck or other money in) is read with the
      paycheck rule as it is now, so setting it changes which examples count.
      The last 10 by when they posted; three in four of them: the
      ceil(3/4 x n)-th quickest. Worked example bank 19.
B253. A57 as built (0.7). The Status row is on Settings' Bank card, on the
      real server only, before setup day too. "Server started" is when it
      began serving the books, just after they opened (opening them never
      asks the clock, 0.6). How the last sync went is kept in memory: after a restart
      the page says none since the server started until the next sync (the
      last good read is kept in the database and always shown). A sync that
      was never tried (the four accounts not picked yet, 1.2) is not one.
      Backups (hosted only): copying while /health/backups is ok, with the
      last heartbeat. Alerts waiting: worked out, not sent, and not marked
      "not sent" (10.9). At the top: "All working", or how many things need a
      look; each says so in words and with a warning icon.
B254. A57 as built (0.8). The service worker answers page navigations to the
      app's own screens only (never /api, /health, /plaid or /sw.js, never
      another site, never a request a screen makes): it passes each on to the
      server as it is, and answers with the fixed page when the request fails,
      no answer comes within 15 seconds, or the answer is 502, 503 or 504. The
      page is 503, not kept (no-store), with its own security policy (no
      script, nothing from anywhere); Try again opens the same address again.
      The background part is now set up each time the app opens from its
      https address (and still when notifications are turned on), not on this
      computer's address, so the screens' tests run without it. A screen
      that opens but cannot get its numbers still shows its own error state,
      as before. Not seen on his iPhone yet: a home-screen app opened while
      the server is down (the next Fly restart, or a stopped machine, would
      show it).


## Part B, added with the Trends tab (A58, Oct 18). Tell me if any is wrong.

B255. A58 as built (40.3). The pay periods before setup day are the pay
      schedule's, going back from the last paycheck you gave on setup day, as
      40.3 says: not found from paycheck deposits in the history. A paycheck
      that came a few days off its day does not move them. With every 14 days,
      14 days at a time; twice a month, the 15th and the last day before it
      (a weekend day moved to the Friday before), found the way the next
      payday is (11.2).
B256. A58 as built (40.3). Where the app keeps no bank history from before
      setup day (the demo), the books' first pay period began on setup day,
      not a payday, so it counts as cut off: never one of your usual (40.7).
B257. A58 as built (40.2). Spending waiting in review shows as unsorted in
      the current pay period whatever day it is dated, and moves to the pay
      period the books count it in once sorted. A pay period that has ended has
      no unsorted part from the books.
B258. A58 as built (40.2, 40.6). A pay period's bar has what the books
      counted in it, the same as the bucket lists. "This is my paycheck"
      starts the new pay period on the deposit's day (B53), so a pay period
      can hold spending dated a day or two after its last day. "Where it
      went" goes by the day each item is dated, so it does not depend on that.
B259. A58 as built (40.1, 40.2). Before setup day, what the books would do
      with no answer: a purchase on the old card or its fees and interest are
      its debt (5.4, 5.5), not spending; money back on a card that no sorting
      rule sorts would wait as money in, so it is not spending; a payment to a
      person whose rule says "not mine" or "for mom" is not spending; money
      leaving savings, everyday card fees and interest, a payment to a person
      with no rule, and a payment to the old card from savings would wait in
      review, so they are unsorted (and counted in your usual, 40.7: only the
      old card part of needs, from checking, is left out).
B260. A58 as built (40.1). A charge pending on setup day counts in the pay
      period of its day, at the amount setup day counted; when it posted at
      another amount, the difference is in the books (A10), in the pay
      period the books counted it in. The history's first day is 90 days
      before the day the bank was connected, or the oldest item kept if older.
B261. A58 as built (40.6). The place of an item in the books is found among
      the books' own items (as the rule offers are, 13.8); the place of one
      from before setup day among the history's items of that kind on that
      account. One name written in other capitals is one place, shown as its
      newest item writes it. The old card payments are ranked with the places
      for the five biggest. "Everything else" is the places past the five and
      the items with no name (a card fee, a payment to the old card from
      savings, a description with no word left). Tapping a place lists its
      items, newest first.
B262. A58 as built (40.8). In the books' first pay period, Wants did not
      exist before setup day, so its line and its even pace start on setup day
      (day 1) and run to the day before the next payday.
B263. A58 as built (the screen). Trends' one main number is what was spent so
      far this pay period, without old card payments (40.7). Past shows the
      bars (tap one for its items), savings and the mom reserve as two lines,
      and the places; Now shows Wants against an even pace and your usual. With
      more pay periods than fit across the phone at 44 points each, the bars
      scroll sideways and open at the newest. The bars and lines are drawn by
      the app itself (no chart library): the redesign plan names @visx for
      PR 5's charts. Bars from before setup day are drawn lighter and say so
      in words.
B264. Found on Linux CI with PR #48, fixed with a test first (the redesign's
      PR 3 swipe). A refused swipe could leave the card off its place by its
      own style (translateX(0px)) after it came back: Motion wrote the last
      frame of an animation after telling it had ended, over the card already
      put back. It looked at rest, but the app (and PR 3's test) never saw it
      at rest; on a busy machine only. The card's own place is now set first
      and the way out and the way back are only drawn over it, by the
      browser's own animations, so nothing that ends later can move it; a way
      back still being drawn gives way to the finger. Test: swipe.test.ts
      "B264". Breaks "[b264]", both caught.
B265. Found looking at B264 (the redesign's PR 5, his ask). The bottom
      sheet's pull to close had the same late write: its way back and its way
      out were Motion animations that wrote the sheet's own style when they
      ended. A short pull left the sheet off its place by its own style until
      the way back ended, and a late write could land on a sheet already
      closed. Its own place is now set first and the way there only drawn
      over it by the browser's own animation; a new pull takes the sheet from
      a way back still being drawn. Test first, Chromium and WebKit:
      motion.test.ts "B265" (two failed before). Breaks "[b265]".

## Part B, added with Trends Future and Habits (A59, Oct 19). Tell me if any is wrong.

B266. A59 as built (40.11). "Before day 3" counts the days so far the way
      the pace does: from payday, or from setup day in the books' first pay
      period, so the first two days after setup day have no estimate either.
      On the next payday itself, with no paycheck yet, there are no days left,
      so each lands at what it holds; from the day after, no estimate.
B267. A59 as built (40.12). The books' first pay period counts only when it
      began on setup day (with no bank history kept, as in the demo); his
      began on his last paycheck before setup day, so it does not. The
      paydays a year out are those after today up to the same date next year.
      The chart's range starts at what savings holds now and has one point a
      payday.
B268. A59 as built (40.13). The plan ends at the payday it reaches $0.00
      (each share is rounded up, so it can get there before the last payday),
      and "paid off by" is that payday. Nothing owed is "paid off" with or
      without a promo end date.
B269. A59 as built (40.14). The full pay periods are those 40.4 shows for
      the last 90 days, so the oldest can begin a little before the 90 days.
      An item counts in the pay period whose days hold its date. A per-day
      amount below zero (more money back than spent) is rounded down, away
      from zero.
B270. A59 as built (40.15). The days run Monday to Sunday; a tie for the most
      goes to the first from Monday; with nothing above $0.00, none is named.
B271. A59 as built (40.16). What one item charged is all of it added up (a
      split, or a refund counted in a later pay period); its day is the day it
      happened. All the charges from one place are taken together, so a place
      with a one-off purchase among its monthly ones, or two subscriptions at
      one place, is not spotted. The list is ordered by a year of it, then by
      name.
B272. A59 as built (40.17). The books' first pay period counts (Wants existed
      from setup day; how it ended is all the streak asks).
B273. A59 as built (the screens). Future and Habits are two more parts of
      the segmented control; at a large text size the four go two to a row.
      The days of the week are rows with a bar each, not columns: seven
      44-point columns do not fit across the phone. The most says "the most"
      on its row. A repeat charge's sheet lists its charges without a total
      (the server gives none, and the screens add nothing up).
B274. Found in the WebKit pictures (PR 5's finishing pass), fixed with a test
      first. The rolling digits draw each digit from generated text, and
      WebKit (the iPhone's engine) draws that without tabular widths: a narrow
      "1" sat at the left of a wider cell, with a gap after it ("$1 58.23").
      Every rolling amount with a 1 in it, since PR 2. Each digit is now
      centred in its cell, as a tabular figure is. Test: rolling-amounts.test.ts
      (a drawn "1" sits in the middle of its cell; failed in WebKit before).
B275. A60 as built (7.7). "Not mine" is offered for money leaving checking or
      savings, not for a purchase on a card: he asked about money in his
      accounts, and a card purchase for a friend is already answered by the
      friend paying it back (7.5). A sorting rule cannot pick it, since a
      purchase rule picks needs or wants (13.6), so 13.8 offers no rule for it.
      A refund of one marked not mine goes back to held for others, where it
      came from (4.5). It shows as "Purchase" on Held for others' list, the
      word that kind of item has on every list.
B276. Found in his live books (Oct 30, his OK, read-only): the bank words a
      Zelle from savings one way while pending and another once posted. His
      bank rule on savings names the pending words, and the rule naming the
      posted words is on checking only. So the posted one reads as money
      leaving savings, not as a payment to a person, with no "for mom" and no
      mom rule. It is fixed for what comes next by a second bank rule on
      savings, in Settings (his step). What was already read stays as it was
      (section 2), so 7.7 is what sorts the ones already waiting.
B277. A61 as built (9.9). The card sits on Buckets, not Home, since Home has
      one main number and its own line from the first reminder day (9.6). A
      due date past with what 9.3 asks for paid says paid. The everyday card
      paid in part after the due date, with the minimum met, says so in words:
      no overdue alert comes for it (9.4).
B278. A62 as built. Only the screens' words changed. Inside, the books still say
      heldForOthers and not-mine, and the address stays /buckets/held-for-others,
      since changing them would change what the history replays. On the sheet the
      choice reads "Other (not Needs or Wants)", so it is not taken for "Other
      income"; everywhere else it is Other.
B279. A63 as built (7.8). The parts are Other, savings, needs, and wants, in that
      order, so Wants gets the rest on the screen. The mom reserve is not a part:
      the reserve fills from paychecks, and a whole payback into it is still a
      choice. Other income is not a part, since it has its own split. A store
      refund can be split too: both of its choices are parts. A split one on a
      bucket's list says it was part of a split, and sorting it again replaces
      the whole split.
B280. A64 as built (7.7). The everyday card, not the old card, whose purchases
      raise the debt and touch no bucket (5.4). As on checking and savings, a split
      keeps Wants as the rest. A rule still picks needs or wants for a purchase, so
      one a rule sorted is changed from its bucket's list.
B281. Found on CI's WebKit (PR 54, the same test twice), fixed with a test first.
      13.7's second was counted from when the screen worked out the new numbers,
      so a slow first frame could use it up before the change could be seen, and a
      tap meant for what was there before went through. It now starts at the frame
      that shows the change. Nothing about money changed: the server still refuses
      an answer about an item that is not what the screen sent.
