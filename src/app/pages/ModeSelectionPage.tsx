import React from 'react';
import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Gamepad2, Swords } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import ZoydLogo from '../components/branding/ZoydLogo';

const ModeSelectionPage: React.FC = () => {
  const navigate = useNavigate();

  const handleMJClick = () => {
    navigate('/mj');
  };

  const handleBRClick = () => {
    navigate('/br-league');
  };

  return (
    <div className="min-h-screen bg-zoyd-black text-white font-ui scanline">
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div className="relative max-w-[1500px] mx-auto px-6 md:px-8 py-10 md:py-14">
        <div className="flex items-center justify-between gap-4 mb-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm uppercase font-mono tracking-widest"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </Link>
          <ZoydLogo compact />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-4xl mb-8 md:mb-12"
        >
          <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-black uppercase italic tracking-[-0.05em] leading-[0.88] mb-4 md:mb-5">
            Choisis ton
            <br />
            <span className="text-zoyd-yellow">terrain de jeu.</span>
          </h1>
          <p className="text-white/46 text-base sm:text-lg md:text-xl leading-relaxed max-w-3xl">
            Ton profil, ton wallet et ta progression restent dans le meme espace. Tu entres dans le mode que tu
            veux suivre maintenant, puis ZOYD garde tout relie autour de ton compte.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 xl:grid-cols-[1.05fr_0.95fr] gap-6 md:gap-8">
          <motion.button
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08 }}
            onClick={handleMJClick}
            className="group text-left h-full"
          >
            <div className="relative h-full min-h-[420px] sm:min-h-[520px] overflow-hidden border border-zoyd-blue/20 bg-black hover:border-zoyd-yellow transition-all duration-300 group/card">
              <img src="/assets/maps/crossfire.jpg" alt="Multijoueur" className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-luminosity grayscale group-hover/card:scale-105 group-hover/card:grayscale-0 transition-all duration-700" />
              <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover/card:opacity-40 transition-opacity duration-700 pointer-events-none">
                <source src="/assets/codm/videos/ExecutionTutorial_Generic02.mp4" type="video/mp4" />
              </video>
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,10,0.24),rgba(10,10,10,0.75)_52%,rgba(10,10,10,0.96))]" />

              <div className="relative z-10 h-full p-6 sm:p-8 md:p-10 flex flex-col justify-between">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-10">
                  <Badge variant="yellow">DISPONIBLE</Badge>
                  <div className="border border-white/10 bg-black/35 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.24em] text-zoyd-blue text-center">
                    CODM Multiplayer
                  </div>
                </div>

                <div>
                  <div className="inline-flex items-center gap-3 text-zoyd-blue mb-3 md:mb-4">
                    <Swords className="w-5 h-5" />
                    <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.28em]">Mode ouvert</span>
                  </div>
                  <h2 className="text-4xl sm:text-5xl md:text-6xl font-display font-black uppercase italic tracking-[-0.05em] leading-[0.88] mb-4 md:mb-5">
                    Multijoueur
                  </h2>
                  <p className="text-white/50 text-base sm:text-lg leading-relaxed max-w-2xl mb-6 md:mb-8">
                    Matchs publics, tournois, salons competitifs et progression joueur deja relies a ton compte.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 md:mb-8">
                    <InfoChip label="Parties" value="Matchs + tournois" />
                    <InfoChip label="Compte" value="Profil centralise" />
                    <InfoChip label="Wallet" value="Actif" className="col-span-2 sm:col-span-1" />
                  </div>

                  <div className="inline-flex items-center justify-center w-full sm:w-auto gap-3 bg-white text-black px-6 py-4 font-display font-black uppercase tracking-[0.22em] text-xs italic group-hover:bg-zoyd-yellow transition-colors">
                    Entrer en MJ
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </div>
            </div>
          </motion.button>

          <motion.button
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.14 }}
            onClick={handleBRClick}
            className="group text-left h-full mt-4 lg:mt-0"
          >
            <div className="relative h-full min-h-[420px] sm:min-h-[520px] overflow-hidden border border-zoyd-yellow/20 bg-black/80 hover:border-zoyd-yellow/40 transition-all duration-300 group/br">
              <img src="/assets/maps/standby.jpg" alt="Battle Royale" className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-luminosity grayscale group-hover/br:scale-105 group-hover/br:grayscale-0 transition-all duration-700" />
              <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover/br:opacity-24 transition-opacity duration-700 pointer-events-none">
                <source src="/assets/codm/videos/AvatarView_Video.mp4" type="video/mp4" />
              </video>
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,10,0.28),rgba(10,10,10,0.78)_52%,rgba(10,10,10,0.97))]" />

              <div className="relative z-10 h-full p-6 sm:p-8 md:p-10 flex flex-col justify-between">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-10">
                  <Badge variant="yellow">DISPONIBLE</Badge>
                  <div className="border border-white/10 bg-black/35 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.24em] text-zoyd-yellow text-center">
                    BR League
                  </div>
                </div>

                <div>
                  <div className="inline-flex items-center gap-3 text-zoyd-yellow mb-3 md:mb-4">
                    <Gamepad2 className="w-5 h-5" />
                    <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.28em]">Mode ouvert</span>
                  </div>
                  <h2 className="text-4xl sm:text-5xl md:text-6xl font-display font-black uppercase italic tracking-[-0.05em] leading-[0.88] mb-4 md:mb-5">
                    Battle Royale
                  </h2>
                  <p className="text-white/50 text-base sm:text-lg leading-relaxed max-w-2xl mb-6 md:mb-8">
                    500 joueurs, 5 jours de qualification, 1 finale. Le meilleur joueur de la semaine remporte le pot.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 md:mb-8">
                    <InfoChip label="Format" value="500 joueurs" />
                    <InfoChip label="Entree" value="50 ZC" />
                    <InfoChip label="Cycle" value="Hebdomadaire" className="col-span-2 sm:col-span-1" />
                  </div>

                  <div className="inline-flex items-center justify-center w-full sm:w-auto gap-3 bg-zoyd-yellow text-black px-6 py-4 font-display font-black uppercase tracking-[0.22em] text-xs italic group-hover:bg-white transition-colors">
                    Entrer en BR League
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </div>
            </div>
          </motion.button>
        </div>

        <div className="mt-8 md:mt-10 border border-white/8 bg-zoyd-surface/20 px-5 md:px-6 py-4 md:py-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-white/28 mb-1.5 md:mb-2">Compte ZOYD</div>
            <div className="text-base sm:text-lg font-display font-black italic text-white">
              Un seul profil pour tes modes, tes matchs et ton wallet.
            </div>
          </div>
          <div className="inline-flex items-start md:items-center gap-2 md:gap-3 text-sm text-white/52">
            <Wallet className="w-4 h-4 text-zoyd-yellow shrink-0 mt-0.5 md:mt-0" />
            Tout reste relie a ton espace joueur.
          </div>
        </div>
      </div>
    </div>
  );
};

const InfoChip = ({ label, value, className = '' }: { label: string; value: string; className?: string }) => (
  <div className={`border border-white/8 bg-black/35 px-3 md:px-4 py-2.5 md:py-3 ${className}`}>
    <div className="text-[9px] md:text-[10px] font-mono uppercase tracking-[0.22em] text-white/24 mb-1">{label}</div>
    <div className="text-sm md:text-base font-display font-black uppercase italic text-white leading-tight">{value}</div>
  </div>
);

export default ModeSelectionPage;
