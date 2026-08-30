import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import {
  Newspaper, Zap, Swords, Bug, Trophy, ChevronRight,
  TrendingUp, Shield, ShoppingBag, Search,
  Crosshair, Star, AlertTriangle, Gamepad2, Clock,
} from 'lucide-react';
import { SEOHead } from '../components/SEOHead';
import { fetchCODMStoreBundles, type CodashopBundle } from '../../lib/codmApi';
import {
  WEAPON_DATA, WEAPON_CATEGORIES, TOTAL_WEAPONS,
  type WeaponCategory,
} from '../../lib/codmWeaponData';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeakCategory = 'all' | 'saison' | 'armes' | 'competition' | 'patches';
type LiveTab = 'bundles' | 'armes';

// ---------------------------------------------------------------------------
// Real articles — Septembre 2026
// ---------------------------------------------------------------------------

const categories: { id: LeakCategory; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'all', label: 'TOUT', icon: Newspaper },
  { id: 'saison', label: 'SAISON', icon: Zap },
  { id: 'armes', label: 'ARMES', icon: Swords },
  { id: 'competition', label: 'COMPETITION', icon: Trophy },
  { id: 'patches', label: 'PATCHES', icon: Bug },
];

interface LeakArticle {
  id: string;
  title: string;
  excerpt: string;
  content: string[];
  category: LeakCategory;
  date: string;
  tag?: string;
  readTime: string;
  hot?: boolean;
  source?: string;
  image?: string;
}

