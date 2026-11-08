/**
 * ModeSelectionPage - choix du mode de jeu (MJ, BR salons, BR League).
 *
 * Ecran de transition apres connexion : le joueur choisit son mode de jeu
 * avant d'arriver sur son tableau de bord.
 *
 * INVARIANT (hierarchie produit, arbitrage 2026-11-02) : le produit courant
 * est MJ + BR salons. Les DEUX grandes cartes vendent donc des modes
 * OUVERTS : Multijoueur et Battle Royale (salons). La BR League est un
 * EVENEMENT hebdomadaire DIFFERE : elle vit sous la grille en bande
 * secondaire, etiquetee comme evenement — jamais presentee comme un
 * troisieme mode. Ne pas re-promouvoir la ligue en grande carte sans
 * decision produit contraire.
 * INVARIANT : la destination finale se lit dans le store d'auth. Un choix
 * de mode ne doit pas etre memorise cote serveur par ce composant.
 * PIEGE : cette page vit hors AppLayout : pas de socket, pas de chrome. Un
 * store lu ici doit tolerer un etat vide.
 * PIEGE : les redirections doivent passer par `navigate`, pas par un
 * <a href> : un rechargement complet casserait la session en memoire.
 *
 * Voir aussi : docs/08-frontend.md - section 10.1 (Pages de src/app/pages/)
 */
import React from 'react';
import { Link, useNavigate } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Gamepad2, Swords, Wallet, Zap } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import ZoydLogo from '../components/branding/ZoydLogo';
import { SEOHead } from '../components/SEOHead';

// C-3 (audit UI) : regle S-7 unifiee avec LandingPage — la video decoratif de
// fond (hero-bg.mp4) ne se charge plus EN DESSOUS de 768px : decor a opacite
// faible, parti a la trappe avec les 3G/4G de l'audience. Decision prise AU
// CHARGEMENT DU MODULE (pas de remount au resize : rotation 720 -> 800 reste
// sans video, sans gravite, l'image JPG reste). Desktop inchange.
const SHOW_CARD_VIDEO = typeof window !== 'undefined'
  && window.matchMedia('(min-width: 768px)').matches;

