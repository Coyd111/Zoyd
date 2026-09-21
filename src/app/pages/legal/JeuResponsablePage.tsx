import React from 'react';
import { LegalLayout, LegalSection, ASSISTANCE } from './LegalLayout';

const JeuResponsablePage: React.FC = () => (
  <LegalLayout
    title="Jeu responsable"
    description="Jeu responsable sur ZOYD : interdit aux mineurs, conseils et outils pour garder le contrôle de tes mises."
    path="/jeu-responsable"
    updatedAt="21 septembre 2026"
  >
    <div className="border border-zoyd-yellow/40 bg-zoyd-yellow/5 px-5 py-4">
      <p className="font-display font-black text-white uppercase italic">
        Interdit aux moins de 18 ans. Jouer avec de l'argent peut faire perdre. Ne mise jamais ce que tu ne peux pas
        perdre.
      </p>
    </div>

    <LegalSection n="1" title="Garde le contrôle">
      <ul className="list-disc pl-5 space-y-1">
        <li>Fixe-toi un budget par semaine et tiens-t'en, que tu gagnes ou que tu perdes.</li>
        <li>Fais des pauses régulières — la fatigue fait prendre de mauvaises décisions.</li>
        <li>Ne rejoue jamais pour « te refaire » après une défaite.</li>
        <li>Ne joue jamais sous énervement, ni avec l'argent du loyer, de la nourriture ou des cours.</li>
      </ul>
    </LegalSection>

    <LegalSection n="2" title="Nos outils, même simples">
      <p>Sur simple demande à l'assistance ({ASSISTANCE.email} ou WhatsApp {ASSISTANCE.whatsapp}) :</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>
          <strong className="text-white">Pause temporaire</strong> : blocage de ton compte 24 heures, 7 jours ou plus.
        </li>
        <li>
          <strong className="text-white">Plafond de dépôt</strong> : limite maximale que tu choisis, modifiable
          uniquement après un délai de réflexion.
        </li>
        <li>
          <strong className="text-white">Fermeture définitive</strong> : ton compte est fermé (pense à retirer ton
          solde cash avant).
        </li>
      </ul>
    </LegalSection>

    <LegalSection n="3" title="Signes d'alerte">
      <p>
        Tu rejoues pour récupérer tes pertes ? Tu caches tes mises à ton entourage ? Tu mises de l'argent prévu pour
        autre chose ? Fais une pause et parle-en à l'assistance — sans jugement, on t'aide à mettre ton compte en
        pause.
      </p>
    </LegalSection>
  </LegalLayout>
);

export default JeuResponsablePage;
