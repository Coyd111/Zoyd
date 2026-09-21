import React from 'react';
import { LegalLayout, LegalSection, ASSISTANCE } from './LegalLayout';

const ConfidentialitePage: React.FC = () => (
  <LegalLayout
    title="Confidentialité"
    description="Politique de confidentialité ZOYD : données collectées, usage, visibilité, durée de conservation et droits."
    path="/confidentialite"
    updatedAt="21 septembre 2026"
  >
    <LegalSection n="1" title="Ce que nous gardons">
      <p>
        Pour faire fonctionner ton compte, nous conservons : pseudo, email, numéro de téléphone, pays, UID CODM et
        niveau/rangs de jeu, type d'appareil, historique des matchs joués et des transactions (dépôts, mises, gains,
        retraits).
      </p>
    </LegalSection>

    <LegalSection n="2" title="Pourquoi">
      <p>Ces données servent uniquement à :</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>créer et sécuriser ton compte ;</li>
        <li>créditer tes gains et exécuter tes retraits Mobile Money ;</li>
        <li>t'envoyer les codes de sécurité et te contacter en cas de problème ;</li>
        <li>détecter la fraude et les multi-comptes.</li>
      </ul>
      <p>Elles ne sont ni vendues ni louées. Nous ne voyons jamais ton code PIN Mobile Money (paiement via FedaPay).</p>
    </LegalSection>

    <LegalSection n="3" title="Qui voit quoi">
      <p>
        Ton <strong className="text-white">pseudo et tes statistiques de jeu sont publics</strong> (classements,
        profils). Ton <strong className="text-white">email, ton téléphone et ton solde ne sont jamais publics</strong>.
      </p>
    </LegalSection>

    <LegalSection n="4" title="Combien de temps">
      <p>
        Tes données sont conservées tant que ton compte est actif. Après fermeture, les reçus de paiement sont gardés{' '}
        <strong className="text-white">3 ans</strong> (preuve des transactions), le reste est supprimé ou anonymisé.
      </p>
    </LegalSection>

    <LegalSection n="5" title="Tes droits">
      <p>
        Tu peux voir et corriger tes infos dans <strong className="text-white">Paramètres</strong>. Pour une copie de
        tes données ou une suppression de compte, écris à {ASSISTANCE.email} ou WhatsApp {ASSISTANCE.whatsapp} depuis
        l'email ou le numéro lié au compte.
      </p>
      <p>
        Avant suppression : <strong className="text-white">retire ton solde cash</strong> (minimum 150 ZC) — un compte
        supprimé ne peut plus être remboursé. Les matchs déjà joués peuvent être conservés sans ton nom pour les
        besoins des comptes.
      </p>
    </LegalSection>
  </LegalLayout>
);

export default ConfidentialitePage;
