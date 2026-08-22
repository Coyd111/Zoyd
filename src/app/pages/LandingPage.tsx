import React, { useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  ChevronDown,
  Menu,
  ShieldCheck,
  Swords,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { LANDING_TICKER_ITEMS } from '../../lib/competition';
import ZoydLogo from '../components/branding/ZoydLogo';

const platformCards = [
  {
    title: 'Wagers Sécurisés',
    description:
      'Mise sur ton talent en 1v1 ou 2v2. Un arbitre ZOYD est toujours présent en jeu pour garantir l\'équité. Zéro screenshot requis.',
    icon: ShieldCheck,
  },
  {
    title: 'Arbitrage Rémunéré',
    description:
      'Pas le niveau pour jouer ? Rejoins les matchs en tant que spectateur, veille au respect des règles et encaisse des commissions réelles.',
    icon: Users,
  },
  {
    title: 'Mobile Money Intégré',
    description:
      'Gère tes dépôts et retire tes gains instantanément via MTN, Moov ou Celtiis directement depuis ton téléphone.',
    icon: Wallet,
  },
];

const playerJourney = [
  {
    title: 'Creer ton compte',
    body: 'Inscris-toi, associe ton UID CODM et choisis ton rôle (Joueur ou Arbitre).',
  },
  {
    title: 'Le Choix de l\'Arène',
    body: 'Crée un pari pour prouver ta force, ou rejoins un match en attente d\'arbitre pour travailler.',
  },
  {
    title: 'Le Match et les Gains',
    body: 'Joue ta partie ou spectate-la. À la fin, le gagnant et l\'arbitre sont payés instantanément.',
  },
];

export default function LandingPage() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline selection:bg-zoyd-yellow selection:text-black overflow-x-hidden safe-top">
      <LandingNav />

      <main className="relative">
        <section id="hero" className="relative min-h-dvh overflow-hidden border-b border-white/5">
          <div className="absolute inset-0">
            <video
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/logo icone.png"
              className="h-full w-full object-cover opacity-24"
            >
              <source src="/assets/codm/videos/StartVideo.mp4" type="video/mp4" />
            </video>
          </div>

          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,227,81,0.14),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(0,122,255,0.12),transparent_28%),linear-gradient(180deg,rgba(10,10,10,0.24),rgba(10,10,10,0.86)_68%,#0A0A0A)]" />
          <div className="absolute inset-0 tactical-grid opacity-10" />
          <div className="absolute inset-0 scanline opacity-20" />

          <div className="absolute left-[-10rem] top-24 h-[24rem] w-[24rem] rounded-full bg-zoyd-yellow/10 blur-[120px]" />
          <div className="absolute right-[-7rem] top-40 h-[22rem] w-[22rem] rounded-full bg-zoyd-blue/10 blur-[110px]" />

          <div className="relative z-10 max-w-[1600px] mx-auto px-5 md:px-8 pt-24 md:pt-32 pb-20 safe-bottom min-h-dvh flex items-center">
            <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-14 xl:gap-20 items-center w-full">
              <motion.div
                initial={{ opacity: 0, y: reduceMotion ? 0 : 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="max-w-3xl"
              >
                <h1 className="text-[2.5rem] md:text-[5.5rem] xl:text-[6.8rem] leading-[0.84] font-display font-black uppercase italic tracking-[-0.05em] mb-7">
                  L'Arène Ultime
                  <br />
                  de CODM en
                  <br />
                  <span className="text-zoyd-yellow">Afrique.</span>
                </h1>

                <p className="text-base md:text-xl text-white/40 leading-relaxed max-w-2xl mb-10">
                  Wagers sécurisés, arbitrage rémunéré, gains Mobile Money. La première plateforme compétitive CODM conçue pour l'Afrique.
                </p>

                <div className="flex flex-wrap gap-4 mb-8">
                  <Link
                    to="/auth/register"
                    className="inline-flex items-center gap-3 bg-white text-black px-7 md:px-9 py-4 font-display font-black uppercase tracking-[0.22em] text-xs md:text-sm italic hover:bg-zoyd-yellow transition-colors"
                  >
                    Commencer à jouer
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link
                    to="/auth/register"
                    className="inline-flex items-center gap-3 border border-white/10 px-7 md:px-9 py-4 font-display font-black uppercase tracking-[0.22em] text-xs md:text-sm italic text-white/60 hover:text-white hover:border-white/20 transition-colors"
                  >
                    Arbitrer un match
                  </Link>
                </div>

                <div className="grid grid-cols-2 gap-3 max-w-2xl">
                  <SignalStrip label="Gains" value="Mobile Money instantané" />
                  <SignalStrip label="Sécurité" value="Arbitre en direct" />
                  <SignalStrip label="Classement" value="Elo strict" />
                  <SignalStrip label="Formats" value="1v1, 2v2, Tournois" />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: reduceMotion ? 0 : 26 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12, duration: 0.6 }}
                className="relative"
              >
                <div className="relative">

                  <div className="relative z-10 p-6 md:p-8">
                    <div className="flex flex-col gap-4">
                      {/* En-tête Match */}
                      <div className="flex items-center justify-between pb-4">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-xs font-mono uppercase tracking-widest text-white/50">Match Live</span>
                        </div>
                        <div className="text-zoyd-yellow text-[10px] font-mono uppercase tracking-widest">
                          Wager 1v1
                        </div>
                      </div>

                      {/* VS Section */}
                      <div className="flex items-center justify-between py-2">
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-14 h-14 flex items-center justify-center bg-zoyd-blue/10 border border-zoyd-blue/20">
                            <span className="font-display font-black text-sm text-zoyd-blue">G2</span>
                          </div>
                          <span className="font-display font-black text-sm tracking-wide">GHOST_229</span>
                        </div>
                        <div className="text-3xl font-display font-black text-white/20 italic">VS</div>
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-14 h-14 flex items-center justify-center bg-zoyd-yellow/10 border border-zoyd-yellow/20">
                            <span className="font-display font-black text-sm text-zoyd-yellow">SD</span>
                          </div>
                          <span className="font-display font-black text-sm tracking-wide">SNIPER_DK</span>
                        </div>
                      </div>

                      {/* Cash Prize */}
                      <div className="p-4 flex flex-col items-center justify-center gap-1 my-2 relative overflow-hidden">
                        <span className="text-[10px] font-mono uppercase text-white/40 tracking-widest relative z-10">Cash Prize</span>
                        <span className="text-3xl font-display font-black text-zoyd-yellow relative z-10">200 ZC</span>
                      </div>

                      {/* Arbitre Info */}
                      <div className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          <ShieldCheck className="w-5 h-5 text-zoyd-blue" />
                          <div className="flex flex-col">
                            <span className="text-[10px] font-mono text-white/50 uppercase">Arbitre Officiel</span>
                            <span className="text-sm font-bold text-white/90">Mod_Alpha</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-green-400 font-mono flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                          Spectating
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/24">
            <span className="text-[10px] font-mono uppercase tracking-[0.26em]">Scroll</span>
            <ChevronDown className="w-5 h-5 animate-bounce" />
          </div>
        </section>

        <section className="border-y border-white/5 bg-zoyd-yellow py-4 overflow-hidden whitespace-nowrap">
          <div className="flex w-max gap-16 animate-marquee items-center text-black font-display font-black text-lg md:text-2xl uppercase tracking-wider italic">
            {[...LANDING_TICKER_ITEMS, ...LANDING_TICKER_ITEMS].map((item, index) => (
              <React.Fragment key={`${item}-${index}`}>
                <span>{item}</span>
                <span>///</span>
              </React.Fragment>
            ))}
          </div>
        </section>

        <section className="py-16 md:py-20 border-b border-white/5">
          <div className="max-w-[1600px] mx-auto px-6 md:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
              <StatBlock number="2 400+" label="Joueurs inscrits" />
              <StatBlock number="12 000+" label="Matchs joués" />
              <StatBlock number="85M+" label="ZC distribués" />
              <StatBlock number="98%" label="Paiements honorés" />
            </div>
          </div>
        </section>

        <section id="platform" className="py-24 md:py-32">
          <div className="max-w-[1600px] mx-auto px-6 md:px-8">
            <div className="max-w-4xl mb-14 md:mb-16">
              <h2 className="text-4xl md:text-6xl font-display font-black uppercase italic tracking-[-0.04em] leading-[0.9] mb-5">
                Tout pour jouer.<br />Tout pour gagner.
              </h2>
              <p className="text-white/40 text-lg md:text-xl leading-relaxed max-w-3xl">
                ZOYD n'est pas qu'un simple leaderboard. C'est la première Gig-Economy pour le gaming mobile en Afrique. Que tu aies un shoot de légende ou un œil de lynx pour l'arbitrage, tu peux générer des revenus réels.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {platformCards.map((card, index) => (
                <motion.div
                  key={card.title}
                  initial={{ opacity: 0, y: reduceMotion ? 0 : 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ delay: index * 0.08, duration: 0.45 }}
                  className="p-7 md:p-8 transition-colors"
                >
                  <div className="w-14 h-14 flex items-center justify-center text-zoyd-yellow mb-8">
                    <card.icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-display font-black uppercase italic tracking-tight mb-4">
                    {card.title}
                  </h3>
                  <p className="text-white/40 leading-relaxed text-base">{card.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="dual-economy"
          className="py-24 md:py-32 border-t border-white/5 bg-[radial-gradient(circle_at_top_right,rgba(0,122,255,0.08),transparent_30%)]"
        >
          <div className="max-w-[1600px] mx-auto px-6 md:px-8 grid lg:grid-cols-[0.92fr_1.08fr] gap-12 lg:gap-16 items-start">
            <div className="max-w-xl">
              <h2 className="text-4xl md:text-6xl font-display font-black uppercase italic tracking-[-0.04em] leading-[0.92] mb-6">
                Choisis ta voie.<br />Construis ton empire.
              </h2>
              <p className="text-white/40 text-lg leading-relaxed mb-8">
                ZOYD repose sur deux piliers : ceux qui font le spectacle, et ceux qui assurent l'équité. Les deux méritent d'être payés.
              </p>
              <div className="space-y-3">
                {[
                  'Des wagers instantanés pour le cash rapide',
                  'Des commissions réelles pour l\'arbitrage',
                  'Un écosystème sain et sans triche',
                  'Des opportunités de revenus pour tous',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-sm md:text-base text-white/40">
                    <div className="w-2 h-2 bg-zoyd-blue" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Joueur Card */}
              <div
                className="p-8 md:p-10 min-h-[310px] flex flex-col justify-between"
              >
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.28em] mb-5 text-zoyd-blue">
                    PLAY & COMPETE
                  </div>
                  <h3 className="text-3xl md:text-4xl font-display font-black uppercase italic tracking-tight mb-4">
                    Le Joueur
                  </h3>
                  <p className="text-white/40 leading-relaxed max-w-xl">
                    Mise sur ton propre talent dans des salons 1v1 ou 2v2. Monte dans le classement MMR africain et prouve que tu es une légende. ZOYD sécurise ton argent et gère tes gains.
                  </p>
                </div>
                <div className="flex items-center justify-between pt-8 mt-8">
                  <div className="flex items-center gap-3 text-sm text-white/40">
                    <Swords className="w-4 h-4 text-zoyd-blue" />
                    Entre dans l'arène
                  </div>
                  <Link
                    to="/auth/register"
                    className="inline-flex items-center gap-2 text-[10px] font-display font-black uppercase tracking-[0.22em] text-zoyd-blue hover:text-white transition-colors"
                  >
                    Défier
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>

              {/* Arbitre Card */}
              <div
                className="p-8 md:p-10 min-h-[310px] flex flex-col justify-between"
              >
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.28em] mb-5 text-zoyd-yellow">
                    WATCH & EARN
                  </div>
                  <h3 className="text-3xl md:text-4xl font-display font-black uppercase italic tracking-tight mb-4">
                    L'Arbitre
                  </h3>
                  <p className="text-white/40 leading-relaxed max-w-xl">
                    Ton shoot n'est pas incroyable mais tu connais le jeu ? Rejoins les matchs en tant que spectateur, veille au bon déroulement et touche une commission sur chaque match arbitré.
                  </p>
                </div>
                <div className="flex items-center justify-between pt-8 mt-8">
                  <div className="flex items-center gap-3 text-sm text-white/40">
                    <Users className="w-4 h-4 text-zoyd-yellow" />
                    Rejoins le staff
                  </div>
                  <Link
                    to="/auth/register"
                    className="inline-flex items-center gap-2 text-[10px] font-display font-black uppercase tracking-[0.22em] text-zoyd-yellow hover:text-white transition-colors"
                  >
                    Commencer
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="account" className="py-24 md:py-28 border-t border-white/5">
          <div className="max-w-[1600px] mx-auto px-6 md:px-8">
            <div className="p-8 md:p-10">
              <div className="max-w-3xl mb-10">
                <h2 className="text-4xl md:text-6xl font-display font-black uppercase italic tracking-[-0.04em] leading-[0.9] mb-5">
                  En trois etapes,
                  <br />
                  tu entres sur ZOYD.
                </h2>
                <p className="text-white/40 text-lg leading-relaxed">
                  Le parcours d&apos;entree doit etre simple: creer ton compte, choisir ton mode, retrouver ton activite
                  au meme endroit a chaque connexion.
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                {playerJourney.map((step, index) => (
                  <motion.div
                    key={step.title}
                    initial={{ opacity: 0, y: reduceMotion ? 0 : 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.25 }}
                    transition={{ delay: index * 0.08, duration: 0.45 }}
                    className="p-6"
                  >
                    <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-zoyd-blue mb-5">
                      Etape 0{index + 1}
                    </div>
                    <h3 className="text-2xl font-display font-black uppercase italic tracking-tight mb-3">
                      {step.title}
                    </h3>
                    <p className="text-white/40 leading-relaxed">{step.body}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="py-24 md:py-28 border-t border-white/5 bg-zoyd-surface/6">
          <div className="max-w-[1600px] mx-auto px-6 md:px-8 text-center">
            <h2 className="text-4xl md:text-6xl font-display font-black uppercase italic tracking-[-0.04em] leading-[0.9] mb-5">
              Entre sur ZOYD
              <br />
              et choisis ton <span className="text-zoyd-yellow">terrain</span>.
            </h2>
            <p className="text-white/40 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-10">
              Cree ton compte, configure ton profil CODM et retrouve une plateforme pensee pour la competition, la
              progression et tes gains.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              <Link
                to="/auth/register"
                className="inline-flex items-center gap-3 bg-white text-black px-8 md:px-10 py-4 font-display font-black uppercase tracking-[0.22em] text-xs md:text-sm italic hover:bg-zoyd-yellow transition-colors"
              >
                Creer mon compte
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/auth/login"
                className="inline-flex items-center gap-3 border border-white/10 px-8 md:px-10 py-4 font-display font-black uppercase tracking-[0.22em] text-xs md:text-sm italic text-white/60 hover:text-white hover:border-white/20 transition-colors"
              >
                Me connecter
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-black">
          <div className="max-w-[1600px] mx-auto px-5 md:px-8 py-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <ZoydLogo compact />
          <div className="flex flex-wrap gap-8 text-[10px] font-mono uppercase tracking-[0.28em] text-white/28">
            <Link to="/auth/register" className="hover:text-white/60 transition-colors">Inscription</Link>
            <Link to="/auth/login" className="hover:text-white/60 transition-colors">Connexion</Link>
            <Link to="/mode" className="hover:text-white/60 transition-colors">MJ + BR</Link>
            <Link to="/classements" className="hover:text-white/60 transition-colors">Classements</Link>
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/16">
            © 2026 ZOYD Platform
          </div>
        </div>
      </footer>
    </div>
  );
}

function LandingNav() {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
      <nav className="fixed inset-x-0 top-0 z-50 bg-zoyd-black/72 backdrop-blur-xl safe-top">
      <div className="max-w-[1600px] mx-auto px-5 md:px-8 h-16 flex items-center justify-between gap-6">
        <Link to="/" className="shrink-0">
          <ZoydLogo compact />
        </Link>

        <div className="hidden lg:flex items-center gap-10 text-[10px] font-mono uppercase tracking-[0.28em] text-white/20">
          <a href="#platform" className="hover:text-white transition-colors">
            Plateforme
          </a>
          <a href="#dual-economy" className="hover:text-white transition-colors">
            Joueur / Arbitre
          </a>
          <a href="#account" className="hover:text-white transition-colors">
            Compte
          </a>
        </div>

        <div className="hidden lg:flex items-center gap-3 md:gap-4">
          <Link
            to="/auth/login"
            className="text-[10px] md:text-[11px] font-display font-black uppercase tracking-[0.22em] text-white/40 hover:text-white transition-colors italic"
          >
            Connexion
          </Link>
          <Link
            to="/auth/register"
            className="inline-flex items-center gap-2 bg-white text-black px-4 md:px-6 py-3 text-[10px] md:text-[11px] font-display font-black uppercase tracking-[0.22em] italic hover:bg-zoyd-yellow transition-colors"
          >
            Commencer
          </Link>
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="lg:hidden touch-target flex items-center justify-center text-white/60 hover:text-white transition-colors"
          aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="lg:hidden bg-zoyd-black/95 backdrop-blur-xl border-t border-white/5 px-5 py-6 space-y-1 safe-bottom"
        >
          <a href="#platform" onClick={() => setMobileOpen(false)} className="block text-[11px] font-mono uppercase tracking-[0.28em] text-white/40 hover:text-white transition-colors py-3 touch-target">
            Plateforme
          </a>
          <a href="#dual-economy" onClick={() => setMobileOpen(false)} className="block text-[11px] font-mono uppercase tracking-[0.28em] text-white/40 hover:text-white transition-colors py-3 touch-target">
            Joueur / Arbitre
          </a>
          <a href="#account" onClick={() => setMobileOpen(false)} className="block text-[11px] font-mono uppercase tracking-[0.28em] text-white/40 hover:text-white transition-colors py-3 touch-target">
            Compte
          </a>
          <div className="border-t border-white/5 pt-4 space-y-3">
          <Link
            to="/auth/login"
            onClick={() => setMobileOpen(false)}
            className="block text-center text-[11px] font-display font-black uppercase tracking-[0.22em] text-white/40 hover:text-white transition-colors italic py-3 touch-target"
          >
            Connexion
          </Link>
          <Link
            to="/auth/register"
            onClick={() => setMobileOpen(false)}
            className="block text-center bg-white text-black px-6 py-4 text-[11px] font-display font-black uppercase tracking-[0.22em] italic hover:bg-zoyd-yellow transition-colors touch-target"
          >
              Commencer
            </Link>
          </div>
        </motion.div>
      )}
    </nav>
  );
}

function SignalStrip({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/24 mb-1">{label}</div>
      <div className="font-display font-black uppercase italic tracking-tight text-white">{value}</div>
    </div>
  );
}

function StatBlock({ number, label }: { number: string; label: string }) {
  return (
    <div className="text-center md:text-left">
      <div className="text-3xl md:text-4xl font-display font-black text-zoyd-yellow italic mb-1">{number}</div>
      <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/20">{label}</div>
    </div>
  );
}
