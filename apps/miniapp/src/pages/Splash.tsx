import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { UsdtLogo } from '../components/AssetLogos';

export function SplashPage() {
  const nav = useNavigate();

  function start() {
    sessionStorage.setItem('ex_splash', '1');
    nav('/', { replace: true });
  }

  return (
    <div className="splash page-atm">
      <div />
      <motion.div
        className="splash-center"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 22,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--border)',
            display: 'grid',
            placeItems: 'center',
            marginBottom: 8,
          }}
        >
          <UsdtLogo size={40} />
        </div>
        <div className="brand">
          Ex<span>change</span>
        </div>
        <p className="muted">Быстрый и безопасный обмен USDT</p>
      </motion.div>
      <motion.button
        type="button"
        className="cta"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        onClick={start}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Начать <ArrowRight size={18} />
        </span>
      </motion.button>
    </div>
  );
}
