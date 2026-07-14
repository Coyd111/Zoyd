// VAPID Keys for Web Push Notifications
// En production : définir VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY dans les variables d'environnement.
// Pour générer de nouvelles clés :
//   node --input-type=module -e "import wp from 'web-push'; console.log(JSON.stringify(wp.generateVAPIDKeys()));"

const ENV_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const ENV_PRIVATE = process.env.VAPID_PRIVATE_KEY;

// Clés hardcodées uniquement pour le développement local — ne JAMAIS utiliser en production
const DEV_PUBLIC = 'BFPsEH214h9U4CmlAvjtIFcd6_bMkQdwAYONDKZDnXj-28jA9zclD6UXwdJfJs2hdf4vFm_Uk8DD_MSrNDwbK9c';
const DEV_PRIVATE = 'blnBU6tLmRHb2jeeXnb0qjd1LviqILELlmAWPJAstds';

if (process.env.NODE_ENV === 'production' && (!ENV_PUBLIC || !ENV_PRIVATE)) {
  throw new Error('[FATAL] VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in production environment.');
}

if (!ENV_PUBLIC || !ENV_PRIVATE) {
  console.warn('[WARN] VAPID keys not set in environment — using hardcoded dev keys. NEVER do this in production.');
}

export const vapidKeys = {
  publicKey: ENV_PUBLIC || DEV_PUBLIC,
  privateKey: ENV_PRIVATE || DEV_PRIVATE,
};
