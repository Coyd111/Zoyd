import { create } from 'zustand';

export interface TrustBreakdown {
  overall: number;      // 0-100
  punctuality: number;  // respect des horaires, check-in
  fairPlay: number;     // pas de triche, pas de rage quit
  results: number;      // acceptation rapide des résultats
  disputes: number;     // ratio litiges gagnés/perdus
  seniority: number;    // ancienneté sur la plateforme
}

export interface TrustScoreState {
  score: TrustBreakdown;
  history: { date: string; delta: number; reason: string }[];
  setScore: (s: TrustBreakdown) => void;
  updateCategory: (cat: keyof Omit<TrustBreakdown, 'overall'>, value: number) => void;
  recalcOverall: () => void;
  addHistory: (entry: { delta: number; reason: string }) => void;
  hydrateFromUser: (trustScore: number) => void;
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const useTrustScoreStore = create<TrustScoreState>((set, get) => ({
  score: {
    overall: 84,
    punctuality: 92,
    fairPlay: 100,
    results: 68,
    disputes: 85,
    seniority: 45,
  },
  history: [
    { date: '2025-04-12', delta: +3, reason: 'Check-in à l\'heure match #MJ-2291' },
    { date: '2025-04-10', delta: -10, reason: 'Absence au check-in match #MJ-2288' },
    { date: '2025-04-08', delta: +5, reason: 'Confirmation rapide résultat match #MJ-2285' },
    { date: '2025-04-05', delta: +2, reason: 'Match terminé sans litige' },
    { date: '2025-03-28', delta: -8, reason: 'Litige perdu match #MJ-2254' },
  ],

  setScore: (s) => set({ score: s }),

  updateCategory: (cat, value) =>
    set((state) => ({
      score: { ...state.score, [cat]: clamp(value) },
    })),

  recalcOverall: () => {
    const s = get().score;
    const weights = { punctuality: 0.25, fairPlay: 0.30, results: 0.20, disputes: 0.15, seniority: 0.10 };
    const overall = clamp(
      s.punctuality * weights.punctuality +
      s.fairPlay * weights.fairPlay +
      s.results * weights.results +
      s.disputes * weights.disputes +
      s.seniority * weights.seniority
    );
    set((state) => ({ score: { ...state.score, overall } }));
  },

  addHistory: (entry) =>
    set((state) => ({
      history: [
        { date: new Date().toISOString().split('T')[0], ...entry },
        ...state.history,
      ].slice(0, 50),
    })),

  hydrateFromUser: (trustScore) => {
    if (typeof trustScore !== 'number') return;
    set((state) => ({
      score: { ...state.score, overall: clamp(trustScore) },
    }));
  },
}));

// Helpers
export function getTrustColor(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 50) return 'text-zoyd-yellow';
  if (score >= 30) return 'text-orange-400';
  return 'text-red-400';
}

export function getTrustBg(score: number): string {
  if (score >= 80) return 'bg-green-400';
  if (score >= 50) return 'bg-zoyd-yellow';
  if (score >= 30) return 'bg-orange-400';
  return 'bg-red-400';
}

export function getTrustLabel(score: number): string {
  if (score >= 90) return 'VÉRIFIÉ ZOYD';
  if (score >= 80) return 'EXEMPLAIRE';
  if (score >= 50) return 'FIABLE';
  if (score >= 30) return 'À SURVEILLER';
  return 'RISQUÉ';
}

export const categoryLabels: Record<keyof Omit<TrustBreakdown, 'overall'>, string> = {
  punctuality: 'Ponctualité',
  fairPlay: 'Fair-play',
  results: 'Résultats',
  disputes: 'Litiges',
  seniority: 'Ancienneté',
};

export const categoryIcons: Record<keyof Omit<TrustBreakdown, 'overall'>, string> = {
  punctuality: '⏱',
  fairPlay: '⚔',
  results: '📊',
  disputes: '🛡',
  seniority: '⭐',
};
