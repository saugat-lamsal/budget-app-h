// npm run pay-period-agent-her [-- --port N] [-- --control N]
//
// PR 12, the end check (docs/her-plan.txt): upstream's pay-period agent
// (scripts/pay-period-agent.mjs) on her setup. The real server with her pay
// period at her two made-up banks
// (packages/web/test/browser/pay-period-her/agent-server-her.ts), for an
// agent that uses her screens in a browser like a person and has not seen the
// code (agent-pay-period-h/). No real bank and no real money: Plaid is never
// called, and the books are in a database file of their own, removed when it
// stops. The app is on http://localhost:5390 and a control page on
// http://localhost:5391 ("Log this browser in", "Bring in the next day").
import { build } from 'vite';
import { path, runBuilt } from './server-build.mjs';

await build({ root: path('packages/web'), logLevel: 'warn' });
await build({
  configFile: false,
  root: path('packages/web'),
  logLevel: 'warn',
  ssr: { noExternal: true, external: ['better-sqlite3'] },
  build: {
    ssr: true,
    outDir: path('packages/server/dist/agent-her'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { input: { 'agent-server-her': path('packages/web/test/browser/pay-period-her/agent-server-her.ts') }, output: { entryFileNames: '[name].mjs' } },
  },
});
runBuilt('packages/server/dist/agent-her/agent-server-her.mjs', process.argv.slice(2), { WEB_ROOT: path('packages/web/dist/') });
