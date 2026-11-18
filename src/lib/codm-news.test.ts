import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import manifeste from '../app/data/illustrations.json';
import {
  ARTICLES_CODM,
  SAISON_CODM,
  VERIFIE_LE,
  formaterDateCodm,
  type ArticleCodm,
} from '../app/data/codmNews';

/**
 * La veille CODM : des faits dates, sources, jamais une saison finie
 * presentee comme l actualite.
 *
 * Pourquoi ce verrou
 * -----------------
 * L ecran « Infos » est reste bloque sur la Saison 8 « Twilight Heist »
 * (septembre 2026) alors que la Saison 10 « 7th Anniversary » etait
 * sortie le 11 novembre 2026. Il annoncait meme le 7e anniversaire pour
 * la Saison 9 et un Mythic Signal 50 encore « attendu » : trois
 * affirmations que le jeu avait deja dementies.
 *
 * Le contenu vit donc dans un module unique, avec une date de
 * publication ISO et une source URL. Cinq garanties :
 *
 *  1. la saison courante et sa date de sortie sont declarees une fois ;
 *  2. aucun article ne parle d une saison passee comme de l actualite ;
 *  3. la veille reste fraiche : pas d article anterieur a la saison,
 *     pas d article plus recent que la date de verification ;
 *  4. chaque fait cite est couvert par une source https datee, et les
 *     faits verifies de la Saison 10 sont tous presents ;
 *  5. la page ne reecrit ni ses articles ni ses dates en dur.
 *
 * PIEGE : la fraicheur est mesuree contre `VERIFIE_LE`, une constante
 * versionnee, pas contre `Date.now()`. Un test dependant de l horloge
 * casse tout seul un dimanche et n apprend rien.
 */

const pageInfos = readFileSync(resolve('src/app/pages/LeaksPage.tsx'), 'utf8');

/** Le texte visible d un article, normalise pour la comparaison. */
const texteDe = (article: ArticleCodm): string =>
  [article.titre, article.resume, ...article.contenu].join(' ');

const corpus = ARTICLES_CODM.map(texteDe).join(' ');

/** Minuscules sans accents : « prévu » et « prevu » se comparent. */
const normaliser = (texte: string): string =>
  texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const corpusNormalise = normaliser(corpus);

