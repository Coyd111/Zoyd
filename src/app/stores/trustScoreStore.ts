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
  hydrateFromUser: (user: { trustScore?: number; trustBreakdown?: Partial<TrustBreakdown> }) => void;
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

const defaultScore: TrustBreakdown = {
  overall: 50,
  punctuality: 50,
  fairPlay: 50,
  results: 50,
  disputes: 50,
  seniority: 50,
};

export const useTrustScoreStore = create<TrustScoreState>((set) => ({
  score: { ...defaultScore },
  history: [],

  hydrateFromUser: (user) => {
    if (!user) return;
    const overall = typeof user.trustScore === 'number' ? clamp(user.trustScore) : undefined;
    const breakdown = user.trustBreakdown;
    set((state) => ({
      score: {
        ...state.score,
        ...(overall !== undefined ? { overall } : {}),
        ...(breakdown?.punctuality !== undefined ? { punctuality: clamp(breakdown.punctuality) } : {}),
        ...(breakdown?.fairPlay !== undefined ? { fairPlay: clamp(breakdown.fairPlay) } : {}),
        ...(breakdown?.results !== undefined ? { results: clamp(breakdown.results) } : {}),
        ...(breakdown?.disputes !== undefined ? { disputes: clamp(breakdown.disputes) } : {}),
        ...(breakdown?.seniority !== undefined ? { seniority: clamp(breakdown.seniority) } : {}),
      },
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
