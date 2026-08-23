import React from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';

const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-dvh bg-zoyd-black flex items-center justify-center p-5 relative font-ui scanline safe-top safe-bottom">
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
        <p className="text-white/40 mb-8">
          Cette page n'existe pas ou a été déplacée. Retourne au hub pour continuer à compétitionner.
        </p>
        <Link to="/mj" className="inline-block bg-zoyd-yellow text-black px-8 py-4 touch-target font-display font-black text-[11px] tracking-[0.2em] uppercase italic hover:bg-white transition-colors">
          RETOUR AU HUB
        </Link>
      </motion.div>
    </div>
  );
};

export default NotFoundPage;