const articles: LeakArticle[] = [
  {
    id: '1',
    title: 'CODM x Honkai Impact 3rd — La premiere collab Tencent x HoYoverse',
    excerpt: 'Officiellement annoncee le 7 Aout lors du livestream S7, la collaboration historique avec Honkai Impact 3rd arrive en Septembre avec les skins Kiana, Raiden Mei et Bronya.',
    content: [
      'C\'est la premiere fois que Tencent (CODM) et miHoYo/HoYoverse collaborent sur un jeu mobile. Annoncee lors du livestream de l\'anniversaire S7 le 7 Aout 2026, cette collaboration historique est confirmeee pour le lancement de la Saison 8.',
      'Les trois Herrscher arriveront en tant que skins Operateur specialises : Kiana Kaslana (Herrscher of Flamescion) sur Siren, Raiden Mei (Herrscher of Thunder) sur Rin Yoshida, et Bronya Zaychik (Herrscher of Reason) sur Kestrel.',
      'Le teaser officiel montre l\'ascenseur de l\'Hyperion Bridge de Honkai Impact 3rd s\'ouvrant sur le logo conjoint. La date de sortie prevue est le 3 Septembre 2026.',
    ],
    category: 'saison',
    date: '27 Aout 2026',
    tag: 'CONFIRME',
    readTime: '4 min',
    hot: true,
    source: 'CODM Official Livestream + GameMarket.gg',
    image: 'https://www.callofduty.com/content/dam/atvi/callofduty/cod-touchui/blog/body/codm/CODM-S8-ANNOUNCE-TOUT-1.jpg',
  },
  {
    id: '2',
    title: 'Saison 8 "Twilight Heist" — Date de sortie et nouveau Battle Pass',
    excerpt: 'La Saison 8 de CODM baptisee "Twilight Heist" debute le 3 Septembre. Nouvelle arme RAM-7, nouveau Battle Pass, et skins mythiques.',
    content: [
      'La Saison 8 de Call of Duty Mobile, intitulee "Twilight Heist", est schedulee pour le 3 Septembre 2026. C\'est une saison majeure qui marque le debut de la deuxieme moitie de l\'annee 2026.',
      'Le Battle Pass de la S8 comprend la RAM-7 comme nouvelle arme gratuite (assault rifle polyvalent close/mid-range), plus des skins pour Klepto (Legendary Twilight Traitor), et des blueprints premium incluant le KRM-262 Nitrous Neutralizer, TEC-9 Lawful Authority, Swordfish Perp Walker, et Arctic .50 Burn Unit.',
      'Le Challenge Pass offre le M1 Garand Bayonet (signature attachment), le Predator Missile Guided Attack (scorestreak reskin), et le ReskinMaddox Legal Problem.',
    ],
    category: 'saison',
    date: '26 Aout 2026',
    tag: 'CONFIRME',
    readTime: '5 min',
    hot: true,
    source: 'LootBar + SportsDunia',
    image: '/assets/images/codm-1.jpg',
  },
  {
    id: '3',
    title: 'Mythique RAM-7 "Nebula\'s Brush" — Le premier mythique de la S8',
    excerpt: 'La Whorl of Midnight Mythic Draw propose la RAM-7 Mythique avec un design cosmique, accompagnee du skin Legendary Klepto Twilight Traitor.',
    content: [
      'La Whorl of Midnight Mythic Draw est la principale attraction du store en S8. Elle contient la RAM-7 Nebula\'s Brush, un weapon blueprint mythique avec un design cosmique/nebuleux.',
      'Le draw comprend egalement le skin Legendary Klepto "Twilight Traitor", une Smoke Grenade "Whorl of Midnight" tactical blueprint, et un melee "Streaked Shoveler" weapon blueprint.',
      'La RAM-7 est decrite comme un assault rifle puissant close-to-mid-range avec un stopping power impressionnant et un recoil manageable. C\'est la premiere fois que cette arme (initialement popularisee dans MW2) arrive dans CODM.',
    ],
    category: 'armes',
    date: '25 Aout 2026',
    tag: 'LEAK',
    readTime: '4 min',
    source: 'LootBar + Test Server',
    image: '/assets/images/codm-2.jpg',
  },
  {
    id: '4',
    title: 'Balance Changes S8 — Buffs du S36, Lachmann, Fennec et nerf du FSS Hurricane',
    excerpt: 'Le patch S8 rebalancera les armes avec des buffs majeurs sur le S36, Cronen Squall, et Fennec, tandis que le FSS Hurricane et le Hades seront nerfes.',
    content: [
      'Les changements de balance de la S8 sont deja visibles sur le test server. Voici les principaux buffs :',
      'BUFFS : Lachmann 5.56 (bullet impact 1→1.2, STF -20%), Chopper (+15% ADS movement avec Heavy Handle), S36 (ADS 420→380ms, STF 180→150ms), Cronen Squall (improved ranges, tighter BSA), Fennec (improved range profile), Krig 6 (nouveau phase 31 degats a 10m), FFAR 1 (range initial 6.6→10m), LAPA (31/28/20/16 → 33/29/22/16), Arctic .50 (moins de recoil vertical).',
      'NERFS : FSS Hurricane (sprint speed 6.41→6.26m/s, -6% ADS movement avec FTac Coldforge), Hades (range 16-32m → 12-28m en BR).',
      'BR CLASSES : Jet Boost (wall-running supprime), Defender (damage resistance a l\'activation supprimee), Shockwave (degats reduits), Rewind (ne reset plus la vie a l\'activation). Quick Strike (distance 15/20/35→5/10/10m, degats 50/80/150→100/150/250).',
    ],
    category: 'patches',
    date: '26 Aout 2026',
    tag: 'TEST SERVER',
    readTime: '6 min',
    hot: true,
    source: 'SportsDunia + Test Server',
    image: '/assets/images/codm-3.jpg',
  },
  {
    id: '5',
    title: 'Skins Legendaries S8 — AK117 "Phase of the Moon", GRAV, Dingo',
    excerpt: 'Les fichiers du test server revelent trois nouveaux legendaries pour la S8 : AK117 Phase of the Moon, GRAV Blood Sacrifice, et Dingo Rock Burst.',
    content: [
      'De nouveaux weapon blueprints legendary ont ete decouverts dans les fichiers du test server pour la Saison 8 et 9 :',
      'SAISON 8 LEGENDARIES : AK117 "Phase of the Moon" (design lunar), GRAV "Blood Sacrifice" (theme sombre), Dingo "Rock Burst" (style explosif). Ces armes seront disponibles via des Lucky Draws ou Armory Series.',
      'SAISON 8 EPICS : LW3 Tundra DurCXB, Machine Pistol DurCXB, M13 Hazardous, SPR 208 A Nature, MW11 Spirit Breaker. Ces skins seront dans le Battle Pass ou des events.',
      'SAISON 9 (Apercu) : Les legendaries S8 s\'etendront probablement en S9 avec de nouveaux draws. Un Mythic Signal 50 est egalement attendu pour la S10.',
    ],
    category: 'armes',
    date: '24 Aout 2026',
    tag: 'LEAK',
    readTime: '4 min',
    source: 'SportsDunia + Datamine',
    image: '/assets/images/codm-4.jpg',
  },
  {
    id: '6',
    title: '7eme Anniversaire — Skin Urban Tracker GRATUIT + Vote Mythique',
    excerpt: 'Pour le 7eme anniversaire de CODM, un skin Urban Tracker gratuit sera distribue via un event login. Un event de vote pour une arme mythique est aussi prevu.',
    content: [
      'Le 7eme anniversaire de Call of Duty Mobile est prevu pour la Saison 9 (Octobre 2026). Les premiers leaks revelent des recompenses importantes :',
      'SKIN GRATUIT : Un skin Urban Tracker gratuit sera distribué via un simple event login airdrop. C\'est l\'un des skins les plus demandés par la communauté.',
      'VOTE MYTHIQUE : Un event de vote permettra aux joueurs de choisir quelle arme mythique sera ajoutée dans le futur. C\'est la première fois qu\'un tel event est organisé.',
      'BATTLE PASS VAULT : Trois Battle Pass passes seront ajoutes au Vault en S8/S9, incluant le Shadow Operatives (S8 2024), le Nightmare (S9 2021), et le To the Skies (S6 2022).',
    ],
    category: 'saison',
    date: '23 Aout 2026',
    tag: 'LEAK',
    readTime: '3 min',
    source: 'ZORO CODM + Community',
    image: '/assets/images/codm-5.jpg',
  },
  {
    id: '7',
    title: 'Ranked Festival — Nouvel event cumulatif pour les joueurs Ranked',
    excerpt: 'CODM ajoute un "Ranked Festival" : plus tu joues de matchs Ranked (MP et BR), plus tu gagnes de recompenses exclusives, dont l\'ASM10 Turbulent Mayhem.',
    content: [
      'Un nouveau systeme d\'evenement nomme "Ranked Festival" sera introduit en S8 pour recompenser les joueurs actifs en Ranked Play.',
      'COMMENT CA MARCHE : Chaque match Ranked joue (MP ou BR) te donne des points d\'event. Plus tu joues, plus tu debloques de recompenses. C\'est en PLUS des recompenses Ranked habituelles.',
      'RECOMPENSES : L\'ASM10 "Turbulent Mayhem" est la recompense principale. D\'autres items incluent des Calling Cards, Sprays, et Vault Coins.',
      'CE QUE CA CHANGE : C\'est la première fois que CODM récompense spécifiquement l\'activité en Ranked au-delà du classement. Ca devrait augmenter la player base Ranked.',
    ],
    category: 'competition',
    date: '22 Aout 2026',
    tag: 'CONFIRME',
    readTime: '3 min',
    source: 'LootBar + Patch Notes',
    image: '/assets/images/codm-6.jpg',
  },
  {
    id: '8',
    title: 'Buffs Equipement S8 — Drill Charge 2x plus rapide, Sticky Grenade buff',
    excerpt: 'Le patch S8 buff egalement les equipements : Drill Charge detonation 1.4→0.7s, Sticky Grenade radius et degats augmentes, plus de Flash Drone et Inflatable Decoy.',
    content: [
      'Les changements d\'equipement de la S8 sont significatifs et pourraient changer la meta des tactical/lethal :',
      'BUFFS MAJEURS : Drill Charge (detonation 1.4→0.7s, degats min 60→80), Sticky Grenade (radius 5→5.5m, degats min 55→80), Flash Drone (quantite 1→2), Inflatable Decoy (quantite 1→2), EMP (detonation 1.5→1.2s), Douser Grenade (radius 3→4m, quantite 2→3).',
      'SHOCK STICK : Ajout d\'une fonction quick-throw pour une vitesse de lancer plus rapide. C\'est un buff indirect significatif.',
      'IMPACT META : Le Drill Charge deviendra probablement le lethal meta pour les modes objectif (Hardpoint, Domination) grace a sa vitesse de detonation reduite de moitie.',
    ],
    category: 'patches',
    date: '21 Aout 2026',
    tag: 'TEST SERVER',
    readTime: '3 min',
    source: 'SportsDunia',
    image: '/assets/images/codm-7.jpg',
  },
];

