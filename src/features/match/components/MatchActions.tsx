import React from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flame,
  Gavel,
  PlusCircle,
  ShieldAlert,
  Trophy,
} from 'lucide-react';
import { formatZC } from '../../../lib/utils';
import type { Match, MatchPlayer, DisputeCategory, Dispute } from '../../../app/stores/matchStore';
import type { User } from '../../../app/stores/authStore';

const RuleRow = ({ label, value }: { label: string; value: string }) => (
  <div className="border border-white/5 px-4 py-3 bg-black/30">
    <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-1">{label}</div>
    <div className="font-display font-black text-white italic">{value}</div>
  </div>
);

const disputeCategoryLabels: Record<DisputeCategory, string> = {
  result: 'Score conteste',
  room_issue: 'Probleme de salle',
  no_show: 'Absence / retard',
  conduct: 'Comportement',
  other: 'Autre',
};

interface MatchActionsProps {
  match: Match;
  user: User | null;
  currentPlayer: MatchPlayer | undefined;
  isArbiter: boolean;
  canJoinAsPlayer: boolean;
  canJoinArbiterSlot: boolean;
  canCheckIn: boolean;
  canToggleReady: boolean;
  canLaunch: boolean;
  availableSpend: number;
  requiredTopUp: number;
  fundingPath: string;
  roomPublishWindow: { canPublish: boolean; message: string };
  openDisputeRecord: Dispute | undefined;
  isEscalating: boolean;
  isSubmittingResult: boolean;
  isProcessingAction: boolean;
  roomState: {
    scheduleValue: string;
    setScheduleValue: (v: string) => void;
    roomName: string;
    setRoomName: (v: string) => void;
    roomPassword: string;
    setRoomPassword: (v: string) => void;
  };
  scoreState: {
    scoreAlpha: string;
    setScoreAlpha: (v: string) => void;
    scoreBravo: string;
    setScoreBravo: (v: string) => void;
    resultNotes: string;
    setResultNotes: (v: string) => void;
  };
  proofsState: {
    scoreboardProofs: string;
    setScoreboardProofs: (v: string) => void;
    finalResultProofs: string;
    setFinalResultProofs: (v: string) => void;
    roomCaptureProofs: string;
    setRoomCaptureProofs: (v: string) => void;
    extraResultProofs: string;
    setExtraResultProofs: (v: string) => void;
  };
  disputeState: {
    category: DisputeCategory;
    setCategory: (v: DisputeCategory) => void;
    reason: string;
    setReason: (v: string) => void;
    evidence: string;
    setEvidence: (v: string) => void;
    addEvidenceInput: string;
    setAddEvidenceInput: (v: string) => void;
    showAddEvidenceForm: boolean;
    setShowAddEvidenceForm: (v: boolean) => void;
    showArbiterScore: boolean;
    setShowArbiterScore: (v: boolean) => void;
  };
  handlers: {
    join: (team?: 0 | 1) => void;
    joinAsArbiter: () => void;
    schedule: () => void;
    roomSave: () => void;
    resultSubmit: () => void;
    dispute: () => void;
    checkIn: () => void;
    toggleReady: () => void;
    launch: () => void;
    addEvidence: () => void;
    escalate: () => void;
  };
}

