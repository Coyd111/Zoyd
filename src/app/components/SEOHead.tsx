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
