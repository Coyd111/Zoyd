import { useState } from 'react';

export const FinalResultsForm = ({
  finalists,
  onsubmit,
  isLoading,
}: {
  finalists: Array<{ userId: string; pseudo: string; totalPoints: number }>;
  onsubmit: (results: Array<{ userId: string; placement: number; kills: number }>) => void;
  isLoading: boolean;
}) => {
  const [entries, setEntries] = useState(() =>
    finalists.map((f) => ({ userId: f.userId, pseudo: f.pseudo, placement: 0, kills: 0 }))
  );

  const updateEntry = (userId: string, field: 'placement' | 'kills', value: number) => {
    setEntries((prev) => prev.map((e) => (e.userId === userId ? { ...e, [field]: value } : e)));
  };

  const handleSubmit = () => {
    const valid = entries.filter((e) => e.placement > 0);
    if (valid.length === 0) return;
    onsubmit(valid.map(({ userId, placement, kills }) => ({ userId, placement, kills })));
  };

  const sortedEntries = [...entries].sort((a, b) => a.placement - b.placement || b.kills - a.kills);

  return (
    <div className="border border-white/10 bg-zoyd-surface/20 p-5 space-y-4">
      <h3 className="text-sm font-bold text-white mb-3">Soumettre les resultats de la finale</h3>
      <p className="text-[10px] text-white/40 mb-4">
          Saisis le classement (placement) et les kills de chaque finaliste. Seuls les joueurs avec un placement {'>'} 0 seront enregistres.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-3 py-2 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40">Joueur</th>
              <th className="px-3 py-2 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Points</th>
              <th className="px-3 py-2 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Placement</th>
              <th className="px-3 py-2 text-[10px] font-mono font-bold tracking-wider uppercase text-white/40 text-right">Kills</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => (
              <tr key={entry.userId} className="border-b border-white/5">
                <td className="px-3 py-2 text-sm text-white">{entry.pseudo}</td>
                <td className="px-3 py-2 text-sm text-white/60 text-right">
                  {finalists.find((f) => f.userId === entry.userId)?.totalPoints || 0}
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={entry.placement || ''}
                    onChange={(e) => updateEntry(entry.userId, 'placement', Number(e.target.value))}
                    className="w-16 bg-white/5 border border-white/10 px-2 py-1 text-sm text-white text-center focus:border-zoyd-yellow/50 "
                    placeholder="#"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    value={entry.kills || ''}
                    onChange={(e) => updateEntry(entry.userId, 'kills', Number(e.target.value))}
                    className="w-16 bg-white/5 border border-white/10 px-2 py-1 text-sm text-white text-center focus:border-zoyd-yellow/50 "
                    placeholder="0"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-white/5 pt-3">
        <span className="text-[10px] text-white/40">
          {entries.filter((e) => e.placement > 0).length} / {entries.length} joueurs classe(s)
        </span>
        <button
          onClick={handleSubmit}
          disabled={isLoading || entries.filter((e) => e.placement > 0).length === 0}
          className="text-[10px] font-mono font-bold tracking-wider uppercase px-4 py-2 border border-zoyd-yellow/30 text-zoyd-yellow hover:bg-zoyd-yellow/10 transition-colors disabled:opacity-50"
        >
          Valider les resultats
        </button>
      </div>
    </div>
  );
};
