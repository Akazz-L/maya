/** The shared look of every text-entry control: one border, one focus ring. */
export const controlClass = [
  'w-full rounded-control border border-line bg-surface px-2.5 text-sm text-ink shadow-xs',
  'placeholder:text-ink-faint transition-[border-color,box-shadow] duration-150',
  'hover:border-line-strong focus:border-pencil focus:ring-3 focus:ring-pencil/15 focus:outline-none',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-subtle',
  'aria-invalid:border-danger aria-invalid:focus:ring-danger/15',
].join(' ');
