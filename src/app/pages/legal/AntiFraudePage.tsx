import React from 'react';
import { Link } from 'react-router';
import { LegalLayout, LegalSection, ASSISTANCE } from './LegalLayout';

const AntiFraudePage: React.FC = () => (
  <LegalLayout
    title="Anti-fraude"
    description="Règles anti-fraude ZOYD : un compte par personne, score de fiabilité, contrôles et sanctions graduées."
    path="/anti-fraude"
    updatedAt="22 septembre 2026"
  >
    <LegalSection n="1" title="Un compte par personne">
      <p>
        Pseudo, email, numéro de téléphone et UID CODM sont uniques sur ZOYD : impossible de créer deux comptes avec
        les mêmes identifiants. Les multi-comptes détectés sont tous suspendus et leurs gains annulés.
      </p>
    </LegalSection>

    <LegalSection n="2" title="Score de fiabilité">
      <p>
        Chaque joueur a un score de fiabilité sur 100, visible sur son profil. Les matchs joués proprement le font
        monter ; les litiges perdus, les forfaits et les signalements le font baisser. Certains matchs exigent un
        score minimum pour participer — un mauvais comportement te ferme des portes.
      </p>
    </LegalSection>

    <LegalSection n="3" title="Contrôles automatiques">
      <ul className="list-disc pl-5 space-y-1">
        <li>Type de contrôle déclaré à l'inscription (tactile, manette, émulateur, PC) et enregistré à chaque match.</li>
        <li>Vérification des résultats : un gain ne peut être crédité deux fois pour le même match.</li>
        <li>Vérification des retraits : montant, numéro Mobile Money du pays du profil et plafonds contrôlés avant envoi.</li>
        <li>Limitation anti-abus : tentatives de connexion et demandes répétées bloquées temporairement.</li>
      </ul>
    </LegalSection>

    <LegalSection n="4" title="Ce qui est interdit">
      <ul className="list-disc pl-5 space-y-1">
        <li>Multi-comptes et prête-nom.</li>
        <li>Collusion : s'entendre avec l'adversaire sur le résultat.</li>
        <li>Faux résultats, captures truquées ou volées.</li>
        <li>Jouer sur le compte de quelqu'un d'autre.</li>
        <li>Exploitation de bugs pour générer des gains.</li>
      </ul>
    </LegalSection>

    <LegalSection n="5" title="Sanctions graduées">
      <p>
        <strong className="text-white">1. Avertissement</strong> — premier écart mineur (ex. contestation sans preuve).
        <br />
        <strong className="text-white">2. Suspension temporaire</strong> — récidive ou triche avérée : compte bloqué,
        gains du match annulés.
        <br />
        <strong className="text-white">3. Exclusion définitive</strong> — multi-comptes, collusion, fraude aux
        paiements : comptes fermés, soldes frauduleux annulés, signalement aux opérateurs de paiement si nécessaire.
      </p>
    </LegalSection>

    <LegalSection n="6" title="Signaler">
      <p>
        Suspecte une triche ? Conteste depuis le match (voir{' '}
        <Link to="/reglement-litiges" className="text-zoyd-yellow hover:text-white underline">
          Règlement des litiges
        </Link>
        ) ou écris à {ASSISTANCE.email} / WhatsApp {ASSISTANCE.whatsapp} avec pseudo du suspect, match et preuves.
      </p>
    </LegalSection>
  </LegalLayout>
);

export default AntiFraudePage;
