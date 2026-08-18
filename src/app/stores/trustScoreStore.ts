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
  hydrateFromUser: (trustScore: number) => void;
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const useTrustScoreStore = create<TrustScoreState>((set) => ({
  score: {
    overall: 84,
    punctuality: 92,
    fairPlay: 100,
    results: 68,
    disputes: 85,
    seniority: 45,
  },
  history: [],

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
