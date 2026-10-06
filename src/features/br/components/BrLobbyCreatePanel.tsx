import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Coins, Info, Map as MapIcon, Swords, Trophy, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../app/stores/authStore';
import { useWalletStore } from '../../../app/stores/walletStore';
import {
  fetchBrConfig,
  createBrLobby,
  type BrConfig,
  type BrPayout,
} from '../../../app/lib/brApi';
import { formatZC, formatFCFA } from '../../../lib/utils';

/**
 * Creation d'un salon BR (admin).
 *
 * Contraintes reprises du serveur, affichees ici pour eviter un aller-retour
 * d'echec : fenetre 24-48h, repartition qui somme a 100 %, commission
 * arbitre plafonnee a 5 %. Le serveur revalide tout de meme.
 */

const ENTRY_FEE_MIN = 10;
const ENTRY_FEE_MAX = 500;

/**
 * Repartition par defaut : SOMME EXACTEMENT 100 %
 * (40 + 22 + 13 + 12 + 8 + 5).
 *
 * Meme choix que `BR_DEFAULT_PAYOUT` cote serveur. Les deux defauts avaient
 * derive (13/5 ici, 15/3 la-bas) : le formulaire affichait donc une
 * repartition que le serveur ne proposerait pas. Une seule reference, sinon
 * ca diverge a nouveau au prochain ajustement.
 */
const DEFAULT_PAYOUT: BrPayout = {
  first: 0.4, second: 0.22, third: 0.13, fourth: 0.12, fifth: 0.08, arbiterRate: 0.05,
};

/** Place de la repartition editable (hors arbitre). */
const PLACE_FIELDS: Array<{ key: keyof BrPayout; label: string }> = [
  { key: 'first', label: '1er' },
  { key: 'second', label: '2e' },
  { key: 'third', label: '3e' },
  { key: 'fourth', label: '4e' },
  { key: 'fifth', label: '5e' },
];

