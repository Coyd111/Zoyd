import React from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/Button';
import { motion } from 'motion/react';

const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-zoyd-black flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-md"
      >
        <h1 className="text-9xl font-display font-black text-zoyd-yellow mb-4">404</h1>
        <h2 className="text-3xl font-display font-bold text-zoyd-white mb-4">
          ZONE NON TROUVÉE
        </h2>
        <p className="text-zoyd-white-60 mb-8">
          Cette page n'existe pas ou a été déplacée. Retourne au hub pour continuer à compétitionner.
        </p>
        <Link to="/mj">
          <Button variant="primary" size="lg">
            RETOUR AU HUB
          </Button>
        </Link>
      </motion.div>
    </div>
  );
};

export default NotFoundPage;
