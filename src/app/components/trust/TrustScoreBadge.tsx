import React from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, ShieldAlert, Shield, ShieldX } from 'lucide-react';
import {
  getTrustColor,
  getTrustBg,
  getTrustLabel,
  categoryLabels,
  useTrustScoreStore,
  type TrustBreakdown,
} from '../../stores/trustScoreStore';

interface Props {
  score: TrustBreakdown;
  compact?: boolean;     // petit badge inline
  detailed?: boolean;    // carte avec barres
}

const TrustScoreBadge: React.FC<Props> = ({ score, compact, detailed }) => {
  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] font-mono font-black uppercase tracking-wider ${
          score.overall >= 80
            ? 'border-green-500/30 text-green-400 bg-green-500/5'
            : score.overall >= 50
            ? 'border-zoyd-yellow/30 text-zoyd-yellow bg-zoyd-yellow/5'
            : score.overall >= 30
            ? 'border-orange-500/30 text-orange-400 bg-orange-500/5'
            : 'border-red-500/30 text-red-400 bg-red-500/5'
        }`}
        title={`Fiabilite: ${score.overall}/100`}
      >
        <ShieldCheck className="w-3 h-3" />
        {score.overall}
      </span>
    );
  }

  return (
    <div className={`hud-panel bg-zoyd-surface/10 border-white/5 ${detailed ? 'p-6' : 'p-4'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 border-2 flex items-center justify-center ${
              score.overall >= 80
                ? 'border-green-500/40 text-green-400'
                : score.overall >= 50
                ? 'border-zoyd-yellow/40 text-zoyd-yellow'
                : score.overall >= 30
                ? 'border-orange-500/40 text-orange-400'
                : 'border-red-500/40 text-red-400'
            }`}
          >
            {score.overall >= 80 ? (
              <ShieldCheck className="w-5 h-5" />
            ) : score.overall >= 50 ? (
              <Shield className="w-5 h-5" />
            ) : score.overall >= 30 ? (
              <ShieldAlert className="w-5 h-5" />
            ) : (
              <ShieldX className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="text-[10px] font-mono font-black uppercase tracking-widest text-white/40">
              FIABILITE
            </div>
            <div className={`text-sm font-display font-black uppercase tracking-tight ${getTrustColor(score.overall)}`}>
              {getTrustLabel(score.overall)}
            </div>
          </div>
        </div>
        <div className={`text-3xl font-display font-black italic ${getTrustColor(score.overall)}`}>
          {score.overall}
          <span className="text-white/40 text-lg">/100</span>
        </div>
      </div>

      {/* Main bar */}
      <div className="h-2 bg-white/5 mb-1 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score.overall}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className={`h-full ${getTrustBg(score.overall)}`}
        />
      </div>

      {/* Detail bars */}
      {detailed && (
        <div className="mt-6 space-y-4">
          {(Object.keys(categoryLabels) as Array<keyof typeof categoryLabels>).map((key) => {
            const val = score[key];
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-white/30">
                    {categoryLabels[key]}
                  </span>
                  <span className={`text-[11px] font-mono font-black ${getTrustColor(val)}`}>
                    {val}
                  </span>
                </div>
                <div className="h-1 bg-white/5 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${val}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                    className={`h-full ${getTrustBg(val)}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TrustScoreBadge;
