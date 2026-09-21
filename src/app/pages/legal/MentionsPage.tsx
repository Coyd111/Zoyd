import React from 'react';
import { LegalLayout, LegalSection, ASSISTANCE } from './LegalLayout';

const MentionsPage: React.FC = () => (
  <LegalLayout
    title="Mentions & Assistance"
    description="Mentions légales ZOYD : éditeur, contact assistance, hébergeurs et prestataire de paiement."
    path="/mentions"
    updatedAt="21 septembre 2026"
  >
    <LegalSection n="1" title="Éditeur du service">
      <p>
        ZOYD — plateforme de matchs compétitifs Call of Duty: Mobile avec mises entre joueurs — est édité à titre
        individuel.
        <br />
        Basé à : <strong className="text-white">{ASSISTANCE.city}</strong>
        <br />
        Email :{' '}
        <a href={`mailto:${ASSISTANCE.email}`} className="text-zoyd-yellow hover:text-white">
          {ASSISTANCE.email}
        </a>
      </p>
    </LegalSection>

    <LegalSection n="2" title="Assistance">
      <p>
        WhatsApp :{' '}
        <a href={ASSISTANCE.whatsappLink} target="_blank" rel="noreferrer" className="text-zoyd-yellow hover:text-white">
          {ASSISTANCE.whatsapp}
        </a>
        <br />
        Email :{' '}
        <a href={`mailto:${ASSISTANCE.email}`} className="text-zoyd-yellow hover:text-white">
          {ASSISTANCE.email}
        </a>
        <br />
        Horaires : <strong className="text-white">{ASSISTANCE.hours}</strong>
      </p>
      <p>Pour toute demande liée à un compte, écris depuis l'email ou le numéro lié à ce compte.</p>
    </LegalSection>

    <LegalSection n="3" title="Hébergement">
      <p>
        Site hébergé par Vercel Inc. (États-Unis) et serveur applicatif hébergé par Render Services Inc.
        (États-Unis). Base de données : Supabase (hébergement cloud).
      </p>
    </LegalSection>

    <LegalSection n="4" title="Paiement">
      <p>
        Les dépôts et retraits Mobile Money transitent par <strong className="text-white">FedaPay</strong>, prestataire
        de paiement agréé. ZOYD ne voit ni ne stocke jamais ton code PIN Mobile Money ni tes identifiants opérateur.
      </p>
    </LegalSection>

    <LegalSection n="5" title="Publication">
      <p>Directeur de la publication : l'éditeur du service (contact ci-dessus).</p>
      <p className="text-white/50">ZOYD est un service indépendant et n'est affilié ni à Activision ni à Call of Duty: Mobile.</p>
    </LegalSection>
  </LegalLayout>
);

export default MentionsPage;
