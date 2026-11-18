/**
 * LeaksPage - ecran ' Infos ' : etat reel de la plateforme et catalogue CODM.
 *
 * Melange des statistiques publiques, des bundles CODM (via codmApi) et des
 * donnees d'armes (codmWeaponData). Est un ecran public sous AppLayout.
 *
 * INVARIANT : les articles viennent de `src/app/data/codmNews.ts` et leurs
 * dates sont DERIVEES de `publieLe`. Aucune saison et aucune date n est
 * ecrite en dur ici : le verrou `src/lib/codm-news.test.ts` refuse une
 * saison passee presentee comme l actualite.
 *
 * INVARIANT : les appels CODM passent par le proxy backend (codmApi.ts) :
 * le navigateur ne doit jamais appeler Codashop directement (CORS, cle
 * d'API, quotas).
 * PIEGE : le catalogue d'armes est une DONNEE STATIQUE versionnee dans
 * codmWeaponData.ts, pas une source de verite sur le jeu. Ne pas y faire
 * confiance pour une regle metier.
 * PIEGE : un echec de l'API CODM ne doit pas casser la page : la section
 * catalogue doit degrader proprement, sans faire disparaitre les stats.
 * INVARIANT : « catalogue VIDE » (reponse 200 sans bundle) et « chargement
 * IMPOSSIBLE » (exception) sont deux etats distincts. Le second affiche un
 * message d'erreur et un bouton « Reessayer » ; le premier n'affiche qu'une
 * phrase — promettre un reessai sur un catalogue legitimement vide ferait
 * rejouer la meme requete pour rien.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import {
  Newspaper, Zap, Swords, Bug, Trophy, ChevronRight,
  TrendingUp, Shield, ShoppingBag, Search,
  Crosshair, Star, Gamepad2, Clock,
} from 'lucide-react';
import { SEOHead } from '../components/SEOHead';
import { fetchCODMStore, type CodashopBundle } from '../../lib/codmApi';
import {
  WEAPON_DATA, WEAPON_CATEGORIES, TOTAL_WEAPONS, VINTAGE_ARMES,
  type WeaponCategory,
} from '../../lib/codmWeaponData';
import { toCountryIso } from '../../lib/competition';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/Button';
import Illustration from '../components/ui/Illustration';
import { urlIllustration } from '../lib/illustrations';
import {
  ARTICLES_CODM,
  SAISON_CODM,
  VERIFIE_LE,
  formaterDateCodm,
  type ArticleCodm,
  type CategorieArticleCodm,
} from '../data/codmNews';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeakCategory = 'all' | CategorieArticleCodm;
type LiveTab = 'bundles' | 'armes';

const categories: { id: LeakCategory; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'all', label: 'TOUT', icon: Newspaper },
  { id: 'saison', label: 'SAISON', icon: Zap },
  { id: 'armes', label: 'ARMES', icon: Swords },
  { id: 'competition', label: 'COMPETITION', icon: Trophy },
  { id: 'patches', label: 'PATCHES', icon: Bug },
];

/** L URL du visuel d un article, ou `undefined` pour le repli graphique. */
const imageDe = (article: ArticleCodm): string | undefined =>
  article.illustration ? urlIllustration(article.illustration) : undefined;

/**
 * Le lien vers la source d un article.
 *
 * INVARIANT : la source est visible ET cliquable. Un fait sans source
 * verifiable n est pas publiable.
 * PIEGE (WCAG 2.5.3) : le nom accessible doit contenir le libelle
 * visible ; on ajoute « nouvel onglet » sans le remplacer.
 */
