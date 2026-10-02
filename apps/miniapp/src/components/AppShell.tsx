import { useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeftRight, Clock3, Home, UserRound } from 'lucide-react';
import {
  type NavCustom,
  type NavKind,
  resolveNavKind,
  stackVariants,
  tabVariants,
  transitionFor,
} from '../lib/motion';

const tabs = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/exchange', label: 'Обмен', icon: ArrowLeftRight },
  { to: '/history', label: 'История', icon: Clock3 },
  { to: '/profile', label: 'Профиль', icon: UserRound },
];

const TAB_ORDER = ['/', '/exchange', '/history', '/profile'];

function tabIndex(pathname: string) {
  if (pathname.startsWith('/wallet')) return -1;
  const exact = TAB_ORDER.indexOf(pathname);
  if (exact >= 0) return exact;
  const prefix = TAB_ORDER.findIndex((t) => t !== '/' && pathname.startsWith(t));
  return prefix >= 0 ? prefix : 0;
}

export function AppShell() {
  const location = useLocation();
  const reduce = useReducedMotion();
  const hideNav = location.pathname.startsWith('/wallet');

  const prevPathRef = useRef(location.pathname);
  const navRef = useRef<NavCustom>({ kind: 'tab', dir: 1 });

  if (location.pathname !== prevPathRef.current) {
    const kind = resolveNavKind(prevPathRef.current, location.pathname);
    const prev = tabIndex(prevPathRef.current);
    const next = tabIndex(location.pathname);
    let dir: 1 | -1 = 1;
    if (kind === 'tab' && prev >= 0 && next >= 0) {
      dir = next >= prev ? 1 : -1;
    } else if (kind === 'pop') {
      dir = -1;
    }
    navRef.current = { kind, dir };
    prevPathRef.current = location.pathname;
  }

  const nav = navRef.current;
  const kind: NavKind = nav.kind;
  const variants = kind === 'tab' ? tabVariants : stackVariants;
  const transition = reduce ? { duration: 0.01 } : transitionFor(kind);

  return (
    <div className="app-shell">
      <div className="page-viewport">
        <AnimatePresence mode="sync" custom={nav} initial={false}>
          <motion.div
            key={location.pathname}
            className="page-slide"
            custom={nav}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={transition}
            style={{ zIndex: kind === 'push' ? 3 : 1 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {!hideNav && (
          <motion.nav
            className="bottom-nav"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
          >
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <t.icon size={20} />
                {t.label}
              </NavLink>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}
