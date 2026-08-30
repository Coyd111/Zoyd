import { Helmet } from 'react-helmet-async';

const SITE = 'https://zoyd.vercel.app';

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