const LienSource: React.FC<{ article: ArticleCodm; className?: string }> = ({ article, className }) => (
  <p className={className}>
    Source :{' '}
    <a
      href={article.source.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Source : ${article.source.libelle} (nouvel onglet)`}
      className="underline decoration-white/20 underline-offset-2 hover:text-zoyd-yellow transition-colors"
    >
      {article.source.libelle}
    </a>
  </p>
);

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
  const [bundlesError, setBundlesError] = useState(false);
  // Devise reelle du catalogue Codashop (INR aujourd'hui) et faux si le prix
  // n'est pas dans la devise du joueur : l'UI le dit plutot que d'afficher
  // un montant en INR comme s'il etait en XOF.
  const [catalogCurrency, setCatalogCurrency] = useState('INR');
  const [priceIsLocal, setPriceIsLocal] = useState(false);
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
  // Devise de la boutique CODM : celle du profil du joueur (XOF par defaut),
  // pas celle de l'Inde en dur.
  const user = useAuthStore((state) => state.user);

  const [bundleRetry, setBundleRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBundlesLoading(true);
      setBundlesError(false);
      try {
        const data = await fetchCODMStore(toCountryIso(user?.country));
        if (!cancelled) {
          setBundles(data.bundles);
          setCatalogCurrency(data.catalogCurrency);
          setPriceIsLocal(data.priceIsLocal);
          setBundlesLoading(false);
        }
      } catch {
        if (!cancelled) {
          // Garde les bundles déjà chargés (pas d'effacement sur erreur
          // transitoire) et signale l'échec pour le bouton réessayer.
          setBundlesError(true);
          setBundlesLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [bundleRetry]);

  const filteredArticles = activeCategory === 'all'
    ? ARTICLES_CODM
    : ARTICLES_CODM.filter((a) => a.categorie === activeCategory);

  // Le module garantit une seule une (verrou de contenu). Le repli sur le
  // premier article evite une page vide si la donnee est incomplete.
  const featured = ARTICLES_CODM.find((a) => a.une) ?? ARTICLES_CODM[0];
  const latestArticles = filteredArticles.filter((a) => a.id !== featured.id || activeCategory !== 'all');
  const imageUne = imageDe(featured);

  const currentWeapons = WEAPON_DATA.weapons[selectedWeaponCategory];
  const searchedWeapons = weaponSearch
    ? currentWeapons.filter((w) => w.toLowerCase().includes(weaponSearch.toLowerCase()))
    : currentWeapons;

  return (
    <div className="min-h-dvh bg-zoyd-black text-white font-ui scanline pb-24">
      <SEOHead
        title={`Infos CODM — Saison ${SAISON_CODM.numero} : Verdansk, Goulag, Signal 50 | ZOYD`}
        description={`La Saison ${SAISON_CODM.numero} de Call of Duty: Mobile est sortie le ${formaterDateCodm(SAISON_CODM.sortieLe)} : Verdansk, Goulag, Field Assets, Perks et Signal 50. Faits vérifiés et sources datées.`}
        path="/infos"
      />
      <div className="fixed inset-0 tactical-grid opacity-10 pointer-events-none" />

      {/* Header */}
      <header className="relative border-b border-white/5 bg-zoyd-black pt-16">
        <div className="absolute inset-0 z-0">
          <Illustration
            nom="arme-bleue"
            className="w-full h-full object-cover opacity-20 mix-blend-luminosity grayscale pointer-events-none"
          />
          <Illustration
            nom="operatrice-studio"
            className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay grayscale pointer-events-none"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black via-zoyd-black/60 to-transparent" />
        </div>
        <div className="relative z-10 max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 pb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 border border-zoyd-yellow flex items-center justify-center text-zoyd-yellow">
              <Newspaper className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-mono font-black tracking-[0.4em] text-zoyd-yellow uppercase italic">
              Veille vérifiée
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-8xl font-display font-black uppercase tracking-tighter italic leading-[0.9]">
            Infos
            <br />
            <span className="text-white/70 underline decoration-zoyd-yellow/50 underline-offset-8">
              CODM
            </span>
          </h1>
          <p className="mt-5 max-w-3xl text-sm text-white/70">
            Saison {SAISON_CODM.numero} — {SAISON_CODM.nom}. Verdansk, Goulag, Field
            Assets et Signal 50 : les faits vérifiés, sources datées.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-[10px] font-mono text-white/60">
            <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> Vérifié le {formaterDateCodm(VERIFIE_LE)}</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-zoyd-yellow" /> Lancement : {formaterDateCodm(SAISON_CODM.sortieLe)}, {SAISON_CODM.heure}</span>
          </div>
        </div>
      </header>

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-12 relative z-10">

        {/* Live Data Tabs */}
        <div className="mb-12 border border-white/10 bg-zoyd-surface/30">
          <div className="relative">
            <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-zoyd-black to-transparent z-10" />
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-zoyd-black to-transparent z-10" />
            <div className="flex border-b border-white/5 overflow-x-auto scrollbar-hide">
              {([
                { id: 'bundles' as LiveTab, label: 'BOUTIQUE CODM', icon: ShoppingBag, badge: bundles.length > 0 ? bundles.length : undefined },
                { id: 'armes' as LiveTab, label: 'BASE ARMES', icon: Swords, badge: String(TOTAL_WEAPONS) },
              ]).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeLiveTab === tab.id;
              return (
                <Button
                variant="primary"
                size="sm"
                animate={false}
                  key={tab.id}
                  onClick={() => setActiveLiveTab(tab.id)}
                  className={`flex flex-none items-center gap-2 px-5 py-2.5 font-display font-black text-[10px] tracking-[0.15em] italic uppercase transition-all border whitespace-nowrap touch-target ${
                    isActive
                      ? 'bg-white text-black border-white'
                      : 'text-white/60 border-white/5 hover:border-white/20 hover:text-white/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {tab.badge && (
                    <span className="bg-zoyd-blue text-white text-[10px] px-1.5 py-0.5 font-bold ml-1">
                      {tab.badge}
                    </span>
                  )}
                </Button>
              );
            })}
            </div>
          </div>

          {activeLiveTab === 'bundles' && (
            <div className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-black text-sm uppercase tracking-tighter italic text-white">
                    Offres en cours
                  </h3>
                  <p className="text-[10px] font-mono text-white/60 mt-1">
                    {priceIsLocal
                      ? 'Donnees temps reel depuis le store CODM'
                      : `Catalogue international Codashop (prix en ${catalogCurrency}). Le montant debite est affiche sur Codashop, dans la devise de votre pays.`}
                  </p>
                </div>
                {bundlesLoading && (
                  <div className="flex items-center gap-2 text-[10px] font-mono text-white/60">
                    <div className="w-3 h-3 border border-zoyd-yellow border-t-transparent rounded-full animate-spin" />
                    Chargement...
                  </div>
                )}
              </div>
              {!bundlesLoading && bundlesError && (
                <div className="text-center py-8 text-white/60 text-sm space-y-3">
                  <p>Chargement du catalogue impossible : le serveur ne repond pas.</p>
                  <Button
                variant="secondary"
                size="sm"
                animate={false}
                    type="button"
                    onClick={() => setBundleRetry((n) => n + 1)}
                    className="inline-flex items-center gap-2 border border-white/20 px-4 py-2 text-xs font-display font-black uppercase tracking-widest text-white hover:border-zoyd-yellow hover:text-zoyd-yellow transition-colors touch-target"
                  >
                    Réessayer
                  </Button>
                </div>
              )}
              {!bundlesLoading && !bundlesError && bundles.length === 0 && (
                <div className="text-center py-8 text-white/60 text-sm">
                  {/* Catalogue VIDE cote serveur : ce n'est pas une panne.
                      Le distinguer de l'echec de chargement evite de
                      promettre un « Reessayer » qui ne servirait a rien. */}
                  <p>Aucune offre disponible dans le catalogue CODM pour le moment.</p>
                </div>
              )}
              {bundlesError && bundles.length > 0 && (
                <p className="text-[10px] font-mono text-zoyd-yellow pb-3">
                  Actualisation en échec — affichage du dernier catalogue chargé.
                </p>
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
                        <ShoppingBag className="w-8 h-8 text-white/40" />
                      )}
                      <div className="absolute pointer-events-none">
                        {bundle.isFree && <div className="bg-green-500 text-black text-[10px] font-mono font-black px-1.5 py-0.5 uppercase">Gratuit</div>}
                        {bundle.isLuckyDraw && <div className="bg-purple-500 text-white text-[10px] font-mono font-black px-1.5 py-0.5 uppercase">Lucky Draw</div>}
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="font-display font-black text-[10px] uppercase tracking-tight italic text-white truncate">{bundle.title || 'Bundle'}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] font-mono text-white/70">{bundle.isFree ? 'Gratuit' : `${bundle.price} ${bundle.currency}`}</span>
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
                  <h3 className="font-display font-black text-sm uppercase tracking-tighter italic text-white">{TOTAL_WEAPONS} armes — {VINTAGE_ARMES}</h3>
                  <p className="text-[10px] font-mono text-white/60 mt-1">
                    Référentiel statique arrêté à la {VINTAGE_ARMES} : les armes ajoutées depuis, dont le Signal 50, n&apos;y figurent pas. La veille ci-dessus couvre la saison en cours.
                  </p>
                </div>
                <div className="relative w-full md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/60" />
                  <input type="text" placeholder="Rechercher une arme..." value={weaponSearch} onChange={(e) => setWeaponSearch(e.target.value)}
                    className="w-full bg-zoyd-surface/50 border border-white/10 text-white text-xs font-mono pl-9 pr-4 py-2.5 placeholder:text-white/60 focus:border-zoyd-yellow/50 transition-colors" />
                </div>
              </div>
              <div className="relative">
                <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-zoyd-black to-transparent z-10" />
                <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-zoyd-black to-transparent z-10" />
                <div className="flex flex-nowrap gap-1.5 mb-6 overflow-x-auto scrollbar-hide pb-2">
                  {WEAPON_CATEGORIES.map((cat) => (
                    <Button
                variant="secondary"
                size="sm"
                animate={false} key={cat} onClick={() => { setSelectedWeaponCategory(cat); setWeaponSearch(''); }}
                      className={`px-3 py-1.5 font-display font-black text-[10px] tracking-wider italic uppercase whitespace-nowrap transition-all border ${
                        selectedWeaponCategory === cat ? 'bg-white text-black border-white' : 'text-white/60 border-white/5 hover:border-white/20 hover:text-white/60'
                      }`}>{cat}</Button>
                  ))}
                </div>
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
                    <div className="text-[10px] font-mono text-white/60 uppercase">{selectedWeaponCategory}</div>
                  </motion.div>
                ))}
              </div>
              {searchedWeapons.length === 0 && <div className="text-center py-6 text-white/60 text-sm">Aucune arme trouvée.</div>}
            </div>
          )}
        </div>

        {/* Category Filters */}
        <div role="tablist" aria-label="Catégories" className="relative mb-12 border-b border-white/5 pb-4">
          <div className="pointer-events-none absolute left-0 top-0 bottom-4 w-12 bg-gradient-to-r from-zoyd-black to-transparent pointer-events-none z-10" />
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <Button
                variant="primary"
                size="sm"
                animate={false} key={cat.id} role="tab" aria-selected={isActive} onClick={() => setActiveCategory(cat.id)}
                  className={`flex flex-none items-center gap-2 px-5 py-2.5 font-display font-black text-[10px] tracking-[0.15em] italic uppercase transition-all border whitespace-nowrap touch-target ${
                    isActive ? 'bg-white text-black border-white' : 'text-white/60 border-white/5 hover:border-white/20 hover:text-white/60'
                  }`}><Icon className="w-4 h-4" />{cat.label}</Button>
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
                {imageUne && !imgErrors.has('featured') ? (
                  <>
                    <img src={imageUne} alt={featured.titre} onError={() => markImgError('featured')} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
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
                {featured.etiquette && <div className="absolute top-3 left-3 z-20"><span className={`text-[10px] font-mono font-black tracking-widest uppercase px-2 py-1 border bg-black/80 ${categoryColors[featured.categorie]}`}>{featured.etiquette}</span></div>}
              </div>
              <div className="md:w-1/2 p-6 md:p-8 flex flex-col justify-center">
                <div className="flex items-center gap-3 mb-4">
                  <span className={`text-[10px] font-mono font-black tracking-widest uppercase px-2 py-1 border ${categoryColors[featured.categorie]}`}>{featured.categorie}</span>
                  <span className="text-[10px] font-mono text-white/60">{formaterDateCodm(featured.publieLe)}</span>
                  <span className="text-[10px] font-mono text-white/60">{featured.lectureMin} min</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-display font-black uppercase tracking-tighter italic leading-tight mb-4 group-hover:text-zoyd-yellow transition-colors">{featured.titre}</h2>
                <p className="text-sm text-white/70 mb-4 line-clamp-3">{featured.resume}</p>
                <LienSource article={featured} className="text-[10px] font-mono text-white/60 mb-4" />
                <Button
                variant="ghost"
                size="link"
                animate={false} onClick={() => toggleArticle(featured.id)} aria-expanded={expandedArticles.has(featured.id)}
                  className="flex items-center gap-2 text-zoyd-yellow font-display font-black text-xs tracking-widest uppercase italic hover:gap-4 transition-all min-h-11 py-2">
                  {expandedArticles.has(featured.id) ? 'REVOIR' : 'LIRE LA SUITE'}<ChevronRight className="w-4 h-4" />
                </Button>
                {expandedArticles.has(featured.id) && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4 space-y-3 border-t border-white/5 pt-4">
                    {featured.contenu.map((p, i) => <p key={i} className="text-sm text-white/75 leading-relaxed">{p}</p>)}
                  </motion.div>
                )}
              </div>
            </div>
          </motion.article>
        )}

        {/* Articles Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {latestArticles.map((article, index) => {
            const image = imageDe(article);
            return (
              <motion.article key={article.id}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
                animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                transition={prefersReducedMotion ? { duration: 0 } : { delay: Math.min(index * 0.08, 0.5) }}
                className="border border-white/5 bg-zoyd-surface/20 overflow-hidden group hover:border-white/20 hover:bg-zoyd-surface/40 transition-all"
              >
                <div className="aspect-video relative bg-zoyd-surface/50 overflow-hidden border-b border-white/5">
                  {image && !imgErrors.has('article-' + article.id) ? (
                    <>
                      <img src={image} alt={article.titre} onError={() => markImgError('article-' + article.id)} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                      <div className="absolute inset-0 bg-gradient-to-t from-zoyd-black/70 via-transparent to-transparent" />
                    </>
                  ) : (
                    <>
                      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-white/[0.02]" />
                      <div className="relative z-10 flex items-center justify-center w-16 h-16 border border-white/10 group-hover:border-zoyd-yellow/30 transition-colors">
                        {article.categorie === 'saison' && <Zap className="w-7 h-7 text-white/60 group-hover:text-zoyd-yellow/60 transition-colors" />}
                        {article.categorie === 'armes' && <Swords className="w-7 h-7 text-white/60 group-hover:text-red-400/80 transition-colors" />}
                        {article.categorie === 'competition' && <Trophy className="w-7 h-7 text-white/60 group-hover:text-zoyd-blue/60 transition-colors" />}
                        {article.categorie === 'patches' && <Bug className="w-7 h-7 text-white/60 group-hover:text-orange-400/80 transition-colors" />}
                      </div>
                    </>
                  )}
                  {article.etiquette && (
                    <div className="absolute top-3 right-3 z-20">
                      <span className={`text-[10px] font-mono font-black tracking-widest uppercase px-2 py-1 border ${categoryColors[article.categorie]} bg-black/80`}>{article.etiquette}</span>
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`text-[10px] font-mono font-black tracking-widest uppercase px-2 py-0.5 border ${categoryColors[article.categorie]}`}>{article.categorie}</span>
                    <span className="text-[10px] font-mono text-white/60">{formaterDateCodm(article.publieLe)}</span>
                  </div>
                  <h3 className="text-sm font-display font-black uppercase tracking-tight italic leading-snug mb-2 group-hover:text-zoyd-yellow transition-colors line-clamp-2">{article.titre}</h3>
                  <p className="text-xs text-white/60 line-clamp-2 mb-3">{article.resume}</p>
                  <LienSource article={article} className="text-[10px] font-mono text-white/60 mb-3" />
                  <Button
                  variant="secondary"
                  size="md"
                  animate={false} onClick={() => toggleArticle(article.id)} aria-expanded={expandedArticles.has(article.id)}
                    className="flex items-center justify-between w-full min-h-11 py-2">
                    <span className="text-[10px] font-mono text-white/60">{article.lectureMin} min</span>
                    <span className="flex items-center gap-1 text-[10px] font-display font-black text-white/60 group-hover:text-zoyd-yellow transition-colors tracking-widest uppercase italic">
                      {expandedArticles.has(article.id) ? 'Masquer' : 'Lire'}<ChevronRight className="w-3 h-3" />
                    </span>
                  </Button>
                  {expandedArticles.has(article.id) && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 space-y-2 border-t border-white/5 pt-3">
                      {article.contenu.map((p, i) => <p key={i} className="text-xs text-white/70 leading-relaxed">{p}</p>)}
                    </motion.div>
                  )}
                </div>
              </motion.article>
            );
          })}
        </div>

        {filteredArticles.length === 0 && (
          <div className="border border-white/5 bg-zoyd-surface/10 p-6 md:p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-white/10 text-white/70"><Newspaper className="w-6 h-6" /></div>
            <h2 className="font-display font-black text-xl uppercase italic text-white mb-2">Aucun article</h2>
            <p className="text-sm text-white/70 max-w-xl mx-auto">Aucun article dans cette catégorie.</p>
          </div>
        )}

        {/* Newsletter CTA */}
        <div className="mt-16 border border-zoyd-yellow/20 bg-zoyd-yellow/5 p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="w-12 h-12 border border-zoyd-yellow/40 flex items-center justify-center text-zoyd-yellow shrink-0"><Shield className="w-6 h-6" /></div>
            <div className="flex-1">
              <h3 className="font-display font-black text-lg uppercase tracking-tighter italic text-white mb-1">La veille est à jour</h3>
              <p className="text-sm text-white/70">Les faits sont datés et sourcés. La suite se joue sur le terrain : tournois ouverts et matchs en attente t&apos;attendent dans l&apos;arène.</p>
            </div>
            <Link to="/mj" className="shrink-0 bg-zoyd-yellow text-black px-6 py-3 font-display font-black text-xs tracking-[0.2em] italic uppercase hover:bg-white transition-colors touch-target">TROUVER UN MATCH</Link>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'ARTICLES', value: ARTICLES_CODM.length, icon: Newspaper },
            { label: 'ARMES', value: TOTAL_WEAPONS, icon: Swords },
            { label: 'STORE', value: bundles.length || '--', icon: ShoppingBag },
            { label: 'SOURCES', value: new Set(ARTICLES_CODM.map((a) => a.source.url)).size, icon: TrendingUp },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="border border-white/5 bg-zoyd-surface/10 p-4 text-center">
                <Icon className="w-4 h-4 text-white/60 mx-auto mb-2" />
                <div className="font-display font-black text-2xl text-zoyd-yellow italic">{stat.value}</div>
                <div className="text-[10px] font-mono font-black tracking-widest text-white/60 uppercase">{stat.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default LeaksPage;
