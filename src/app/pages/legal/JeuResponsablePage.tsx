/**
 * JeuResponsablePage - regles et outils du jeu responsable.
 *
 * Document legal et informatif : interdit aux mineurs, conseils et outils
 * pour garder le controle de ses mises. Rendu via LegalLayout.
 *
 * INVARIANT : document versionne, comme les autres pages legales.
 * INVARIANT : la regle ' 18 ans ou plus ' doit correspondre a la condition
 * d'inscription reellement appliquee par le serveur.
 * PIEGE : ce document doit rester lisible et actionnable : c'est la page
 * qui explique au joueur comment se faire aider. Eviter le jargon et les
 * blocs de texte sans structure.
 * P13 C9 (audit-3) : la liste des outils ne mentionne PAS de « plafond de
 * depot » - aucune regle serveur ne l'implemente (grep depositLimit :
 * rien), et une promesse sans mecanisme est le pire defaut possible dans
 * une page de jeu responsable. Le reintroduire suppose d'implementer le
 * mecanisme serveur d'abord.
 *
 * Voir aussi : docs/08-frontend.md - section 10.3 (Pages legales)
 */
import React from 'react';
import { LegalLayout, LegalSection, ASSISTANCE } from './LegalLayout';

const JeuResponsablePage: React.FC = () => (
  <LegalLayout
    title="Jeu responsable"
    description="Jeu responsable sur ZOYD : interdit aux mineurs, conseils et outils pour garder le contrôle de tes mises."
    path="/jeu-responsable"
    updatedAt="28 octobre 2026"
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
