import { RussianRuble } from 'lucide-react';

/** Official Tether mark from /assets/tether.svg */
export function UsdtLogo({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/assets/tether.svg"
      width={size}
      height={size}
      alt="USDT"
      draggable={false}
      style={{ borderRadius: '50%', display: 'block', flexShrink: 0 }}
    />
  );
}

/** Lucide russian-ruble in Apple-blue disc */
export function RubLogo({ size = 36 }: { size?: number }) {
  const icon = Math.round(size * 0.5);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#0A84FF',
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        color: '#fff',
      }}
    >
      <RussianRuble size={icon} strokeWidth={2.4} />
    </span>
  );
}

/** Official CryptoBot mark from /assets/cryptobot.png */
export function CryptoBotLogo({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/assets/cryptobot.png"
      width={size}
      height={size}
      alt="CryptoBot"
      draggable={false}
      style={{ borderRadius: '50%', display: 'block', flexShrink: 0, objectFit: 'cover' }}
    />
  );
}

export function TonLogo({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/assets/ton.png"
      width={size}
      height={size}
      alt="TON"
      draggable={false}
      style={{ borderRadius: '50%', display: 'block', flexShrink: 0, objectFit: 'cover' }}
    />
  );
}

export function TronLogo({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/assets/tron.png"
      width={size}
      height={size}
      alt="TRON"
      draggable={false}
      style={{ borderRadius: '50%', display: 'block', flexShrink: 0, objectFit: 'cover' }}
    />
  );
}
