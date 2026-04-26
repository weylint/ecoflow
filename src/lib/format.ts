function withThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return withThousands(String(n));
  const [int, dec] = n.toFixed(2).split('.');
  return withThousands(int) + ',' + dec;
}

export function fmtEdm(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  return withThousands(int) + (dec === '00' ? '   ' : ',' + dec);
}

export function fmtLabor(n: number): string {
  const k = n / 1000;
  if (k % 1 === 0) return withThousands(String(k)) + 'k';
  const [int, dec] = k.toFixed(1).split('.');
  return withThousands(int) + ',' + dec + 'k';
}