const ModeSelectionPage: React.FC = () => {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();

  const handleMJClick = () => {
    navigate('/mj');
  };

  // La grosse carte BR vend le mode OUVERT : les salons (/br).
  const handleBRClick = () => {
    navigate('/br');
  };

  // Arbitrage 2026-11-02 : la Ligue est un EVENEMENT (hebdo, differe) — elle
  // descend sous la grille. P13 C1 (audit-3) l'avait montee sur cet ecran en
  // carte principale ; ce remaniement garde les deux chemins mais INVERSE la
  // vitrine : salons en grande carte, ligue en bande secondaire.
  const handleLeagueClick = () => {
    navigate('/br-league');
  };

  return (
    <main className="min-h-dvh bg-zoyd-black text-white font-ui scanline safe-top">
      <SEOHead
        title="Mode de jeu — ZOYD"
        description="Choisis entre Multijoueur et Battle Royale."
        path="/mode"
      />
      <a href="#mode-sélection" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-zoyd-blue focus:text-white">
        Aller au contenu principal
      </a>
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      <div id="mode-sélection" className="relative max-w-[1500px] mx-auto px-5 md:px-8 py-8 md:py-14 safe-bottom">
        <div className="flex items-center justify-between gap-4 mb-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 touch-target text-white/70 hover:text-white transition-colors text-sm uppercase font-mono tracking-widest"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </Link>
          <ZoydLogo compact />
        </div>

        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
          animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          className="max-w-4xl mb-8 md:mb-12"
        >
          <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-black uppercase italic tracking-[-0.05em] leading-[0.88] mb-4 md:mb-5">
            Choisis ton
            <br />
            <span className="text-zoyd-yellow">terrain de jeu.</span>
          </h1>
          <p className="text-white/46 text-base sm:text-lg md:text-xl leading-relaxed max-w-3xl">
            Ton profil, ton portefeuille et ta progression restent dans le même espace. Tu entres dans le mode que tu
            veux suivre maintenant, puis ZOYD garde tout relié autour de ton compte.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 xl:grid-cols-[1.05fr_0.95fr] gap-6 md:gap-8">
          <motion.button
            initial={prefersReducedMotion ? false : { opacity: 0, x: -18 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
            transition={prefersReducedMotion ? { duration: 0 } : { delay: 0.08 }}
            onClick={handleMJClick}
            className="group text-left h-full"
          >
            <div className="relative h-full min-h-[350px] sm:min-h-[420px] md:min-h-[520px] overflow-hidden border border-zoyd-blue/20 bg-black hover:border-zoyd-yellow transition-all duration-300 group/card">
              <img src="/assets/images/codm-1.jpg" alt="Multijoueur" className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-luminosity grayscale group-hover/card:scale-105 group-hover/card:grayscale-0 transition-all duration-700" />
              {SHOW_CARD_VIDEO && (
                <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover/card:opacity-40 transition-opacity duration-700 pointer-events-none">
                  <source src="/assets/codm/videos/hero-bg.mp4" type="video/mp4" />
                </video>
              )}
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
                  <p className="text-white/75 text-base sm:text-lg leading-relaxed max-w-2xl mb-6 md:mb-8">
                    Matchs publics, tournois et progression joueur déjà liés à ton compte.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 md:mb-8">
                    <InfoChip label="Parties" value="Matchs + tournois" />
                    <InfoChip label="Compte" value="Profil centralisé" />
                    <InfoChip label="Wallet" value="Actif" className="col-span-2 sm:col-span-1" />
                  </div>

                  <div className="inline-flex items-center justify-center w-full gap-3 bg-white text-black px-6 py-4 touch-target font-display font-black uppercase tracking-[0.22em] text-xs italic group-hover:bg-zoyd-yellow transition-colors">
                    Entrer en MJ
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </div>
            </div>
          </motion.button>

          <motion.button
            initial={prefersReducedMotion ? false : { opacity: 0, x: 18 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
            transition={prefersReducedMotion ? { duration: 0 } : { delay: 0.14 }}
            onClick={handleBRClick}
            className="group text-left h-full mt-4 lg:mt-0"
          >
            <div className="relative h-full min-h-[350px] sm:min-h-[420px] md:min-h-[520px] overflow-hidden border border-zoyd-yellow/20 bg-black/80 hover:border-zoyd-yellow/40 transition-all duration-300 group/br">
              <img src="/assets/images/codm-2.jpg" alt="Battle Royale" className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-luminosity grayscale group-hover/br:scale-105 group-hover/br:grayscale-0 transition-all duration-700" />
              {SHOW_CARD_VIDEO && (
                <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover/br:opacity-24 transition-opacity duration-700 pointer-events-none">
                  <source src="/assets/codm/videos/hero-bg.mp4" type="video/mp4" />
                </video>
              )}
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,10,0.28),rgba(10,10,10,0.78)_52%,rgba(10,10,10,0.97))]" />

              <div className="relative z-10 h-full p-6 sm:p-8 md:p-10 flex flex-col justify-between">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-10">
                  <Badge variant="yellow">DISPONIBLE</Badge>
                  <div className="border border-white/10 bg-black/35 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.24em] text-zoyd-yellow text-center">
                    Salons ouverts
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
                  <p className="text-white/75 text-base sm:text-lg leading-relaxed max-w-2xl mb-6 md:mb-8">
                    Salons ouverts, inscriptions directes : crée ton salon — tu en seras l&apos;arbitre — ou rejoins un
                    salon en préparation. Ton pass est remboursable si tu te désinscris avant le lancement.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 md:mb-8">
                    <InfoChip label="Salon" value="À la demande" />
                    <InfoChip label="Pass" value="Remboursable" />
                    <InfoChip label="Création" value="Ouverte à tous" className="col-span-2 sm:col-span-1" />
                  </div>

                  <div className="inline-flex items-center justify-center w-full gap-3 bg-zoyd-yellow text-black px-6 py-4 touch-target font-display font-black uppercase tracking-[0.22em] text-xs italic group-hover:bg-white transition-colors">
                    Entrer en Battle Royale
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </div>
            </div>
          </motion.button>
        </div>

        {/* Hierarchie produit (arbitrage 2026-11-02) : les deux grandes cartes
            vendent les modes OUVERTS (MJ, salons BR). La BR League est un
            EVENEMENT hebdomadaire differe — elle vit ici en bande secondaire,
            etiquetee comme telle. P13 C1 (audit-3) l'avait montee sur cet
            ecran en carte principale ; la decision inverse la vitrine sans
            retirer le chemin : /br-league reste rejouable depuis la bande.
            La regle pass remboursable avant lancement reste affichee sur les
            salons (carte BR ci-dessus), pas dupliquee ici. */}
        <motion.button
          initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
          animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : { delay: 0.16 }}
          onClick={handleLeagueClick}
          className="group w-full mt-6 md:mt-8 text-left"
        >
          <div className="border border-white/8 bg-zoyd-surface/20 hover:border-zoyd-yellow transition-all duration-300 px-5 md:px-6 py-4 md:py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3 md:gap-4">
              <Zap className="w-5 h-5 text-zoyd-yellow shrink-0 mt-1" />
              <div>
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <span className="text-base sm:text-lg font-display font-black uppercase italic text-white">BR League</span>
                  <span className="border border-zoyd-yellow/30 bg-zoyd-yellow/10 text-zoyd-yellow px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.22em]">Événement hebdomadaire</span>
                  <span className="border border-white/10 bg-white/5 text-white/70 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.22em]">Ouverture différée</span>
                </div>
                <div className="text-sm text-white/60">
                  500 joueurs, 5 jours de qualification, 1 finale. Les saisons démarrent après l&apos;ouverture
                  publique — les salons Battle Royale ci-dessus, eux, sont ouverts dès maintenant.
                </div>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.24em] text-white/70 shrink-0">
              Voir la ligue
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </motion.button>

        <div className="mt-8 md:mt-10 border border-white/8 bg-zoyd-surface/20 px-5 md:px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-white/70 mb-1.5 md:mb-2">Compte ZOYD</div>
            <div className="text-base sm:text-lg font-display font-black italic text-white">
              Un seul profil pour tes modes, tes matchs et ton portefeuille.
            </div>
          </div>
          <div className="inline-flex items-start md:items-center gap-2 md:gap-3 text-sm text-white/52">
            <Wallet className="w-4 h-4 text-zoyd-yellow shrink-0 mt-0.5 md:mt-0" />
            Tout reste relié à ton espace joueur.
          </div>
        </div>
      </div>
    </main>
  );
};

const InfoChip = ({ label, value, className = '' }: { label: string; value: string; className?: string }) => (
  <div className={`border border-white/8 bg-black/35 px-3 md:px-4 py-2.5 md:py-3 ${className}`}>
    <div className="text-[10px] md:text-[10px] font-mono uppercase tracking-[0.22em] text-white/70 mb-1">{label}</div>
    <div className="text-sm md:text-base font-display font-black uppercase italic text-white leading-tight">{value}</div>
  </div>
);

export default ModeSelectionPage;