const categoryColors: Record<LeakCategory, string> = {
  all: 'text-white/60 border-white/10',
  saison: 'text-zoyd-yellow border-zoyd-yellow/30',
  armes: 'text-red-400 border-red-400/30',
  competition: 'text-zoyd-blue border-zoyd-blue/30',
  patches: 'text-orange-400 border-orange-400/30',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LeaksPage: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<LeakCategory>('all');
  const [activeLiveTab, setActiveLiveTab] = useState<LiveTab>('bundles');
  const [bundles, setBundles] = useState<CodashopBundle[]>([]);
  const [bundlesLoading, setBundlesLoading] = useState(true);
  const [selectedWeaponCategory, setSelectedWeaponCategory] = useState<WeaponCategory>('Assault Rifles');
  const [weaponSearch, setWeaponSearch] = useState('');
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(new Set());
  const toggleArticle = (id: string) => setExpandedArticles((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());
  const markImgError = (key: string) => setImgErrors((prev) => { const n = new Set(prev); n.add(key); return n; });
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBundlesLoading(true);
      try {
        const data = await fetchCODMStoreBundles();
        if (!cancelled) {
          setBundles(data);
          setBundlesLoading(false);
        }
      } catch {
        if (!cancelled) {
          setBundlesLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredArticles = activeCategory === 'all'
    ? articles
    : articles.filter((a) => a.category === activeCategory);

  const featured = articles.find((a) => a.hot && a.category === 'saison') || articles[0];
  const latestArticles = filteredArticles.filter((a) => a.id !== featured.id || activeCategory !== 'all');

  const currentWeapons = WEAPON_DATA.weapons[selectedWeaponCategory];
  const searchedWeapons = weaponSearch
    ? currentWeapons.filter((w) => w.toLowerCase().includes(weaponSearch.toLowerCase()))
    : currentWeapons;

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline pb-24">
      <SEOHead
        title="Leaks &amp; Infos CODM — ZOYD"
        description="Les dernieres leaks, nouveautes et infos de Call of Duty Mobile 2026. Saison Twilight Heist, RAM-7 Mythic, balance changes."
        path="/infos"
      />
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      {/* Header */}
      <header className="relative border-b border-white/5 bg-zoyd-black pt-16">
        <div className="absolute inset-0 z-0">
          <img src="/assets/images/codm-5.jpg" alt="" loading="lazy" className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale pointer-events-none" />
          <img src="/assets/images/codm-6.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/60 to-transparent" />
        </div>
        <div className="relative z-10 max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 pb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow">
              <Newspaper className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono font-black tracking-[0.4em] text-zoyd-yellow uppercase italic">
              Avant tout le monde
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-8xl font-display font-black uppercase tracking-tighter italic leading-[0.9]">
            Leaks
            <br />
            <span className="text-white/40 underline decoration-zoyd-yellow/50 underline-offset-8">
              &amp; Infos
            </span>
          </h1>
          <p className="mt-5 max-w-3xl text-sm text-white/40">
            Septembre 2026 — Saison 8 "Twilight Heist", collab Honkai Impact 3rd, RAM-7 Mythic, balance changes majeures. Sois le premier informe.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-[10px] font-mono text-white/30">
            <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> Mis a jour: 27 Aout 2026</span>
            <span className="flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 text-zoyd-yellow" /> S8 lance le 3 Septembre</span>
          </div>
        </div>
      </header>

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-12 relative z-10">

        {/* Live Data Tabs */}
        <div className="mb-12 border border-white/10 bg-zoyd-surface/30">
          <div className="flex border-b border-white/5">
            {([
              { id: 'bundles' as LiveTab, label: 'BOUTIQUE CODM', icon: ShoppingBag, badge: bundles.length > 0 ? bundles.length : undefined },
              { id: 'armes' as LiveTab, label: 'BASE ARMES', icon: Swords, badge: String(TOTAL_WEAPONS) },
            ]).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeLiveTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveLiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-2.5 font-display font-black text-[10px] tracking-[0.15em] italic uppercase transition-all border whitespace-nowrap touch-target ${
                    isActive
                      ? 'bg-white text-black border-white'
                      : 'text-white/30 border-white/5 hover:border-white/20 hover:text-white/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {tab.badge && (
                    <span className="bg-zoyd-blue text-white text-[10px] px-1.5 py-0.5 font-bold ml-1">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {activeLiveTab === 'bundles' && (
            <div className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-black text-sm uppercase tracking-tighter italic text-white">
                    Offres en cours
                  </h3>
                  <p className="text-[10px] font-mono text-white/30 mt-1">Donnees temps reel depuis le store CODM</p>
                </div>
                {bundlesLoading && (
                  <div className="flex items-center gap-2 text-[10px] font-mono text-white/30">
                    <div className="w-3 h-3 border border-zoyd-yellow border-t-transparent rounded-full animate-spin" />
                    Chargement...
                  </div>
                )}
              </div>
              {!bundlesLoading && bundles.length === 0 && (
                <div className="text-center py-8 text-white/30 text-sm">Donnees du store temporairement indisponibles.</div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {bundlesLoading && Array.from({ length: 6 }).map((_, i) => (
                  <div key={'skel-' + i} className="border border-white/5 bg-zoyd-surface/20 overflow-hidden animate-pulse">
                    <div className="aspect-square bg-zoyd-surface/50" />
                    <div className="p-3 space-y-2">
                      <div className="h-2.5 bg-zoyd-surface/60 rounded w-3/4" />
                      <div className="h-2 bg-zoyd-surface/40 rounded w-1/2" />
                    </div>
                  </div>
                ))}
                {!bundlesLoading && bundles.slice(0, 12).map((bundle, i) => (
                  <motion.a
                    key={bundle.id + i}
                    href="https://store.callofdutymobile.com/product/codm"
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
                    animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i * 0.05, 0.4) }}
                    className="border border-white/5 bg-zoyd-surface/20 overflow-hidden group hover:border-white/20 transition-all block"
                  >
                    <div className="aspect-square relative bg-zoyd-surface/50 flex items-center justify-center overflow-hidden pointer-events-none">
                      {bundle.imageUrl && !imgErrors.has('bundle-' + bundle.id) ? (
                        <img src={bundle.imageUrl} alt={bundle.title} onError={() => markImgError('bundle-' + bundle.id)} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" loading="lazy" />
                      ) : (
                        <ShoppingBag className="w-8 h-8 text-white/10" />
                      )}
                      <div className="absolute pointer-events-none">
                        {bundle.isFree && <div className="bg-green-500 text-black text-[10px] font-mono font-black px-1.5 py-0.5 uppercase">Gratuit</div>}
                        {bundle.isLuckyDraw && <div className="bg-purple-500 text-white text-[10px] font-mono font-black px-1.5 py-0.5 uppercase">Lucky Draw</div>}
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="font-display font-black text-[10px] uppercase tracking-tight italic text-white truncate">{bundle.title || 'Bundle'}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] font-mono text-white/40">{bundle.isFree ? 'Gratuit' : `${bundle.price} ${bundle.currency}`}</span>
                        {bundle.isPopular && <Star className="w-3 h-3 text-zoyd-yellow" />}
                      </div>
                    </div>
                  </motion.a>
                ))}
              </div>
            </div>
          )}

          {activeLiveTab === 'armes' && (
            <div className="p-4 md:p-6">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-4 mb-6">
                <div className="flex-1">
                  <h3 className="font-display font-black text-sm uppercase tracking-tighter italic text-white">{TOTAL_WEAPONS} armes — S5 2026</h3>
                  <p className="text-[10px] font-mono text-white/30 mt-1">Base de donnees complete avec categories</p>
                </div>
                <div className="relative w-full md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input type="text" placeholder="Rechercher une arme..." value={weaponSearch} onChange={(e) => setWeaponSearch(e.target.value)}
                    className="w-full bg-zoyd-surface/50 border border-white/10 text-white text-xs font-mono pl-9 pr-4 py-2.5 placeholder:text-white/30 focus:border-zoyd-yellow/50 transition-colors" />
                </div>
              </div>
              <div className="flex flex-nowrap gap-1.5 mb-6 overflow-x-auto scrollbar-hide pb-2">
                {WEAPON_CATEGORIES.map((cat) => (
                  <button key={cat} onClick={() => { setSelectedWeaponCategory(cat); setWeaponSearch(''); }}
                    className={`px-3 py-1.5 font-display font-black text-[10px] tracking-wider italic uppercase whitespace-nowrap transition-all border ${
                      selectedWeaponCategory === cat ? 'bg-white text-black border-white' : 'text-white/30 border-white/5 hover:border-white/20 hover:text-white/60'
                    }`}>{cat}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {searchedWeapons.map((weapon, i) => (
                  <motion.div key={weapon} initial={prefersReducedMotion ? false : { opacity: 0, y: 5 }}
                    animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="border border-white/5 bg-zoyd-surface/20 p-3 hover:border-white/20 hover:bg-zoyd-surface/40 transition-all group cursor-pointer">
                    <div className="flex items-center gap-2 mb-2">
                      <Crosshair className="w-3 h-3 text-zoyd-yellow/50 group-hover:text-zoyd-yellow transition-colors" />
                      <span className="font-display font-black text-[10px] uppercase tracking-tight italic text-white truncate">{weapon}</span>
                    </div>
                    <div className="text-[10px] font-mono text-white/30 uppercase">{selectedWeaponCategory}</div>
                  </motion.div>
                ))}
              </div>
              {searchedWeapons.length === 0 && <div className="text-center py-6 text-white/30 text-sm">Aucune arme trouvée.</div>}
            </div>
          )}
        </div>

        {/* Category Filters */}
        <div role="tablist" aria-label="Categories" className="relative mb-12 border-b border-white/5 pb-4">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <button key={cat.id} role="tab" aria-selected={isActive} onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-2 px-5 py-2.5 font-display font-black text-[10px] tracking-[0.15em] italic uppercase transition-all border whitespace-nowrap touch-target ${
                    isActive ? 'bg-white text-black border-white' : 'text-white/30 border-white/5 hover:border-white/20 hover:text-white/60'
                  }`}><Icon className="w-4 h-4" />{cat.label}</button>
              );
            })}
          </div>
          <div className="absolute right-0 top-0 bottom-4 w-12 bg-gradient-to-l from-zoyd-black to-transparent pointer-events-none md:hidden" />
        </div>

        {/* Featured Article */}
        {activeCategory === 'all' && featured && (
          <motion.article
            initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-12 border border-white/10 bg-zoyd-surface/30 overflow-hidden group hover:border-zoyd-yellow/30 transition-all"
          >
            <div className="md:flex">
              <div className="md:w-1/2 aspect-video md:aspect-auto relative bg-zoyd-surface/50 overflow-hidden">
                {featured.image && !imgErrors.has('featured') ? (
                  <>
                    <img src={featured.image} alt={featured.title} onError={() => markImgError('featured')} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-r from-zoyd-black/60 via-transparent to-transparent" />
                  </>
                ) : (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-br from-zoyd-yellow/10 via-transparent to-zoyd-blue/10" />
                    <div className="relative z-10 text-center p-8">
                      <div className="w-20 h-20 border-2 border-zoyd-yellow/40 mx-auto mb-4 flex items-center justify-center">
                        <Gamepad2 className="w-10 h-10 text-zoyd-yellow" />
                      </div>
                    </div>
                  </>
                )}
                {featured.tag && <div className="absolute top-3 left-3 z-20"><span className={`text-[10px] font-mono font-black tracking-widest uppercase px-2 py-1 border bg-black/80 ${categoryColors[featured.category]}`}>{featured.tag}</span></div>}
              </div>
              <div className="md:w-1/2 p-6 md:p-8 flex flex-col justify-center">
                <div className="flex items-center gap-3 mb-4">
                  <span className={`text-[10px] font-mono font-black tracking-widest uppercase px-2 py-1 border ${categoryColors[featured.category]}`}>{featured.category}</span>
                  <span className="text-[10px] font-mono text-white/30">{featured.date}</span>
                  <span className="text-[10px] font-mono text-white/30">{featured.readTime}</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-display font-black uppercase tracking-tighter italic leading-tight mb-4 group-hover:text-zoyd-yellow transition-colors">{featured.title}</h2>
                <p className="text-sm text-white/40 mb-4 line-clamp-3">{featured.excerpt}</p>
                {featured.source && <p className="text-[10px] font-mono text-white/30 mb-4">Source: {featured.source}</p>}
                <button onClick={() => toggleArticle(featured.id)} aria-expanded={expandedArticles.has(featured.id)}
                  className="flex items-center gap-2 text-zoyd-yellow font-display font-black text-xs tracking-widest uppercase italic hover:gap-4 transition-all">
                  {expandedArticles.has(featured.id) ? 'REVOIR' : 'LIRE LA SUITE'}<ChevronRight className="w-4 h-4" />
                </button>
                {expandedArticles.has(featured.id) && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 space-y-3 border-t border-white/5 pt-4">
                    {featured.content.map((p, i) => <p key={i} className="text-sm text-white/50 leading-relaxed">{p}</p>)}
                  </motion.div>
                )}
              </div>
            </div>
          </motion.article>
        )}

        {/* Articles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {latestArticles.map((article, index) => (
            <motion.article key={article.id}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              transition={prefersReducedMotion ? { duration: 0 } : { delay: Math.min(index * 0.08, 0.5) }}
              className="border border-white/5 bg-zoyd-surface/20 overflow-hidden group hover:border-white/20 hover:bg-zoyd-surface/40 transition-all"
            >
              <div className="aspect-video relative bg-zoyd-surface/50 overflow-hidden border-b border-white/5">
                {article.image && !imgErrors.has('article-' + article.id) ? (
                  <>
                    <img src={article.image} alt={article.title} onError={() => markImgError('article-' + article.id)} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black/70 via-transparent to-transparent" />
                  </>
                ) : (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-white/[0.02]" />
                    <div className="relative z-10 flex items-center justify-center w-16 h-16 border border-white/10 group-hover:border-zoyd-yellow/30 transition-colors">
                      {article.category === 'saison' && <Zap className="w-7 h-7 text-white/30 group-hover:text-zoyd-yellow/60 transition-colors" />}
                      {article.category === 'armes' && <Swords className="w-7 h-7 text-white/30 group-hover:text-red-400/60 transition-colors" />}
                      {article.category === 'competition' && <Trophy className="w-7 h-7 text-white/30 group-hover:text-zoyd-blue/60 transition-colors" />}
                      {article.category === 'patches' && <Bug className="w-7 h-7 text-white/30 group-hover:text-orange-400/60 transition-colors" />}
                    </div>
                  </>
                )}
                {article.tag && (
                  <div className="absolute top-3 right-3 z-20">
                    <span className={`text-[10px] font-mono font-black tracking-widest uppercase px-2 py-1 border ${categoryColors[article.category]} bg-black/80`}>{article.tag}</span>
                  </div>
                )}
              </div>
              <div className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className={`text-[10px] font-mono font-black tracking-widest uppercase px-2 py-0.5 border ${categoryColors[article.category]}`}>{article.category}</span>
                  <span className="text-[10px] font-mono text-white/30">{article.date}</span>
                </div>
                <h3 className="text-sm font-display font-black uppercase tracking-tight italic leading-snug mb-2 group-hover:text-zoyd-yellow transition-colors line-clamp-2">{article.title}</h3>
                <p className="text-xs text-white/30 line-clamp-2 mb-3">{article.excerpt}</p>
                {article.source && <p className="text-[10px] font-mono text-white/15 mb-3">Source: {article.source}</p>}
                <button onClick={() => toggleArticle(article.id)} aria-expanded={expandedArticles.has(article.id)}
                  className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-mono text-white/30">{article.readTime}</span>
                  <span className="flex items-center gap-1 text-[10px] font-display font-black text-white/30 group-hover:text-zoyd-yellow transition-colors tracking-widest uppercase italic">
                    {expandedArticles.has(article.id) ? 'Masquer' : 'Lire'}<ChevronRight className="w-3 h-3" />
                  </span>
                </button>
                {expandedArticles.has(article.id) && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 space-y-2 border-t border-white/5 pt-3">
                    {article.content.map((p, i) => <p key={i} className="text-xs text-white/40 leading-relaxed">{p}</p>)}
                  </motion.div>
                )}
              </div>
            </motion.article>
          ))}
        </div>

        {filteredArticles.length === 0 && (
          <div className="border border-white/5 bg-zoyd-surface/10 p-6 md:p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-white/10 text-white/40"><Newspaper className="w-6 h-6" /></div>
            <h2 className="font-display font-black text-xl uppercase italic text-white mb-2">Aucun article</h2>
            <p className="text-sm text-white/40 max-w-xl mx-auto">Aucun article dans cette categorie.</p>
          </div>
        )}

        {/* Newsletter CTA */}
        <div className="mt-16 border border-zoyd-yellow/20 bg-zoyd-yellow/5 p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="w-12 h-12 border border-zoyd-yellow/40 flex items-center justify-center text-zoyd-yellow shrink-0"><Shield className="w-6 h-6" /></div>
            <div className="flex-1">
              <h3 className="font-display font-black text-lg uppercase tracking-tighter italic text-white mb-1">Ne rate plus rien</h3>
              <p className="text-sm text-white/40">Rejoins ZOYD pour recevoir les leaks et infos CODM en premier. Chat en direct, alerts meta et event notifications.</p>
            </div>
            <Link to="/auth/register" className="shrink-0 bg-zoyd-yellow text-black px-6 py-3 font-display font-black text-xs tracking-[0.2em] italic uppercase hover:bg-white transition-colors touch-target">REJOINDRE</Link>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'ARTICLES', value: articles.length, icon: Newspaper },
            { label: 'ARMES', value: TOTAL_WEAPONS, icon: Swords },
            { label: 'STORE', value: bundles.length || '--', icon: ShoppingBag },
            { label: 'LEAKS', value: articles.filter(a => a.tag === 'LEAK').length, icon: TrendingUp },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="border border-white/5 bg-zoyd-surface/10 p-4 text-center">
                <Icon className="w-4 h-4 text-white/30 mx-auto mb-2" />
                <div className="font-display font-black text-2xl text-zoyd-yellow italic">{stat.value}</div>
                <div className="text-[10px] font-mono font-black tracking-widest text-white/30 uppercase">{stat.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default LeaksPage;
