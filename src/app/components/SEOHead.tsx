/**
 * SEOHead - injection dynamique du titre, canonique et cartes Open Graph.
 *
 * Enveloppe react-helmet-async. Chaque page le monte avec son titre, sa
 * description et son chemin ; les pages sous AppLayout passent en plus
 * `noindex`.
 *
 * INVARIANT : le composant ne fonctionne QUE sous HelmetProvider (monte dans
 * App.tsx). Hors de ce provider, Helmet ne rend rien et la page perd son
 * titre et sa canonique.
 * PIEGE : le titre de la page d'accueil est ecrit a DEUX endroits :
 * `index.html` (statique, dans le <head>) et `LandingPage.tsx` (dynamique,
 * via SEOHead). Les deux valeurs sont identiques AUJOURD'HUI, et c'est
 * exactement le probleme : rien n'oblige a les garder synchronisees.
 * Corriger un seul des deux cree une divergence - un crawler qui n'execute
 * pas de JS voit un titre different de celui affiche apres le chargement.
 * La meme regle vaut pour la description et pour le bloc JSON-LD de
 * index.html, qui n'a aucun equivalent dynamique.
 * PIEGE : `SITE` lit VITE_SITE_URL au BUILD, avec repli sur la production.
 * Un build sans variable doit produire la production, pas une URL vide.
 *
 * Voir aussi : docs/08-frontend.md - section 9 (Le SEO)
 */
import { Helmet } from 'react-helmet-async';

// URL publique du site.
//
// Elle etait en dur sur la production : en developpement, chaque URL canonique
// et chaque carte Open Graph annoncaient zoyd.vercel.app. Deux consequences
// concretes : un partage de lien depuis le local.Canonique vers la prod, et un
// apercu qui montrait toujours la prod meme en developpant une page.
//
// `VITE_SITE_URL` est lue au build (prefixe VITE_ = exposee au client). Le
// repli production reste la valeur par defaut : un build sans variable doit
// produire la production, pas une URL vide.
const SITE = (import.meta.env?.VITE_SITE_URL as string | undefined)?.replace(/\/+$/, '')
  || 'https://zoyd.vercel.app';

interface SEOHeadProps {
  title: string;
  description: string;
  path: string;
  image?: string;
  noindex?: boolean;
  type?: string;
}

export const SEOHead: React.FC<SEOHeadProps> = ({
  title,
  description,
  path,
  image = '/og.png',
  noindex = false,
  type = 'website',
}) => {
  const url = `${SITE}${path}`;
  const img = image.startsWith('http') ? image : `${SITE}${image}`;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />

      {noindex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={img} />
      <meta property="og:site_name" content="ZOYD" />
      <meta property="og:locale" content="fr_FR" />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={img} />
    </Helmet>
  );
};
