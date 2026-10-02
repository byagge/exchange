import { ArrowRight, Dot } from 'lucide-react';
import type { ReactNode } from 'react';

/** Direction label without unicode arrows — Lucide only */
export function DirectionFlow({
  from,
  to,
  size = 14,
}: {
  from: string;
  to: string;
  size?: number;
}) {
  return (
    <span className="dir-flow">
      <span>{from}</span>
      <ArrowRight size={size} strokeWidth={2.25} className="dir-flow-icon" aria-hidden />
      <span>{to}</span>
    </span>
  );
}

/** Inline separator without typographic symbols */
export function MetaSep({ size = 14 }: { size?: number }) {
  return <Dot size={size} strokeWidth={3} className="meta-sep" aria-hidden />;
}

export function MetaLine({ children }: { children: ReactNode }) {
  return <span className="meta-line">{children}</span>;
}

export function pairDirection(pair?: string) {
  if (pair === 'RUB_USDT') return { from: 'RUB', to: 'USDT' };
  return { from: 'USDT', to: 'RUB' };
}
