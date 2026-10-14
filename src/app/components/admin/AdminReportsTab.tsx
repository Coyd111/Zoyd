import React, { useMemo, useState } from 'react';
import { AlertTriangle, Ban, Clock, ShieldAlert, Check, Gavel } from 'lucide-react';

/**
 * File d'attente de moderation.
 *
 * Le signalement est une ACCUSATION, pas une preuve. C'est pour cela que la
 * gravite RECOMMANDE et que l admin tranche : la sanction recommandee est
 * affichee, mais aucun bouton ne l'applique tout seul.
 *
 * Le definitif est derriere une confirmation explicite, parce que c'est la
 * seule action de cette page qu'on ne peut pas reprendre d'un clic. Les trois
 * autres sont reversibles ou legerement penalisantes.
 */

/** Gravite calculee par le serveur (`moderation.mjs`), pas devinee ici. */
export type ReportSeverity = 'grave' | 'moyenne' | 'legere' | 'a_qualifier';

export type Resolution = 'dismissed' | 'warning' | 'temporary_ban' | 'permanent_ban';

export interface QueueReport {
  id: string;
  targetId: string;
  targetPseudo: string;
  reporterId: string | null;
  reporterPseudo: string;
  reason: string;
  description: string;
  status: string;
  severity: ReportSeverity | null;
  createdAt: string;
  resolution?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

const SEVERITY_META: Record<ReportSeverity, { label: string; tone: string }> = {
  grave: { label: 'GRAVE', tone: 'text-red-400 border-red-500/40 bg-red-500/10' },
  moyenne: { label: 'MOYENNE', tone: 'text-orange-400 border-orange-500/40 bg-orange-500/10' },
  legere: { label: 'LEGERE', tone: 'text-white/60 border-white/15 bg-white/5' },
  a_qualifier: { label: 'A QUALIFIER', tone: 'text-zoyd-yellow border-zoyd-yellow/40 bg-zoyd-yellow/10' },
};

const REASON_LABEL: Record<string, string> = {
  harassment: 'Harcelement',
  cheating: 'Triche',
  toxic_behavior: 'Comportement toxique',
  no_show: 'Absent / forfe',
  other: 'Autre',
};

/** Meme table que `moderation.mjs` cote serveur : l'affichage ne doit pas diverger. */
const RECOMMENDED: Record<ReportSeverity, { resolution: Resolution; label: string }> = {
  grave: { resolution: 'temporary_ban', label: 'Bannissement temporaire' },
  moyenne: { resolution: 'warning', label: 'Avertissement' },
  legere: { resolution: 'dismissed', label: 'Classement seul' },
  a_qualifier: { resolution: 'dismissed', label: 'A qualifier' },
};

const TEMP_BAN_DAYS = [1, 3, 7, 14, 30];

const formatWhen = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

interface Props {
  reports: QueueReport[];
  unavailable: boolean;
  resolvingId: string | null;
  onResolve: (reportId: string, resolution: Resolution, note: string, durationDays?: number) => void;
}

const AdminReportsTab: React.FC<Props> = ({ reports, unavailable, resolvingId, onResolve }) => {
  const [note, setNote] = useState<Record<string, string>>({});
  const [days, setDays] = useState<Record<string, number>>({});
  const [confirmPermanent, setConfirmPermanent] = useState<string | null>(null);

  const enAttente = useMemo(() => reports.filter((r) => r.status === 'pending'), [reports]);
  const traites = useMemo(() => reports.filter((r) => r.status !== 'pending'), [reports]);

  // Le plus grave d'abord : c'est ce qu il faut traiter en premier, et
  // l ordre se base sur la gravite calculee, pas sur la date.
  const tries = useMemo(() => {
    const poids: Record<ReportSeverity, number> = { grave: 0, moyenne: 1, a_qualifier: 2, legere: 3 };
    return [...enAttente].sort((a, b) => {
      const pa = poids[a.severity || 'a_qualifier'];
      const pb = poids[b.severity || 'a_qualifier'];
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [enAttente]);

  if (unavailable) {
    return (
      <div className="border border-orange-500/30 bg-orange-500/10 p-6 text-sm text-orange-200" role="status">
        <AlertTriangle className="w-5 h-5 mb-2" aria-hidden="true" />
        <p className="font-bold mb-1">File de moderation indisponible.</p>
        <p>La table des signalements n&apos;a pas pu etre lue. Aucun signalement n&apos;est traite ci-dessous — pas « aucun signalement a traiter ».</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-white/60 max-w-3xl">
        Un signalement est une accusation, pas une preuve : la sanction appliquee reste votre decision.
        La gravite propose une sanction, elle ne l&apos;impose pas.
      </p>

      {tries.length === 0 ? (
        <div className="border border-white/10 p-8 text-center text-sm text-white/50">
          Aucun signalement en attente.
        </div>
      ) : (
        <ul className="space-y-4">
          {tries.map((report) => {
            const sev = report.severity || 'a_qualifier';
            const meta = SEVERITY_META[sev];
            const reco = RECOMMENDED[sev];
            const busy = resolvingId === report.id;
            const enConfirmation = confirmPermanent === report.id;
            const duree = days[report.id] ?? 7;

            return (
              <li key={report.id} className="border border-white/10 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-start gap-3 mb-3">
                  <span className={`text-[10px] font-mono font-black uppercase tracking-widest px-2 py-1 border ${meta.tone}`}>
                    {meta.label}
                  </span>
                  <span className="text-sm font-bold text-white">
                    {report.targetPseudo || report.targetId || 'Joueur inconnu'}
                  </span>
                  <span className="text-xs text-white/50">
                    signale par {report.reporterPseudo || 'joueur inconnu'} · {formatWhen(report.createdAt)}
                  </span>
                </div>

                <p className="text-sm text-white/85 mb-1">
                  <strong>{REASON_LABEL[report.reason] || report.reason}</strong>
                </p>
                {report.description ? (
                  <p className="text-sm text-white/70 italic border-l-2 border-white/15 pl-3 mb-3">
                    {report.description}
                  </p>
                ) : (
                  <p className="text-xs text-white/40 mb-3">Sans description.</p>
                )}

                <p className="text-xs text-zoyd-yellow mb-3 flex items-center gap-1.5">
                  <Gavel className="w-3.5 h-3.5" aria-hidden="true" />
                  Sanction recommandee : <strong>{reco.label}</strong>
                </p>

                <label className="block text-[10px] font-mono font-black uppercase tracking-widest text-white/60 mb-1">
                  Note de moderation (visible dans la trace)
                </label>
                <input
                  type="text"
                  value={note[report.id] || ''}
                  onChange={(e) => setNote((n) => ({ ...n, [report.id]: e.target.value }))}
                  placeholder="Contexte, preuves, decision…"
                  aria-label={`Note de moderation pour le signalement du ${formatWhen(report.createdAt)}`}
                  className="w-full bg-black border border-white/10 px-3 py-2 text-sm text-white mb-3"
                />

                {!enConfirmation ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onResolve(report.id, 'dismissed', note[report.id] || '')}
                      className="flex items-center gap-1.5 border border-white/20 px-3 py-2 text-[10px] font-display font-black uppercase tracking-widest hover:bg-white/10 disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" /> Classer
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onResolve(report.id, 'warning', note[report.id] || '')}
                      className="flex items-center gap-1.5 border border-yellow-500/40 px-3 py-2 text-[10px] font-display font-black uppercase tracking-widest text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-40"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" /> Avertir
                    </button>

                    <label className="flex items-center gap-1.5 text-[10px] font-mono font-black uppercase text-white/60">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span className="sr-only">Duree du bannissement temporaire</span>
                      <select
                        value={duree}
                        onChange={(e) => setDays((d) => ({ ...d, [report.id]: Number(e.target.value) }))}
                        aria-label={`Duree du bannissement temporaire, signalement du ${formatWhen(report.createdAt)}`}
                        className="bg-black border border-white/20 px-2 py-2 text-white"
                      >
                        {TEMP_BAN_DAYS.map((d) => (
                          <option key={d} value={d}>{d} j</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onResolve(report.id, 'temporary_ban', note[report.id] || '', duree)}
                      className="flex items-center gap-1.5 border border-orange-500/40 px-3 py-2 text-[10px] font-display font-black uppercase tracking-widest text-orange-400 hover:bg-orange-500/10 disabled:opacity-40"
                    >
                      <Ban className="w-3.5 h-3.5" aria-hidden="true" /> Banni {duree} j
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmPermanent(report.id)}
                      className="flex items-center gap-1.5 border border-red-500/50 px-3 py-2 text-[10px] font-display font-black uppercase tracking-widest text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Banni definitivement
                    </button>
                  </div>
                ) : (
                  <div
                    className="border border-red-500/50 bg-red-500/10 p-3"
                    role="alertdialog"
                    aria-modal="false"
                    aria-label="Confirmer le bannissement definitif"
                  >
                    <p className="text-xs text-red-200 mb-2">
                      Bannissement <strong>definitif</strong> de {report.targetPseudo || report.targetId} ?
                      Sa session sera fermee immediatement et il ne pourra plus se connecter. Seul un administrateur peut lever cette sanction.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onResolve(report.id, 'permanent_ban', note[report.id] || '');
                          setConfirmPermanent(null);
                        }}
                        className="border border-red-500 bg-red-500/20 px-3 py-2 text-[10px] font-display font-black uppercase tracking-widest text-white hover:bg-red-500/30 disabled:opacity-40"
                      >
                        {busy ? 'Application…' : 'Oui, bannir definitivement'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmPermanent(null)}
                        className="border border-white/20 px-3 py-2 text-[10px] font-display font-black uppercase tracking-widest text-white/70 hover:bg-white/10"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {traites.length > 0 && (
        <details className="border border-white/10 p-4">
          <summary className="text-xs font-mono font-black uppercase tracking-widest text-white/60 cursor-pointer">
            Traites recemment ({traites.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {traites.slice(0, 20).map((report) => (
              <li key={report.id} className="text-xs text-white/60 border-b border-white/5 pb-2 flex flex-wrap gap-2">
                <span className="text-white/80">{report.targetPseudo || report.targetId}</span>
                <span className="uppercase tracking-widest text-white/50">{report.resolution || report.status}</span>
                <span>{formatWhen(report.createdAt)}</span>
                {report.reviewedAt && <span className="text-white/40">traite le {formatWhen(report.reviewedAt)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export default AdminReportsTab;