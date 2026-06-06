import React, { useEffect, useRef, useState } from 'react';
import { Send, ShieldCheck, Terminal, Users, Radio } from 'lucide-react';
import type { ChatMessage } from '../../../app/stores/chatStore';
import { useAuthStore } from '../../../app/stores/authStore';
import type { RoomPresenceMember, TypingMember } from '../../../app/stores/socketStore';

interface MatchChatProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isConnected: boolean;
  onTypingChange?: (isTyping: boolean) => void;
  presence: RoomPresenceMember[];
  typingUsers: TypingMember[];
  readCount: number;
}

export const MatchChat: React.FC<MatchChatProps> = ({
  messages,
  onSendMessage,
  isConnected,
  onTypingChange,
  presence,
  typingUsers,
  readCount,
}) => {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  const { user } = useAuthStore();
  const currentUserId = user?.id || 'u1';
  const onlineMembers = presence.filter((member) => member.isOnline);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(
    () => () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      onTypingChange?.(false);
    },
    [onTypingChange]
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!inputValue.trim()) return;

    onSendMessage(inputValue.trim());
    setInputValue('');
    onTypingChange?.(false);
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (!isConnected || !onTypingChange) return;

    onTypingChange(value.trim().length > 0);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => onTypingChange(false), 1600);
  };

  return (
    <div className="flex flex-col h-full border border-white/5 bg-zoyd-black/60 backdrop-blur-md">
      <div className="p-4 border-b border-white/5 bg-zoyd-surface/80">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <Terminal className="w-4 h-4 text-zoyd-blue" />
              <h3 className="font-display font-black text-white uppercase tracking-widest text-xs italic">
                Canal Tactique
              </h3>
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-pulse'
                  }`}
                />
                <span className="text-[9px] font-mono text-white/30 tracking-widest uppercase">
                  {isConnected ? 'Canal actif' : 'Hors-ligne'}
                </span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] font-mono uppercase tracking-widest text-white/25">
              <span className="inline-flex items-center gap-1.5 border border-white/10 px-2 py-1">
                <Users className="w-3 h-3" />
                {onlineMembers.length}/{presence.length} presents
              </span>
              <span className="inline-flex items-center gap-1.5 border border-white/10 px-2 py-1">
                <Radio className="w-3 h-3" />
                {readCount} lecture(s)
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {presence.map((member) => (
                <div
                  key={`${member.userId}-${member.role}`}
                  className={`px-2.5 py-1 border text-[9px] font-mono uppercase tracking-widest ${
                    member.isOnline
                      ? member.role === 'arbiter'
                        ? 'border-zoyd-blue/30 text-zoyd-blue bg-zoyd-blue/5'
                        : 'border-green-500/20 text-green-400 bg-green-500/5'
                      : 'border-white/10 text-white/25 bg-black/20'
                  }`}
                >
                  {member.role === 'arbiter'
                    ? 'Arbitre'
                    : member.team === 0
                      ? 'Alpha'
                      : member.team === 1
                        ? 'Bravo'
                        : 'Salon'}{' '}
                  / {member.pseudo}
                </div>
              ))}
            </div>
          </div>

          <ShieldCheck className="w-4 h-4 text-white/20 shrink-0" title="Canal securise" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar font-ui text-sm">
        {!isConnected ? (
          <div className="h-full flex flex-col items-center justify-center text-white/20 text-center">
            <Terminal className="w-8 h-8 mb-4 opacity-10" />
            <span className="font-mono text-[10px] uppercase font-bold tracking-widest">
              Etablissement de la connexion securisee...
            </span>
          </div>
        ) : null}

        {isConnected &&
          messages.map((message) => {
            const isMe = message.senderId === currentUserId;

            if (message.isSystem) {
              return (
                <div key={message.id} className="w-full flex items-center gap-4 py-2">
                  <div className="flex-1 h-[1px] bg-white/5" />
                  <span className="text-zoyd-yellow text-[9px] uppercase font-black tracking-[0.2em] italic bg-zoyd-yellow/5 px-3 py-1 border border-zoyd-yellow/10">
                    Avis : {message.text}
                  </span>
                  <div className="flex-1 h-[1px] bg-white/5" />
                </div>
              );
            }

            return (
              <div key={message.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {!isMe ? <div className="w-1.5 h-1.5 bg-zoyd-blue" /> : null}
                  <span
                    className={`text-[10px] font-display font-black tracking-widest uppercase ${
                      isMe ? 'text-white' : 'text-white/40'
                    }`}
                  >
                    {message.senderPseudo}
                  </span>
                  {isMe ? <div className="w-1.5 h-1.5 bg-zoyd-yellow" /> : null}
                </div>
                <div
                  className={`max-w-[85%] p-4 border transition-all ${
                    isMe
                      ? 'border-zoyd-yellow/20 bg-zoyd-yellow/5 text-white'
                      : 'border-white/5 bg-zoyd-surface/60 text-white/60'
                  }`}
                >
                  {message.text}
                </div>
              </div>
            );
          })}

        {isConnected && typingUsers.length > 0 ? (
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/25">
            {typingUsers.map((member) => member.pseudo).join(', ')} ecrit...
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-white/5 bg-zoyd-surface/60">
        <form onSubmit={handleSubmit} className="flex gap-4">
          <input
            type="text"
            value={inputValue}
            onChange={(event) => handleInputChange(event.target.value)}
            disabled={!isConnected}
            placeholder="Transmettre un message..."
            className="flex-1 bg-black border border-white/10 px-5 py-3.5 text-xs font-display font-bold tracking-widest text-white focus:outline-none focus:border-zoyd-blue transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || !isConnected}
            className="w-14 bg-white text-black hover:bg-zoyd-yellow transition-colors disabled:opacity-50 flex items-center justify-center border-none"
            aria-label="Envoyer"
            title="Envoyer le message"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
};