export const MatchActions: React.FC<MatchActionsProps> = React.memo(({
  match,
  user,
  currentPlayer,
  isArbiter,
  canJoinAsPlayer,
  canJoinArbiterSlot,
  canCheckIn,
  canToggleReady,
  canLaunch,
  availableSpend,
  requiredTopUp,
  fundingPath,
  roomPublishWindow,
  openDisputeRecord,
  isEscalating,
  isSubmittingResult,
  isProcessingAction,
  roomState,
  scoreState,
  proofsState,
  disputeState,
  handlers,
}) => (
  <>
    <div className="p-6">
      <h2 className="text-lg font-display font-black uppercase italic mb-4">Entrer dans la partie</h2>

      {!user && (
        <div className="space-y-4">
          <p className="text-white/40 text-sm">
            Connecte-toi pour rejoindre une equipe, suivre la salle et discuter avec les autres joueurs.
          </p>
          <Link to="/auth/login" className="inline-flex items-center gap-2 bg-white text-black px-5 py-3 font-display font-black uppercase tracking-widest text-xs italic">
            Connexion joueur
          </Link>
        </div>
      )}

      {user && canJoinAsPlayer && (
        <div className="space-y-4">
          <div className="border border-white/10 bg-black/40 p-4 text-sm text-white/60">
            Ton solde dispo: <span className="text-zoyd-yellow font-display font-black">{formatZC(availableSpend)}</span>
          </div>
          {requiredTopUp > 0 ? (
            <div className="border border-zoyd-yellow/20 bg-zoyd-yellow/5 p-4 text-sm text-white/70">
              Il te manque{' '}
              <span className="font-display font-black text-zoyd-yellow">{formatZC(requiredTopUp)}</span>{' '}
              pour bloquer ton pass sur ce match.
              <div className="mt-3">
                <Link
                  to={fundingPath}
                  className="inline-flex items-center gap-2 border border-zoyd-yellow/30 px-4 py-3 text-[10px] font-display font-black uppercase tracking-widest text-zoyd-yellow hover:bg-zoyd-yellow hover:text-black transition-colors"
                >
                  Ajouter mes ZC
                </Link>
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button onClick={() => handlers.join(0)} className="bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-yellow transition-colors">
              REJOINDRE ALPHA
            </button>
            <button onClick={() => handlers.join(1)} className="border border-white/10 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:border-white transition-colors">
              REJOINDRE BRAVO
            </button>
            <button onClick={() => handlers.join()} className="border border-zoyd-blue/30 text-zoyd-blue py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-blue hover:text-black transition-colors">
              PLACEMENT AUTO
            </button>
          </div>
        </div>
      )}

      {user && canJoinArbiterSlot && (
        <button onClick={handlers.joinAsArbiter} className="mt-4 w-full bg-zoyd-yellow text-black py-4 font-display font-black uppercase tracking-widest text-xs italic hover:bg-white transition-colors">
          POSTULER COMME ARBITRE (COMMISSION: {formatZC(match.arbiterFee)})
        </button>
      )}

      {currentPlayer && (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <button
              onClick={handlers.checkIn}
              disabled={!canCheckIn || currentPlayer.isCheckedIn}
              className="bg-white text-black py-4 font-display font-black uppercase tracking-widest text-xs italic disabled:opacity-30"
            >
              {currentPlayer.isCheckedIn ? 'Presence confirmee' : 'Confirmer ma presence'}
            </button>
            <button
              onClick={handlers.toggleReady}
              disabled={!canToggleReady}
              className="border border-zoyd-yellow/30 text-zoyd-yellow py-4 font-display font-black uppercase tracking-widest text-xs italic disabled:opacity-30"
            >
              {currentPlayer.isReady ? 'Retirer le ready' : 'Je suis pret'}
            </button>
          </div>
          <p className="text-xs text-white/40">
            Une fois ton pass engage, ta place reste reservee jusqu'au score final.
          </p>
          {match.scheduledAt ? (
            <p className="text-xs text-white/35">
              Presence attendue avant l'heure confirmee. Toute equipe incomplete a l'heure du match passe automatiquement en forfait.
            </p>
          ) : null}
        </div>
      )}

      {isArbiter && (
        <div className="space-y-5">
          <div className="border border-white/10 bg-black/40 p-4 text-sm text-white/65">
            <div className="text-[10px] font-mono uppercase tracking-widest text-zoyd-blue mb-2">
              Publication de salle
            </div>
            <p>{roomPublishWindow.message}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <input
              type="datetime-local"
              value={roomState.scheduleValue}
              onChange={(event) => roomState.setScheduleValue(event.target.value)}
              aria-label="Horaire du match"
              className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
            <button onClick={handlers.schedule} className="bg-white text-black py-3 font-display font-black uppercase tracking-widest text-xs italic">
              Valider l'horaire
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <input
              type="text"
              value={roomState.roomName}
              onChange={(event) => roomState.setRoomName(event.target.value)}
              placeholder="Nom de la salle CODM"
              aria-label="Nom de la salle"
              className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
            <input
              type="text"
              value={roomState.roomPassword}
              onChange={(event) => roomState.setRoomPassword(event.target.value)}
              placeholder="Mot de passe de la salle"
              aria-label="Mot de passe de la salle"
              className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <button onClick={handlers.roomSave} disabled={!roomPublishWindow.canPublish} className="border border-zoyd-blue/30 text-zoyd-blue py-3 font-display font-black uppercase tracking-widest text-xs italic hover:bg-zoyd-blue hover:text-black transition-colors disabled:opacity-30">
              Partager la salle
            </button>
            <button onClick={handlers.launch} disabled={!canLaunch} className="bg-zoyd-yellow text-black py-3 font-display font-black uppercase tracking-widest text-xs italic disabled:opacity-30 hover:bg-white transition-colors">
              DÉMARRER LE MATCH
            </button>
          </div>

          <div className="border-t border-white/5 pt-5 space-y-3">
            <h3 className="text-sm font-display font-black uppercase italic">Fin de match</h3>
            <div className="grid md:grid-cols-2 gap-3">
              <input
                type="number"
                value={scoreState.scoreAlpha}
                onChange={(event) => scoreState.setScoreAlpha(event.target.value)}
                placeholder="Score Alpha"
                aria-label="Score de l'équipe Alpha"
                className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
              />
              <input
                type="number"
                value={scoreState.scoreBravo}
                onChange={(event) => scoreState.setScoreBravo(event.target.value)}
                placeholder="Score Bravo"
                aria-label="Score de l'équipe Bravo"
                className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
              />
            </div>
            <textarea
              value={scoreState.resultNotes}
              onChange={(event) => scoreState.setResultNotes(event.target.value)}
              placeholder="Ce qu'il faut retenir de la fin de match"
              aria-label="Notes de fin de match"
              className="w-full min-h-24 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
            <input
              type="text"
              value={proofsState.scoreboardProofs}
              onChange={(event) => proofsState.setScoreboardProofs(event.target.value)}
              placeholder="Screens scoreboard (liens ou refs, separes par des virgules)"
              aria-label="Liens des scores"
              className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
            <input
              type="text"
              value={proofsState.finalResultProofs}
              onChange={(event) => proofsState.setFinalResultProofs(event.target.value)}
              placeholder="Ecran final / victoire (liens ou refs)"
              aria-label="Preuves du résultat final"
              className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
            <input
              type="text"
              value={proofsState.roomCaptureProofs}
              onChange={(event) => proofsState.setRoomCaptureProofs(event.target.value)}
              placeholder="Capture de salle ou room setup (optionnel)"
              aria-label="Capture de salle"
              className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
            <input
              type="text"
              value={proofsState.extraResultProofs}
              onChange={(event) => proofsState.setExtraResultProofs(event.target.value)}
              placeholder="Autres preuves utiles (clips, captures, etc.)"
              aria-label="Autres preuves"
              className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
            <button
              onClick={handlers.resultSubmit}
              disabled={isSubmittingResult}
              className={`w-full py-4 font-display font-black uppercase tracking-widest text-xs italic ${
                isSubmittingResult
                  ? 'bg-white/50 text-black/50 cursor-not-allowed'
                  : 'bg-white text-black hover:bg-zoyd-yellow'
              }`}
            >
              {isSubmittingResult ? 'Soumission en cours...' : 'Valider le score final'}
            </button>
          </div>
        </div>
      )}
    </div>

    <div className="overflow-hidden">
      {openDisputeRecord ? (
        <div>
          <div className="bg-red-500/10 border-b border-red-500/30 px-6 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-red-400 mb-0.5">
                  {openDisputeRecord.level >= 2 ? 'Litige — Niveau Admin' : 'Litige en cours'}
                </div>
                <div className="text-sm font-display font-black uppercase italic text-white">
                  Dossier ouvert par {openDisputeRecord.openedByPseudo || 'Inconnu'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-[10px] font-mono uppercase tracking-widest border px-2 py-1 ${openDisputeRecord.level >= 2 ? 'border-red-400/40 text-red-400 bg-red-400/10' : 'border-orange-400/30 text-orange-400 bg-orange-400/5'}`}>
                NIV. {openDisputeRecord.level || 1}
              </span>
              {openDisputeRecord.prizePoolFrozen && (
                <span className="text-[10px] font-mono uppercase tracking-widest border border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/5 px-2 py-1">
                  Gains bloqués
                </span>
              )}
            </div>
          </div>

          <div className="p-6 space-y-5">
            <div className="grid md:grid-cols-2 gap-3">
              <RuleRow label="Ticket" value={openDisputeRecord.id} />
              <RuleRow label="Catégorie" value={disputeCategoryLabels[openDisputeRecord.category]} />
            </div>

            <div className="border border-white/10 bg-black/30 px-4 py-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">Motif déclaré</div>
              <div className="text-sm text-white/80 leading-relaxed">{openDisputeRecord.reason}</div>
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-3">
                Pièces jointes ({openDisputeRecord.evidence.length})
              </div>
              {openDisputeRecord.evidence.length > 0 ? (
                <div className="space-y-1.5">
                  {openDisputeRecord.evidence.map((item: string, i: number) => {
                    let isSafe = false;
                    try {
                      const u = new URL(item);
                      isSafe = u.protocol === 'https:';
                    } catch {
                      isSafe = item.startsWith('http');
                    }
                    return (
                      <a
                        key={i}
                        href={isSafe ? item : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-2 text-xs font-mono break-all transition-colors ${isSafe ? 'text-zoyd-blue hover:text-white' : 'text-white/30 cursor-default'}`}
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        {item}
                      </a>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/30 italic">Aucune pièce jointe.</p>
              )}
            </div>

            {(!!currentPlayer || isArbiter) && (
              <div className="border-t border-white/5 pt-4">
                <button
                  onClick={() => disputeState.setShowAddEvidenceForm((v) => !v)}
                  className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-zoyd-blue transition-colors"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Ajouter une preuve au dossier
                  {disputeState.showAddEvidenceForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {disputeState.showAddEvidenceForm && (
                  <div className="mt-3 flex gap-3">
                    <input
                      type="text"
                      value={disputeState.addEvidenceInput}
                      onChange={(e) => disputeState.setAddEvidenceInput(e.target.value)}
                      placeholder="Liens ou refs séparés par des virgules"
                      aria-label="Ajouter des preuves"
                      className="flex-1 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                    />
                    <button
                      onClick={handlers.addEvidence}
                      className="px-5 py-3 border border-zoyd-blue/30 text-zoyd-blue text-[10px] font-display font-black uppercase tracking-widest hover:bg-zoyd-blue hover:text-black transition-colors"
                    >
                      Envoyer
                    </button>
                  </div>
                )}
              </div>
            )}

            {isArbiter && (
              <div className="border border-orange-500/20 bg-orange-500/5 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Gavel className="w-4 h-4 text-orange-400" />
                  <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-orange-400">Console Arbitre</span>
                </div>

                <div>
                  <button
                    onClick={() => disputeState.setShowArbiterScore((v) => !v)}
                    className="w-full flex items-center justify-between gap-3 border border-white/10 px-4 py-3 text-[10px] font-display font-black uppercase tracking-widest hover:border-white/30 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Trophy className="w-3.5 h-3.5 text-zoyd-yellow" />
                      Trancher le litige — Valider le score
                    </span>
                    {disputeState.showArbiterScore ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {disputeState.showArbiterScore && (
                    <div className="mt-3 space-y-3 border border-white/5 p-4 bg-black/30">
                      <div className="grid md:grid-cols-2 gap-3">
                        <input
                          type="number"
                          value={scoreState.scoreAlpha}
                          onChange={(e) => scoreState.setScoreAlpha(e.target.value)}
                          placeholder="Score Alpha"
                          aria-label="Score Alpha (arbitre)"
                          className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                        />
                        <input
                          type="number"
                          value={scoreState.scoreBravo}
                          onChange={(e) => scoreState.setScoreBravo(e.target.value)}
                          placeholder="Score Bravo"
                          aria-label="Score Bravo (arbitre)"
                          className="bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                        />
                      </div>
                      <textarea
                        value={scoreState.resultNotes}
                        onChange={(e) => scoreState.setResultNotes(e.target.value)}
                        placeholder="Notes d'arbitrage sur ce litige..."
                        aria-label="Notes d'arbitrage"
                        className="w-full min-h-20 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
                      />
                      <button
                        onClick={handlers.resultSubmit}
                        disabled={isSubmittingResult}
                        className={`w-full py-3 font-display font-black uppercase tracking-widest text-xs italic transition-colors ${
                          isSubmittingResult
                            ? 'bg-zoyd-yellow/50 text-black/50 cursor-not-allowed'
                            : 'bg-zoyd-yellow text-black hover:bg-white'
                        }`}
                      >
                        {isSubmittingResult ? 'Soumission en cours...' : 'Valider le score & clore le litige'}
                      </button>
                    </div>
                  )}
                </div>

                {(openDisputeRecord.level || 1) < 2 && (
                  <div className="border-t border-white/5 pt-4">
                    <p className="text-xs text-white/40 mb-3">
                      Impossible de trancher ? L'équipe d'administration ZOYD peut prendre le relais.
                    </p>
                    <button
                      onClick={handlers.escalate}
                      disabled={isEscalating}
                      className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-3 text-[10px] font-display font-black uppercase tracking-widest hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    >
                      <Flame className="w-3.5 h-3.5" />
                      {isEscalating ? 'Escalade en cours…' : 'Escalader à l\'Administration'}
                    </button>
                  </div>
                )}

                {(openDisputeRecord.level || 1) >= 2 && (
                  <div className="border border-red-400/20 bg-red-400/5 px-4 py-3 text-xs text-red-300">
                    Litige escaladé le {openDisputeRecord.escalatedAt ? new Date(openDisputeRecord.escalatedAt).toLocaleString('fr-FR') : '—'} par {openDisputeRecord.escalatedByPseudo || 'arbitre'}. Un admin va intervenir.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

      ) : (
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-4 h-4 text-zoyd-yellow" />
            <h2 className="text-lg font-display font-black uppercase italic">Un souci sur ce match ?</h2>
          </div>
          <div className="space-y-3">
            <select
              value={disputeState.category}
              onChange={(event) => disputeState.setCategory(event.target.value as DisputeCategory)}
              aria-label="Catégorie du litige"
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            >
              {Object.entries(disputeCategoryLabels).map(([value, label]) => (
                <option key={value} value={value} className="bg-zoyd-black">
                  {label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={disputeState.reason}
              onChange={(event) => disputeState.setReason(event.target.value)}
              placeholder="Raison du litige"
              aria-label="Raison du litige"
              className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
            <textarea
              value={disputeState.evidence}
              onChange={(event) => disputeState.setEvidence(event.target.value)}
              placeholder="Screenshots, room logs ou preuves, séparés par des virgules"
              aria-label="Preuves du litige"
              className="w-full min-h-24 bg-black border border-white/10 px-4 py-3 text-sm text-white focus:outline-none focus:border-zoyd-blue"
            />
            <button onClick={handlers.dispute} className="w-full border border-white/10 py-4 font-display font-black uppercase tracking-widest text-xs italic hover:border-red-400 hover:text-red-300 transition-colors">
              Ouvrir un litige
            </button>
          </div>
        </div>
      )}
    </div>
  </>
));
