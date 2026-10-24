// Her rulebook, PR 5: the second-card twin of every everyday-card test.
// Upstream's own test files run here again, unchanged, through the mirror in
// twin/second-card.ts: each book has the second card switched on, and the
// second card stands wherever a test names the everyday card (4.1, 4.5, 4.6,
// 4.8, 4.10, 5.1, 5.6, 9.1 to 9.8, 12.1 to 12.6, 14.2, and the rest of what
// those files hold). A test that passes here says the same of the second card
// as it says of the everyday card in its own file.
import { vi } from 'vitest';

vi.mock('../src/index.js', async (importOriginal) => {
  const { mirrorMoney } = await import('./twin/second-card.js');
  return mirrorMoney(await importOriginal());
});

await import('./0-ground-rules.test.js');
await import('./0-refused-leaves-no-trace.test.js');
await import('./10-alerts.test.js');
await import('./12-app-side.test.js');
await import('./12-self-check.test.js');
await import('./13-settings.test.js');
await import('./14-setup-day-screens.test.js');
await import('./14-setup.test.js');
await import('./4-bank-changes.test.js');
await import('./4-spending.test.js');
await import('./40-trends.test.js');
await import('./5-transfers.test.js');
await import('./5-unmark-old-card.test.js');
await import('./6-debit-card-refund.test.js');
await import('./7-others-money.test.js');
await import('./9-card-due.test.js');
await import('./9-reminders.test.js');
await import('./activity.test.js');
await import('./pay-period.test.js');
await import('./properties.test.js');
await import('./resort.test.js');
await import('./review-answers.test.js');
await import('./review-options.test.js');
await import('./worked-examples.test.js');
