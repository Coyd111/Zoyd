import React from 'react';
import { Link } from 'react-router';
import { LegalLayout, LegalSection, ASSISTANCE } from './LegalLayout';

const LitigesPage: React.FC = () => (
  <LegalLayout
    title="Règlement des litiges"
    description="Comment contester un résultat sur ZOYD : preuves exigées, gel de la cagnotte, arbitrage et décision finale."
    path="/reglement-litiges"
    updatedAt="22 septembre 2026"
  >
    <LegalSection n="1" title="Quand contester">
      <p>
        Tu peux contester un match si le résultat publié est faux, si ton adversaire ne s'est pas présenté, ou si tu
        constates une triche. Délai : <strong className="text-white">24 heures après la fin du match</strong>.
      </p>
    </LegalSection>

    <LegalSection n="2" title="Comment contester (pas à pas)">
      <ul className="list-disc pl-5 space-y-1">
        <li>Ouvre la page du match et clique sur contester.</li>
        <li>
          Écris une <strong className="text-white">raison claire</strong> (que s'est-il passé, round par round si
          besoin).
        </li>
        <li>
          Ajoute <strong className="text-white">au moins une preuve</strong> : captures du tableau des scores de fin
          de partie, avec les pseudos visibles. Sans preuve, la contestation est refusée.
        </li>
      </ul>
      <p>
        Dès l'ouverture, la <strong className="text-white">cagnotte est gelée</strong> : aucun gain n'est distribué tant
        que le litige est ouvert. Un seul litige actif à la fois par match.
      </p>
    </LegalSection>

    <LegalSection n="3" title="Qui tranche">
      <p>
        <strong className="text-white">Niveau 1 — l'arbitre du match</strong> examine ta contestation et les preuves des
        deux joueurs. S'il ne peut pas trancher, il transmet au{' '}
        <strong className="text-white">niveau 2 — l'administration ZOYD</strong>.
      </p>
      <p>
        La décision rendue (gain attribué, match rejoué ou mises remboursées) est{' '}
        <strong className="text-white">finale</strong> et débloque la cagnotte : rappel, une commission d'arbitrage de{' '}
        <strong className="text-white">2 %</strong> s'applique sur la cagnotte distribuée.
      </p>
    </LegalSection>

    <LegalSection n="4" title="Preuves qui comptent">
      <ul className="list-disc pl-5 space-y-1">
        <li>Tableau des scores de fin de partie, lisible, pseudos visibles.</li>
        <li>Captures datées du jour du match (pas de matchs d'une autre session).</li>
        <li>Description précise : mode, map, score revendiqué.</li>
      </ul>
      <p>Captures floues, rognées ou d'un autre match = preuve rejetée.</p>
    </LegalSection>

    <LegalSection n="5" title="Contestations abusives">
      <p>
        Contester sans preuve, contester chaque défaite ou inonder l'arbitrage fait baisser ton score de fiabilité et
        peut mener à une suspension (voir <Link to="/anti-fraude" className="text-zoyd-yellow hover:text-white underline">Anti-fraude</Link>).
      </p>
    </LegalSection>

    <LegalSection n="6" title="Besoin d'aide">
      <p>
        Écris à {ASSISTANCE.email} ou WhatsApp {ASSISTANCE.whatsapp} ({ASSISTANCE.hours}) en précisant ton pseudo et
        l'identifiant du match.
      </p>
    </LegalSection>
  </LegalLayout>
);

export default LitigesPage;
