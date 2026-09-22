import React from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { SEOHead } from '../../components/SEOHead';

const NAV = [
  { path: '/conditions', label: 'Conditions' },
  { path: '/reglement-litiges', label: 'Litiges' },
  { path: '/anti-fraude', label: 'Anti-fraude' },
  { path: '/confidentialite', label: 'Confidentialité' },
  { path: '/mentions', label: 'Mentions & Assistance' },
  { path: '/jeu-responsable', label: 'Jeu responsable' },
];

export const ASSISTANCE = {
  email: 'coyd2976@gmail.com',
  whatsapp: '+2290165240654',
  whatsappLink: 'https://wa.me/2290165240654',
  hours: 'Tous les jours, 8h – 01h (GMT+1)',
  city: 'Cotonou, Bénin',
};

interface LegalLayoutProps {
  title: string;
  description: string;
  path: string;
  updatedAt: string;
  children: React.ReactNode;
}

export const LegalLayout: React.FC<LegalLayoutProps> = ({ title, description, path, updatedAt, children }) => {
  const location = useLocation();
  return (
    <div className="min-h-dvh bg-zoyd-black font-ui safe-top safe-bottom">
      <SEOHead title={`${title} — ZOYD`} description={description} path={path} />
      <div className="max-w-3xl mx-auto px-5 py-10 sm:py-14">
        <Link to="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-xs font-mono uppercase tracking-widest mb-8">
          <ArrowLeft className="w-4 h-4" /> Retour accueil
        </Link>
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-zoyd-yellow mb-2">ZOYD — Informations légales</p>
        <h1 className="text-3xl sm:text-4xl font-display font-black text-white uppercase italic mb-2">{title}</h1>
        <p className="text-white/40 text-xs font-mono mb-8">Dernière mise à jour : {updatedAt}</p>

        <nav className="flex flex-wrap gap-2 mb-10" aria-label="Pages légales">
          {NAV.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-4 py-2 text-[11px] font-display font-black uppercase tracking-widest italic border transition-colors ${
                location.pathname === item.path
                  ? 'bg-zoyd-yellow text-black border-zoyd-yellow'
                  : 'text-white/60 border-white/10 hover:text-white hover:border-white/30'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <article className="space-y-8 text-white/75 text-sm leading-relaxed">{children}</article>

        <footer className="mt-12 pt-8 border-t border-white/10 text-center">
          <p className="text-white/50 text-xs font-mono uppercase tracking-widest">
            Une question ? Écris à{' '}
            <a href={`mailto:${ASSISTANCE.email}`} className="text-zoyd-yellow hover:text-white">
              {ASSISTANCE.email}
            </a>{' '}
            ou{' '}
            <a href={ASSISTANCE.whatsappLink} target="_blank" rel="noreferrer" className="text-zoyd-yellow hover:text-white">
              WhatsApp {ASSISTANCE.whatsapp}
            </a>
          </p>
          <p className="text-white/30 text-[11px] font-mono mt-2">{ASSISTANCE.hours}</p>
        </footer>
      </div>
    </div>
  );
};

export const LegalSection: React.FC<{ n: string; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section>
    <h2 className="text-lg font-display font-black text-white uppercase italic mb-3">
      <span className="text-zoyd-yellow mr-2">{n}.</span>
      {title}
    </h2>
    <div className="space-y-2">{children}</div>
  </section>
);
