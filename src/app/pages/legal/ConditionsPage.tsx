import React from 'react';
import { LegalLayout, LegalSection, ASSISTANCE } from './LegalLayout';

const ConditionsPage: React.FC = () => (
  <LegalLayout
    title="Conditions d'utilisation"
    description="Conditions d'utilisation ZOYD : compte, matchs avec mises, dépôts, retraits Mobile Money, litiges et règles de jeu."
    path="/conditions"
    updatedAt="21 septembre 2026"
  >
    <LegalSection n="1" title="Qui édite ZOYD">
      <p>
        ZOYD est un service de matchs compétitifs Call of Duty: Mobile avec mises entre joueurs, édité à titre
        individuel et basé à {ASSISTANCE.city}. Contact : {ASSISTANCE.email} — WhatsApp {ASSISTANCE.whatsapp}{' '}
        ({ASSISTANCE.hours}).
      </p>
      <p>
        En créant un compte, tu acceptes sans réserve les présentes conditions ainsi que les règles des matchs
        décrites ci-dessous.
      </p>
    </LegalSection>

    <LegalSection n="2" title="Compte : 18 ans minimum">
      <p>
        L'inscription est strictement réservée aux personnes âgées de <strong className="text-white">18 ans ou plus</strong>.
        Un compte = une personne physique = un UID CODM. Les informations fournies (pseudo, email, téléphone, pays)
        doivent être exactes : le numéro Mobile Money utilisé pour les retraits doit être à ton nom.
      </p>
      <p>
        Il est interdit de prêter, louer, vendre ou partager ton compte. Tout multi-compte détecté entraîne la
        suspension des comptes concernés et l'annulation des gains frauduleux.
      </p>
    </LegalSection>

    <LegalSection n="3" title="Monnaie et dépôts">
      <p>
        La monnaie de la plateforme est le <strong className="text-white">ZC : 1 ZC = 10 FCFA</strong>. Les dépôts se
        font via FedaPay et les opérateurs Mobile Money selon ton pays : MTN, Moov, Celtiis (Bénin) ; MTN, Moov,
        Orange, Wave (Côte d'Ivoire) ; Orange, Wave (Sénégal) ; Moov, Togocel (Togo).
      </p>
      <p>
        Un dépôt validé crédite ton <strong className="text-white">solde cash</strong>. Les bonus éventuels (ZC offerts)
        sont utilisables pour jouer mais <strong className="text-white">non retirables</strong>.
      </p>
    </LegalSection>

    <LegalSection n="4" title="Règles des matchs avec mise">
      <p>
        Pour publier ou rejoindre un match avec mise, ta mise (le « pass ») est bloquée sur ton solde. La cagnotte
        totale vaut <strong className="text-white">mise × nombre de joueurs</strong>. À la validation du résultat, une{' '}
        <strong className="text-white">commission d'arbitrage de 2 %</strong> est prélevée sur la cagnotte, le reste
        revient au gagnant.
      </p>
      <p>
        Un résultat validé crédite les gains de façon définitive. Un match annulé avant son démarrage rembourse
        intégralement les mises bloquées.
      </p>
      <p>Toute triche, collusion entre joueurs ou faux résultat entraîne l'exclusion et l'annulation des gains.</p>
    </LegalSection>

    <LegalSection n="5" title="Retraits" >
      <p>
        Retrait <strong className="text-white">minimum : 150 ZC (1 500 FCFA)</strong> —{' '}
        <strong className="text-white">frais : 2 %</strong> affichés avant validation (tu vois le montant net que tu
        recevras) — <strong className="text-white">maximum : 1 000 000 FCFA par retrait</strong>. Le retrait part vers
        le numéro Mobile Money du pays de ton profil, via FedaPay.
      </p>
      <p>
        Délai habituel : de quelques minutes à 24 heures ouvrées. Si l'opérateur échoue le transfert, le montant est{' '}
        <strong className="text-white">automatiquement recrédité</strong> sur ton solde. Seul le solde cash est
        retirable.
      </p>
    </LegalSection>

    <LegalSection n="6" title="Litiges">
      <p>
        En cas de désaccord sur un résultat, ouvre une contestation depuis le match avec tes preuves (captures du
        tableau des scores) dans un délai de <strong className="text-white">24 heures</strong>. Un arbitre ZOYD
        tranche ; sa décision est finale.
      </p>
    </LegalSection>

    <LegalSection n="7" title="Fraude et sanctions">
      <p>
        Multi-comptes, faux résultats, collusion, usurpation d'identité, exploitation de bugs : suspension temporaire
        ou définitive, annulation des gains liés à la fraude, signalement aux opérateurs de paiement si nécessaire.
      </p>
    </LegalSection>

    <LegalSection n="8" title="Droit applicable">
      <p>
        Les présentes conditions relèvent du <strong className="text-white">droit béninois</strong>. En cas de litige
        persistant après réclamation auprès de l'assistance, les tribunaux de Cotonou sont compétents.
      </p>
    </LegalSection>
  </LegalLayout>
);

export default ConditionsPage;
