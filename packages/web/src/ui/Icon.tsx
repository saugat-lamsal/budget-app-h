// The app's icons: simple line drawings in the text color. Each one is
// decoration next to words; the words carry the meaning.

const PATHS = {
  home: 'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z',
  buckets: 'M12 3.5 3 8l9 4.5L21 8zM3 12.5l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
  review: 'M3 13.5h5l1.5 2.5h5l1.5-2.5h5M5.5 4h13l2.5 9.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5.5z',
  settings: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4',
  trends: 'M4 19h16M5 15l4-5 4 3 6-7',
  alert: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.25v.25',
  check: 'M4 12.5 9.5 18 20 6.5',
  chevron: 'M9 5.5 15.5 12 9 18.5',
  back: 'M15 5.5 8.5 12 15 18.5',
  close: 'M6 6l12 12M18 6 6 18',
  card: 'M3 6.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3 10h18M6.5 15h4',
  lock: 'M6 11h12v9.5H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  move: 'M3.5 12h11M11 7.5l4.5 4.5-4.5 4.5M20 4.5v15',
  low: 'M12 4.5v14M6.5 13 12 18.5l5.5-5.5',
  empty: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  bank: 'M3 9.5 12 4l9 5.5zM5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8M3 20h18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  tray: 'M3 13.5h5l1.5 2.5h5l1.5-2.5h5M5.5 4h13l2.5 9.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5.5z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5.5M12 7.75V8',
  undo: 'M9 14.5 4 9.5l5-5M4 9.5h10.5a5.5 5.5 0 0 1 0 11H10',
  heart: 'M12 20.5s-7.5-4.6-9-9.6C2 7.4 4.3 4.5 7.3 4.5c1.9 0 3.5 1 4.7 2.7 1.2-1.7 2.8-2.7 4.7-2.7 3 0 5.3 2.9 4.3 6.4-1.5 5-9 9.6-9 9.6z',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16.5 5a3.2 3.2 0 0 1 0 6.2M18 14.8c2.1.6 3.5 2.3 3.5 5.2',
  swap: 'M4 8h14l-3.5-3.5M20 16H6l3.5 3.5',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  // A handle to drag a row by (her Wishlist list).
  grip: 'M5 8h14M5 12h14M5 16h14',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { readonly name: IconName; readonly size?: number }) {
  return (
    <svg
      className="icon"
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
