/** Apple-inspired motion — UITabBar + UINavigationController */

/** CAMediaTimingFunction ≈ system navigation curve */
export const appleEase = [0.32, 0.72, 0, 1] as const;

export type NavKind = 'tab' | 'push' | 'pop';

export type NavCustom = {
  kind: NavKind;
  dir: 1 | -1;
};

export function resolveNavKind(from: string, to: string): NavKind {
  const fromWallet = from.startsWith('/wallet');
  const toWallet = to.startsWith('/wallet');
  if (!fromWallet && toWallet) return 'push';
  if (fromWallet && !toWallet) return 'pop';
  return 'tab';
}

/** UITabBarController — crossfade only (no horizontal slide) */
export const tabVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * UINavigationController push / pop
 * Push: new screen 100% from right; old peeks −28%
 * Pop: reverse (old returns from left peek; current leaves right)
 */
export const stackVariants = {
  enter: (c: NavCustom) =>
    c.kind === 'pop'
      ? { x: '-28%', opacity: 0.92 }
      : { x: '100%', opacity: 1 },
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (c: NavCustom) =>
    c.kind === 'pop'
      ? { x: '100%', opacity: 1 }
      : { x: '-28%', opacity: 0.92 },
};

export function transitionFor(kind: NavKind) {
  if (kind === 'tab') {
    return { duration: 0.22, ease: appleEase };
  }
  return { duration: 0.36, ease: appleEase };
}