describe('Veille CODM', () => {
  it('la saison courante est la Saison 10, sortie le 11 novembre 2026', () => {
    expect(ARTICLES_CODM.length, 'la veille est vide').toBeGreaterThan(0);
    expect(SAISON_CODM.numero).toBe(10);
    expect(SAISON_CODM.nom).toBe('7th Anniversary');
    expect(SAISON_CODM.sortieLe).toBe('2026-11-11');
    expect(formaterDateCodm(SAISON_CODM.sortieLe)).toBe('11 novembre 2026');
  });

  it('aucune saison passee n est presentee comme l actualite', () => {
    // La regression exacte : « Saison 8 Twilight Heist » et un
    // anniversaire annonce pour la Saison 9.
    for (const interdit of ['saison 8', 'saison 9', 'twilight heist', 'honkai']) {
      expect(corpusNormalise, `la veille parle encore de « ${interdit} »`).not.toContain(interdit);
    }
  });

  it('la veille est fraiche et entierement posterieure au debut de saison', () => {
    const publication = (article: ArticleCodm): number => Date.parse(article.publieLe);
    for (const article of ARTICLES_CODM) {
      expect(Number.isNaN(publication(article)), `${article.id} : date invalide`).toBe(false);
      expect(article.publieLe >= '2026-11-01', `${article.id} : article anterieur a la saison`).toBe(true);
      expect(article.publieLe <= VERIFIE_LE, `${article.id} : article plus recent que la verification`).toBe(true);
    }
    const plusRecente = Math.max(...ARTICLES_CODM.map(publication));
    const jours = (Date.parse(VERIFIE_LE) - plusRecente) / 86_400_000;
    expect(jours, 'la veille a plus de 30 jours de retard').toBeLessThanOrEqual(30);
  });

  it('chaque article cite une source https datee, dont la source officielle', () => {
    for (const article of ARTICLES_CODM) {
      expect(article.source.libelle.trim().length, `${article.id} : source sans libelle`).toBeGreaterThan(3);
      const url = new URL(article.source.url);
      expect(url.protocol, `${article.id} : source non https`).toBe('https:');
      expect(Number.isNaN(Date.parse(article.publieLe)), `${article.id} : publication non datee`).toBe(false);
    }
    expect(
      ARTICLES_CODM.some(
        (article) => article.source.url === 'https://www.callofduty.com/blog/2026/11/call-of-duty-mobile-season-10-7th-anniversary',
      ),
      'l article officiel de la Saison 10 n est pas cite',
    ).toBe(true);
  });

  it('les faits verifies de la Saison 10 sont tous presents', () => {
    const faits = [
      'Verdansk',
      'Goulag',
      'Signal 50',
      'Field Assets',
      'Perks',
      'DMZ: Recon',
      'Chemist',
      'Operation: Verdansk Convergence',
      'Makarov',
      'Task Force 141',
      'Observers',
    ];
    for (const fait of faits) {
      expect(corpusNormalise, `fait absent : ${fait}`).toContain(fait.toLowerCase());
    }
  });

  it('les 18 points d interet de Verdansk sont nommes dans la fiche de carte', () => {
    const carte = ARTICLES_CODM.find((article) => article.id === 'verdansk-carte');
    expect(carte, 'la fiche de carte est absente').toBeDefined();
    const texte = normaliser(texteDe(carte as ArticleCodm));
    const points = [
      'Superstore', 'Airport', 'Storage Town', 'Dam', 'Scrapyard', 'Train Station',
      'TV Station', 'Promenade', 'Hospital', 'Downtown', 'Park', 'Port', 'Prison',
      'Farmland', 'Stadium', 'Lumber', 'Quarry', 'Military Base',
    ];
    expect(points).toHaveLength(18);
    for (const point of points) {
      expect(texte, `point d interet absent : ${point}`).toContain(point.toLowerCase());
    }
  });

  it('aucun fait incertain n est presente comme verifie', () => {
    // « attendu », « prevu », « rumeur » : le vocabulaire qui a laisse
    // croire que l anniversaire arriverait en Saison 9.
    const incertain = /\b(attendu|attendue|prevu|prevue|prevoir|prochainement|bientot|rumeur|rumeurs|leak|leaks|devrait|pourrait|a venir)\b/;
    const coupables = ARTICLES_CODM.filter((article) => incertain.test(normaliser(texteDe(article))));
    expect(
      coupables.map((article) => article.id),
      'articles qui annoncent encore un fait incertain',
    ).toEqual([]);
  });

  it('chaque visuel d article existe au catalogue et reste diffusable', () => {
    const illustrations = manifeste.illustrations as Record<string, { source: string }>;
    const sources = manifeste.sources as Record<string, { diffusable?: boolean }>;
    for (const article of ARTICLES_CODM) {
      if (!article.illustration) continue;
      const entree = illustrations[article.illustration];
      expect(entree, `${article.id} : visuel inconnu « ${article.illustration} »`).toBeDefined();
      expect(
        sources[entree.source]?.diffusable,
        `${article.id} : visuel non diffusable « ${article.illustration} »`,
      ).toBe(true);
    }
    // Aucune image distante : un article ne hotlink pas un visuel CODM.
    for (const article of ARTICLES_CODM) {
      expect(normaliser(texteDe(article))).not.toContain('http');
    }
  });

  it('les identifiants et les titres sont uniques, et une seule une est declaree', () => {
    const ids = ARTICLES_CODM.map((article) => article.id);
    const titres = ARTICLES_CODM.map((article) => article.titre);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(titres).size).toBe(titres.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    const unes = ARTICLES_CODM.filter((article) => article.une);
    expect(unes).toHaveLength(1);
    expect(unes[0].categorie).toBe('saison');
  });

  it('chaque article a un contenu de fond, sans texte de remplacement', () => {
    const remplissage = /(todo|xxx|lorem|a completer|placeholder|texte a trous)/;
    for (const article of ARTICLES_CODM) {
      expect(article.titre.trim().length, `${article.id} : titre trop court`).toBeGreaterThan(20);
      expect(article.resume.trim().length, `${article.id} : resume trop court`).toBeGreaterThan(40);
      expect(article.contenu.length, `${article.id} : moins de deux paragraphes`).toBeGreaterThanOrEqual(2);
      expect(article.lectureMin, `${article.id} : duree de lecture absente`).toBeGreaterThanOrEqual(1);
      expect(article.etiquette.trim().length, `${article.id} : etiquette absente`).toBeGreaterThan(2);
      for (const paragraphe of article.contenu) {
        expect(paragraphe.trim().length, `${article.id} : paragraphe vide`).toBeGreaterThan(40);
      }
      expect(normaliser(texteDe(article))).not.toMatch(remplissage);
    }
  });

  it('chaque categorie de filtre a au moins un article', () => {
    const categories = new Set(ARTICLES_CODM.map((article) => article.categorie));
    for (const categorie of ['saison', 'armes', 'competition', 'patches']) {
      expect(categories.has(categorie as ArticleCodm['categorie']), `categorie vide : ${categorie}`).toBe(true);
    }
  });

  it('la page Infos consomme la veille et ne reecrit ni articles ni dates', () => {
    expect(pageInfos).toContain("from '../data/codmNews'");
    expect(pageInfos).toContain('ARTICLES_CODM');
    expect(pageInfos).not.toContain('const articles: LeakArticle[]');
    expect(pageInfos).not.toContain('LeakArticle');
    for (const vestige of ['Twilight Heist', 'Honkai', 'Saison 8', 'Saison 9', '27 Août 2026']) {
      expect(pageInfos, `la page garde « ${vestige} »`).not.toContain(vestige);
    }
    // Le numero de saison vient de `SAISON_CODM` : l ecrire en dur dans un
    // titre SEO le laisserait annoncer la S10 apres la sortie de la S11.
    expect(pageInfos, 'le numero de saison est ecrit en dur').not.toMatch(/Saison\s+10/);
    // Les trois dates affichees viennent du module, jamais d un litteral.
    expect(pageInfos).toContain('formaterDateCodm(article.publieLe)');
    expect(pageInfos).toContain('formaterDateCodm(SAISON_CODM.sortieLe)');
    expect(pageInfos).toContain('formaterDateCodm(VERIFIE_LE)');
    const dateEnDur = /\b\d{1,2}\s+(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\s+\d{4}\b/i;
    expect(dateEnDur.test(pageInfos), 'une date est ecrite en dur dans la page').toBe(false);
  });
});
