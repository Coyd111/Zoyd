import React from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { SEOHead } from '../components/SEOHead';

const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-dvh bg-zoyd-black flex items-center justify-center p-5 relative font-ui scanline safe-top safe-bottom">
      <SEOHead
        title="404 — ZOYD"
        description="Page non trouvée."
        path="/404"
        noindex
      />
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />
      <img src="/assets/images/codm-6.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity grayscale pointer-events-none" />
      <img src="/assets/images/codm-7.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-md"
      >
        <h1 className="text-7xl sm:text-9xl font-display font-black text-zoyd-yellow mb-4">404</h1>
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-white mb-4">
          ZONE NON TROUVÉE
        </h2>
        <p className="text-white/70 mb-8">
          Cette page n'existe pas ou a été déplacée.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to="/" className="inline-block bg-zoyd-yellow text-black px-8 py-4 touch-target font-display font-black text-[11px] tracking-[0.2em] uppercase italic hover:bg-white transition-colors" aria-label="Retourner à l'accueil">
            ACCUEIL
          </Link>
          <Link to="/auth/login" className="inline-block border border-white/20 text-white px-8 py-4 touch-target font-display font-black text-[11px] tracking-[0.2em] uppercase italic hover:border-white transition-colors" aria-label="Aller à la connexion">
            CONNEXION
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default NotFoundPage;
