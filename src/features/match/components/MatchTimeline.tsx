import React from 'react';
import { MatchChat } from './MatchChat';
import type { ChatMessage } from '../../stores/chatStore';
import type { RoomPresenceMember, TypingMember } from '../../stores/presenceStore';

interface MatchTimelineProps {
  messages: ChatMessage[];
  channelConnected: boolean;
  channelPresence: RoomPresenceMember[];
  typingUsers: TypingMember[];
  readCount: number;
  presenceSummary: {
    onlineCount: number;
    checkedInCount: number;
    readyCount: number;
    arbiterOnline: boolean;
    total: number;
  };
  lastHeartbeatAt: string | null;
  onTypingChange: (isTyping: boolean) => void;
  onSendMessage: (text: string) => void;
}

export const MatchTimeline: React.FC<MatchTimelineProps> = React.memo(({
  messages,
  channelConnected,
  channelPresence,
  typingUsers,
  readCount,
  presenceSummary,
  lastHeartbeatAt,
  onTypingChange,
  onSendMessage,
}) => (
  <div className="h-[520px]">
    <div className="mb-4 border border-white/5 bg-black/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/25 mb-1">
            Presence salon
          </div>
          <div className="text-sm text-white/65">
            {presenceSummary.onlineCount}/{presenceSummary.total} presents, {presenceSummary.checkedInCount} check-in, {presenceSummary.readyCount} prets.
          </div>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-white/25">
          {presenceSummary.arbiterOnline ? 'Arbitre actif' : 'Arbitre attendu'}
          {lastHeartbeatAt ? ` / sync ${new Date(lastHeartbeatAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>
      </div>
    </div>
    <MatchChat
      messages={messages}
      isConnected={channelConnected}
      presence={channelPresence}
      typingUsers={typingUsers}
      readCount={readCount}
      onTypingChange={onTypingChange}
      onSendMessage={onSendMessage}
    />
  </div>
));