/** Date locale -> ISO, pour `datetime-local`. */
const toLocalInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const BrLobbyCreatePanel: React.FC<{ onCreated?: (lobbyId: string) => void }> = ({ onCreated }) => {
  const user = useAuthStore((s) => s.user);

  const [config, setConfig] = useState<BrConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('Salon BR officiel');
  const [mode, setMode] = useState('solo');
  const [map, setMap] = useState('isolated');
  const [entryFee, setEntryFee] = useState(50);
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(new Date(Date.now() + 30 * 3600_000)));
  const [rankingMode, setRankingMode] = useState('survie_kills');
  const [payout, setPayout] = useState<BrPayout>({ ...DEFAULT_PAYOUT });
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin') return;
    fetchBrConfig()
      .then(setConfig)
      .catch(() => toast.error('Referentiel BR indisponible.'));
  }, [user?.role]);

  const maxPlayers = useMemo(() => {
    if (!config) return 0;
    return Math.min(config.modes[mode]?.maxPlayers || 0, config.maps[map]?.maxPlayers || 0);
  }, [config, mode, map]);

  const placeSum = useMemo(
    () => PLACE_FIELDS.reduce((sum, f) => sum + (Number(payout[f.key]) || 0), 0),
    [payout],
  );
  const totalSum = placeSum + (Number(payout.arbiterRate) || 0);
  const arbiterMax = config?.arbiterMaxRate ?? 0.05;

  /** La repartition est valide : 100 % exactement, parts decroissantes, arbitre plafonne. */
  const payoutError = useMemo(() => {
    // Le plafond arbitre est teste AVANT la somme : sinon un depassement
    // affiche « doit sommer a 100 % », alors que la vraie cause est le
    // plafond. Le message affiché doit etre la cause, pas un symptome.
    if (payout.arbiterRate > arbiterMax + 1e-9) {
      return `Commission arbitre plafonnee a ${arbiterMax * 100} %.`;
    }
    if (Math.abs(totalSum - 1) > 1e-6) {
      return `La repartition doit sommer a 100 % (actuellement ${Math.round(totalSum * 1000) / 10} %).`;
    }
    for (let i = 1; i < PLACE_FIELDS.length; i++) {
      if (payout[PLACE_FIELDS[i].key] > payout[PLACE_FIELDS[i - 1].key]) {
        return 'Les parts doivent etre decroissantes du 1er au 5e.';
      }
    }
    return null;
  }, [totalSum, payout, arbiterMax]);

  const delayMs = Date.parse(scheduledAt) - Date.now();
  const scheduleError = useMemo(() => {
    if (!Number.isFinite(delayMs)) return 'Date invalide.';
    if (delayMs < 24 * 3600_000) return 'Le salon doit etre programme au moins 24 h a l\'avance.';
    if (delayMs > 48 * 3600_000) return 'Le salon doit etre programme dans les 48 h.';
    return null;
  }, [delayMs]);

  const feeError = entryFee < ENTRY_FEE_MIN || entryFee > ENTRY_FEE_MAX
    ? `Le pass doit etre entre ${ENTRY_FEE_MIN} et ${ENTRY_FEE_MAX} ZC.`
    : null;

  // L'arbitre n'est pas joueur : il ne paie aucun pass, donc sa solvabilite
  // n'a rien a voir avec la faisabilite du salon.
  const canSubmit = Boolean(config) && !payoutError && !scheduleError && !feeError
    && !saving && name.trim().length >= 3;

  if (user?.role !== 'admin') return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const lobby = await createBrLobby({
        name: name.trim(),
        mode,
        map,
        entryFee,
        scheduledAt: new Date(scheduledAt).toISOString(),
        rankingMode,
        payout,
        notes: notes.trim(),
      });
      await useWalletStore.getState().refreshFromServer(user.id);
      toast.success(`Salon ${lobby.name} cree. Tu en es l'arbitre : lance la partie et saisis les resultats a la fin.`);
      setOpen(false);
      onCreated?.(lobby.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Creation impossible.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-zoyd-yellow text-black px-4 py-2.5 font-display font-black text-[10px] uppercase tracking-[0.2em] italic hover:bg-white transition-colors touch-target"
      >
        <Calendar className="w-4 h-4" aria-hidden="true" />
        Creer un salon BR
      </button>
    );
  }

  return (
    <div className="border-2 border-zoyd-yellow/30 bg-zoyd-surface/20 p-5">
      <div className="flex items-start justify-between mb-4">
        <h2 className="font-display font-black text-sm uppercase tracking-tight italic text-zoyd-yellow flex items-center gap-2">
          <Calendar className="w-4 h-4" aria-hidden="true" />
          Nouveau salon Battle Royale
        </h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="text-white/50 hover:text-white touch-target">
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="br-name" className="block text-[10px] font-mono text-white/70 uppercase tracking-wider mb-2">Nom du salon</label>
          <input
            id="br-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white focus:border-zoyd-yellow/50 touch-target"
            placeholder="Salon BR officiel"
          />
          {name.trim().length < 3 && name.length > 0 && (
            <p className="text-[10px] text-red-400 mt-1">3 caracteres minimum.</p>
          )}
        </div>

        {/* Map et mode : les listes viennent du serveur, on ne peut pas
            proposer une map retiree du jeu. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="br-map" className="block text-[10px] font-mono text-white/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <MapIcon className="w-3 h-3" aria-hidden="true" /> Map
            </label>
            <select
              id="br-map"
              value={map}
              onChange={(e) => setMap(e.target.value)}
              className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white focus:border-zoyd-yellow/50 touch-target"
            >
              {config?.mapIds.map((id) => (
                <option key={id} value={id} className="bg-zoyd-black">
                  {config.maps[id].label} — {config.maps[id].maxPlayers} j.
                  {config.maps[id].vehicles ? ' — vehicules' : ' — sans vehicule'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="br-mode" className="block text-[10px] font-mono text-white/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Swords className="w-3 h-3" aria-hidden="true" /> Mode
            </label>
            <select
              id="br-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white focus:border-zoyd-yellow/50 touch-target"
            >
              {config?.modeIds.map((id) => (
                <option key={id} value={id} className="bg-zoyd-black">
                  {config.modes[id].label} — {config.modes[id].teamSize} joueur(s)/equipe
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-[10px] font-mono text-zoyd-yellow">
          Plafond effectif de ce salon : {maxPlayers} joueurs (minimum du mode et de la map).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="br-fee" className="block text-[10px] font-mono text-white/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Coins className="w-3 h-3" aria-hidden="true" /> Pass (ZC)
            </label>
            <input
              id="br-fee"
              type="number"
              min={ENTRY_FEE_MIN}
              max={ENTRY_FEE_MAX}
              value={entryFee}
              onChange={(e) => setEntryFee(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white focus:border-zoyd-yellow/50 touch-target"
            />
            <p className="text-[10px] font-mono text-white/50 mt-1">
              {formatZC(entryFee)} = {formatFCFA(entryFee)} par joueur
            </p>
            {feeError && <p className="text-[10px] text-red-400 mt-1">{feeError}</p>}
            <p className="text-[10px] font-mono text-white/50 mt-1">
              Tu es l&apos;arbitre : tu ne paies pas de pass et tu ne joues pas.
            </p>
          </div>
          <div>
            <label htmlFor="br-date" className="block text-[10px] font-mono text-white/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Calendar className="w-3 h-3" aria-hidden="true" /> Debut (24 h a 48 h)
            </label>
            <input
              id="br-date"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white focus:border-zoyd-yellow/50 touch-target"
            />
            {scheduleError && <p className="text-[10px] text-red-400 mt-1">{scheduleError}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="br-ranking" className="block text-[10px] font-mono text-white/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Trophy className="w-3 h-3" aria-hidden="true" /> Classement final
          </label>
          <select
            id="br-ranking"
            value={rankingMode}
            onChange={(e) => setRankingMode(e.target.value)}
            className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white focus:border-zoyd-yellow/50 touch-target"
          >
            {config?.rankingModeIds.map((id) => (
              <option key={id} value={id} className="bg-zoyd-black">{config.rankingModes[id].label}</option>
            ))}
          </select>
        </div>

        {/* Repartition : validée en direct, le serveur revalide de toute facon. */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-white/70 uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-3 h-3" aria-hidden="true" /> Repartition de la cagnotte
            </span>
            <span className={`text-[10px] font-mono ${Math.abs(totalSum - 1) < 1e-6 ? 'text-green-400' : 'text-red-400'}`}>
              Total {Math.round(totalSum * 1000) / 10} %
            </span>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {PLACE_FIELDS.map((field) => (
              <div key={field.key}>
                <label htmlFor={`br-payout-${field.key}`} className="block text-[9px] font-mono text-white/50 uppercase mb-1">
                  {field.label}
                </label>
                <input
                  id={`br-payout-${field.key}`}
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={payout[field.key]}
                  onChange={(e) => setPayout((p) => ({ ...p, [field.key]: Number(e.target.value) }))}
                  className="w-full bg-black/40 border border-white/10 px-2 py-2 text-xs text-white focus:border-zoyd-yellow/50 touch-target"
                />
              </div>
            ))}
            <div>
              <label htmlFor="br-payout-arbiter" className="block text-[9px] font-mono text-white/50 uppercase mb-1">
                Arbitre
              </label>
              <input
                id="br-payout-arbiter"
                type="number"
                step="0.01"
                min="0"
                max={arbiterMax}
                value={payout.arbiterRate}
                onChange={(e) => setPayout((p) => ({ ...p, arbiterRate: Number(e.target.value) }))}
                className="w-full bg-black/40 border border-white/10 px-2 py-2 text-xs text-white focus:border-zoyd-yellow/50 touch-target"
              />
            </div>
          </div>
          {payoutError && <p className="text-[10px] text-red-400 mt-2">{payoutError}</p>}
          {!payoutError && (
            <p className="text-[10px] font-mono text-white/50 mt-2">
              Cagnotte de {formatZC(maxPlayers * entryFee)} si le salon est plein :{' '}
              {formatZC((maxPlayers * entryFee) * (payout.first || 0))} au 1er,{' '}
              {formatZC((maxPlayers * entryFee) * (payout.arbiterRate || 0))} a l'arbitre.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="br-notes" className="block text-[10px] font-mono text-white/70 uppercase tracking-wider mb-2">Note affichee aux joueurs</label>
          <textarea
            id="br-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white focus:border-zoyd-yellow/50 touch-target"
            placeholder="Ex. : debut a l'heure exacte,CODE salon commun, capture ecran obligatoire..."
          />
        </div>

        {/* Rappel de la regle que l'admin assume en creant le salon. */}
        <p className="text-[10px] text-white/60 border-l-2 border-zoyd-yellow/40 pl-2 leading-relaxed flex gap-2">
          <Info className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Tu es l'arbitre du salon : tu sera le seul a saisir les eliminations et
            a declencher le reglement. Le pass de chaque inscrit est bloque et
            n'est <strong className="text-white">pas rembourse</strong> s'il ne se
            presente pas au lancement.
          </span>
        </p>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 bg-zoyd-yellow text-black px-5 py-3 font-display font-black text-xs uppercase italic tracking-[0.2em] hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-target"
          >
            {saving ? 'Creation...' : 'Creer le salon'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="border border-white/15 px-5 py-3 font-display font-black text-xs uppercase italic tracking-[0.2em] text-white/70 hover:border-white/30 transition-colors touch-target"
          >
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
};

export default BrLobbyCreatePanel;
