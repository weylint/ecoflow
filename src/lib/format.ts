function withThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function fmtNum(n: number, pad = false): string {
  if (Number.isInteger(n)) return withThousands(String(n)) + (pad ? '   ' : '');
  const [int, dec] = n.toFixed(2).split('.');
  return withThousands(int) + ',' + dec;
}

export function fmtEdm(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  return withThousands(int) + (dec === '00' ? '   ' : ',' + dec);
}

export function fmtLabor(n: number): string {
  const k = n / 1000;
  if (k % 1 === 0) return withThousands(String(k)) + 'k';
  const [int, dec] = k.toFixed(1).split('.');
  return withThousands(int) + ',' + dec + 'k';
}

// Percentage change from `from` to `to`, for report comparison columns.
// '—' when both sides are absent, 'new' when something appears from nothing.
export function fmtDeltaPct(from: number, to: number): string {
  if (from === 0 && to === 0) return '—';
  if (from === 0) return 'new';
  if (to === 0) return 'gone';
  const pct = Math.round((to - from) / from * 100);
  return (pct > 0 ? '+' : '') + pct + '%';
}

export interface ValueFormat {
  /** Decimal places. Always rendered, so a column never mixes `4.672` with `2.989,34`. */
  decimals?: number;
  /** Scale to thousands with a `k` suffix — but only above 1000, so small
   *  values stay real numbers instead of a column of `0k`. */
  compact?: boolean;
}

/**
 * The report's one number formatter. Each section states its own shape rather
 * than each call site inventing one; unlike `fmtEdm`/`fmtNum` it never pads with
 * whitespace (the report's cells are already monospaced and right-aligned).
 */
export function fmtValue(n: number, { decimals = 2, compact = false }: ValueFormat = {}): string {
  if (compact && Math.abs(n) >= 1000) {
    const [int, dec] = (n / 1000).toFixed(1).split('.');
    return withThousands(int) + ',' + dec + 'k';
  }
  const [int, dec] = n.toFixed(decimals).split('.');
  return withThousands(int) + (dec ? ',' + dec : '');
}
