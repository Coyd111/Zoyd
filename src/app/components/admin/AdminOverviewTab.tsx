import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { getRelativeTime } from '../../../lib/utils';
import { PriorityBadge, StatusLane, moderationToneMap } from './AdminTabShared';
import type { PriorityItem, AdminEvent } from './AdminTabShared';

type AdminOverviewTabProps = {
  priorityQueue: PriorityItem[];
  readyMatchesCount: number;
  liveMatchesCount: number;
  pendingReportsCount: number;
  recentEvents: AdminEvent[];
  onNavigateToTab: (tab: string) => void;
};

const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  priorityQueue,
  readyMatchesCount,
  liveMatchesCount,
  pendingReportsCount,
  recentEvents,
  onNavigateToTab,
}) => {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="grid xl:grid-cols-[1.2fr_0.8fr] gap-6">
        <section className="p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">
                PRIORITY QUEUE
              </div>
              <h2 className="text-xl font-display font-black uppercase italic">Ce qui doit bouger maintenant</h2>
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/30">
              {priorityQueue.length} cartes actives
            </div>
          </div>

          {priorityQueue.length === 0 ? (
            <p className="text-white/30 text-sm font-mono">Aucune urgence locale remontee.</p>
          ) : (
            <div className="space-y-3">
              {priorityQueue.map((item) => (
                <button
                  key={item.id}
                  onClick={item.action}
                  className="w-full text-left p-4 transition-colors"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <PriorityBadge kind={item.kind} />
                        <span className="font-display font-black text-sm uppercase italic text-white">
                          {item.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-white/45">{item.body}</div>
                    </div>
                    <div className="flex items-center justify-between lg:justify-end gap-4 shrink-0">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-white/25">
                        {getRelativeTime(item.timestamp)}
                      </span>
                      <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow">
                        {item.actionLabel}
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div className="p-6">
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-4">
              OPERATIONS HEALTH
            </div>
            <div className="space-y-3">
              <StatusLane
                label="Check-in / Ready"
                count={readyMatchesCount}
                body="Slots complets mais encore bloques dans le tunnel avant match."
                accent="bg-zoyd-blue"
              />
              <StatusLane
                label="Matchs live"
                count={liveMatchesCount}
                body="Salons actuellement en cours et a surveiller."
                accent="bg-green-500"
              />
              <StatusLane
                label="Reports pending"
                count={pendingReportsCount}
                body="Signalements utilisateurs qui attendent un triage."
                accent="bg-zoyd-yellow"
              />
            </div>
          </div>

          <div className="p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">
                  RECENT SIGNALS
                </div>
                <h2 className="text-lg font-display font-black uppercase italic">Journal moderation</h2>
              </div>
              <button
                onClick={() => onNavigateToTab('users')}
                className="text-[10px] font-mono uppercase tracking-widest text-zoyd-yellow"
              >
                Ouvrir la watchlist
              </button>
            </div>

            {recentEvents.length === 0 ? (
              <p className="text-white/30 text-sm font-mono">Aucun evenement recent.</p>
            ) : (
              <div className="space-y-3">
                {recentEvents.slice(0, 5).map((event) => (
                  <div
                    key={event.id}
                    className={`flex items-center justify-between gap-4 border p-3 ${moderationToneMap[event.tone]}`}
                  >
                    <div>
                      <div className="font-display font-black text-sm uppercase italic">{event.action}</div>
                      <div className="text-[10px] font-mono text-white/30">{event.target}</div>
                    </div>
                    <span className="text-[10px] font-mono text-white/25">
                      {getRelativeTime(event.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </motion.div>
  );
};

export default AdminOverviewTab;
