// 1.1 and 1.3: Plaid Link, the bank's own login, on the Bank page only. The
// server gives that page the address of Plaid's script and a nonce (meta tags
// plaid-link and plaid-nonce), and its page rules let that one script in and
// nothing else; on any other page there are no such tags, and Link is not
// there. The screen never sees a bank key: only Link's answer once he has
// logged in, which it hands to the server.

interface LinkHandler {
  open(): void;
  destroy(): void;
}

// What Link says with its answer. Only the bank is kept (her rulebook, 1.1, HB8).
interface LinkMetadata {
  readonly institution?: { readonly institution_id?: unknown; readonly name?: unknown } | null;
}

interface LinkConfig {
  readonly token: string;
  readonly onSuccess: (publicToken: string, metadata?: LinkMetadata) => void;
  readonly onExit: (error: unknown) => void;
}

interface PlaidGlobal {
  create(config: LinkConfig): LinkHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

// How Link ended: he logged in (Link's answer for the server, with the bank
// Link says it was, when it says), he closed it (or it failed) and nothing
// changed, or Link could not be loaded at all.
export type LinkOutcome =
  | { readonly kind: 'logged-in'; readonly publicToken: string; readonly institution: { readonly id: string; readonly name: string } | null }
  | { readonly kind: 'closed'; readonly failed: boolean }
  | { readonly kind: 'unavailable' };

function institutionOf(metadata: LinkMetadata | undefined): { readonly id: string; readonly name: string } | null {
  const i = metadata?.institution;
  return i !== null && i !== undefined && typeof i.institution_id === 'string' && typeof i.name === 'string' ? { id: i.institution_id, name: i.name } : null;
}

// How long to wait for Plaid's script.
const LOAD_LIMIT_MS = 20_000;

function meta(name: string): string | null {
  const content = document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? '';
  return content === '' ? null : content;
}

let loading: Promise<PlaidGlobal | null> | null = null;

// Plaid's script, once per page, with the page's nonce. Null when this page
// has no Link (not the Bank page) or the script did not load.
export function loadLink(): Promise<PlaidGlobal | null> {
  if (loading !== null) return loading;
  const started = new Promise<PlaidGlobal | null>((resolve) => {
    if (window.Plaid !== undefined) {
      resolve(window.Plaid);
      return;
    }
    const src = meta('plaid-link');
    const nonce = meta('plaid-nonce');
    if (src === null || nonce === null) {
      resolve(null);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.nonce = nonce;
    script.async = true;
    const timer = setTimeout(() => resolve(null), LOAD_LIMIT_MS);
    script.addEventListener('load', () => {
      clearTimeout(timer);
      resolve(window.Plaid ?? null);
    });
    script.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    document.head.append(script);
  }).then((plaid) => {
    // A load that failed may be tried again (Try again on the screen).
    if (plaid === null) loading = null;
    return plaid;
  });
  loading = started;
  return started;
}

// Opens Link with a link key from the server, and tells how it ended.
export async function runLink(linkToken: string): Promise<LinkOutcome> {
  const plaid = await loadLink();
  if (plaid === null) return { kind: 'unavailable' };
  return new Promise((resolve) => {
    let handler: LinkHandler | null = null;
    let done = false;
    const end = (outcome: LinkOutcome): void => {
      if (done) return;
      done = true;
      resolve(outcome);
      // After Link has finished with its own callback.
      setTimeout(() => handler?.destroy(), 0);
    };
    handler = plaid.create({
      token: linkToken,
      onSuccess: (publicToken, metadata) => end({ kind: 'logged-in', publicToken, institution: institutionOf(metadata) }),
      onExit: (error) => end({ kind: 'closed', failed: error !== null && error !== undefined }),
    });
    handler.open();
  });
}
