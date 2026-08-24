import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Hash, Lock, Globe, Users, MessageSquare, BellOff, MoreVertical, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  createServerChatChannel,
  fetchServerChatChannel,
  markServerChatChannelRead,
  sendServerChatMessage,
} from '../lib/chatApi';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useFriendsStore } from '../stores/friendsStore';
import { Button } from '../components/ui/Button';
import { cn, getRelativeTime, sanitizeText } from '../../lib/utils';

const channelIcons: Record<string, React.ReactNode> = {
  global: <Globe className="w-4 h-4" />,
  match: <ShieldCheck className="w-4 h-4" />,
  team: <Users className="w-4 h-4" />,
  private: <Lock className="w-4 h-4" />,
  arbitration: <ShieldCheck className="w-4 h-4 text-zoyd-blue" />,
};

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    channels,
    messages,
    activeChannelId,
    setActiveChannel,
    hydrateFromServer,
    receiveServerMessage,
    markAsRead,
    muteChannel,
    unmuteChannel,
    getMessagesForChannel,
    getUnreadTotal,
  } = useChatStore();
  const { friends } = useFriendsStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentMessages = useMemo(
    () => (activeChannelId ? getMessagesForChannel(activeChannelId) : []),
    [activeChannelId, messages, getMessagesForChannel]
  );
  const activeChannel = channels.find((channel) => channel.id === activeChannelId);

  useEffect(() => {
    if (activeChannelId) {
      markAsRead(activeChannelId);
      if (user) {
        void markServerChatChannelRead(activeChannelId).catch(() => undefined);
      }
    }
  }, [activeChannelId, messages.length, markAsRead, user]);

  useEffect(() => {
    if (!activeChannelId || !user) return;
    let cancelled = false;

    fetchServerChatChannel(activeChannelId)
      .then((payload) => {
        if (cancelled) return;
        hydrateFromServer([payload.channel], payload.messages);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeChannelId, hydrateFromServer, user]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentMessages.length]);

  const handleSend = async (event: React.FormEvent | React.KeyboardEvent) => {
    event.preventDefault();
    if (!activeChannelId) return;
    if (!user) {
      navigate('/auth/login');
      return;
    }
    if (!input.trim()) return;

    try {
      const payload = await sendServerChatMessage(activeChannelId, input.trim());
      hydrateFromServer([payload.channel], [payload.message]);
      receiveServerMessage(payload.message, user.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'envoyer ce message.");
      return;
    }

    setInput('');
  };

  const unreadTotal = getUnreadTotal();
  const onlineFriends = friends.filter((friend) => friend.status === 'online');

  return (
    <div className="safe-top flex flex-col bg-zoyd-black text-white font-ui scanline" style={{ height: 'calc(100svh - 3.5rem)' }}>
      <div className="fixed inset-0 tactical-grid opacity-5 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-surface/40 z-10 shrink-0">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Back button on mobile when channel is active */}
            {activeChannelId && (
              <button
                onClick={() => setActiveChannel(null)}
                className="touch-target sm:hidden text-white/40 hover:text-white transition-colors mr-1"
                aria-label="Retour aux canaux"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <MessageSquare className="w-4 h-4 text-zoyd-yellow" />
            <h1 className="text-base font-display font-black uppercase tracking-tighter italic">
              Messages{' '}
              {unreadTotal > 0 && <span className="text-zoyd-yellow text-sm">({unreadTotal})</span>}
            </h1>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-[10px] font-mono font-black uppercase tracking-widest text-white/30">
            <span className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              En ligne: {onlineFriends.length + 1}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-[1500px] w-full mx-auto flex relative z-10 min-h-0 overflow-hidden">
        {/* Channel sidebar — full width on mobile when no channel active, hidden when channel active */}
        <div className={cn(
          'border-r border-white/5 bg-zoyd-black/80 flex flex-col shrink-0 relative overflow-hidden',
          activeChannelId ? 'hidden sm:flex sm:w-64' : 'w-full sm:w-64'
        )}>
          <img src="/assets/images/codm-7.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-5 mix-blend-luminosity grayscale pointer-events-none" />
          <div className="p-4 border-b border-white/5">
            <button
              onClick={() => {
                if (!user) {
                  navigate('/auth/login');
                  return;
                }

                void createServerChatChannel({
                  type: 'private',
                  name: 'Nouvelle conversation',
                  participants: [user.id],
                })
                  .then((payload) => {
                    hydrateFromServer([payload.channel], payload.messages);
                    setActiveChannel(payload.channel.id);
                  })
                  .catch((error) => {
                    toast.error(
                      error instanceof Error ? error.message : 'Impossible de creer cette conversation.'
                    );
                  });
              }}
              className="w-full bg-white text-black py-3 font-display font-black text-[10px] tracking-[0.2em] uppercase italic hover:bg-zoyd-yellow transition-colors"
              aria-label="Créer une nouvelle discussion"
            >
              Nouvelle discussion
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {channels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => setActiveChannel(channel.id)}
                aria-label={`Ouvrir le canal ${channel.name}`}
                className={cn(
                  'touch-target w-full flex items-center justify-between px-3 py-2.5 text-left transition-all font-display font-black text-[11px] tracking-wider uppercase italic',
                  activeChannelId === channel.id
                    ? 'bg-white text-black'
                    : 'text-white/40 hover:bg-white/5 hover:text-white/60'
                )}
              >
                <div className="flex items-center gap-3">
                  {channelIcons[channel.type] || <Hash className="w-4 h-4" />}
                  <span className="truncate max-w-[120px]">{channel.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {channel.isMuted && <BellOff className="w-3 h-3 text-white/20" />}
                  {channel.unreadCount > 0 && !channel.isMuted && (
                    <span className="bg-zoyd-blue text-white text-[9px] px-1.5 py-0.5 font-mono font-bold">
                      {channel.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-white/5 p-4">
            <div className="text-[9px] font-mono font-black uppercase tracking-widest text-white/20 mb-3 italic">
              Amis en ligne
            </div>
            <div className="space-y-2">
              {onlineFriends.slice(0, 5).map((friend) => (
                <div key={friend.id} className="flex items-center gap-2 text-[11px] font-display font-black text-white/40 uppercase italic">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  {friend.pseudo}
                </div>
              ))}
              {onlineFriends.length === 0 && (
                <div className="text-[10px] font-mono text-white/20">Aucun ami connecte</div>
              )}
            </div>
          </div>
        </div>

        <div className={cn('flex-1 flex flex-col bg-zoyd-black/40 min-w-0', !activeChannelId && 'hidden sm:flex')}>
          {activeChannel ? (
            <>
              <div className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-zoyd-surface/20">
                <div className="flex items-center gap-3">
                  {channelIcons[activeChannel.type] || <Hash className="w-4 h-4 text-white/40" />}
                  <div>
                    <h2 className="font-display font-black text-white text-sm uppercase italic">{activeChannel.name}</h2>
                    <span className="text-[9px] font-mono text-white/20 uppercase tracking-wider">
                      {activeChannel.participants.length} participant{activeChannel.participants.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() =>
                    activeChannel.isMuted ? unmuteChannel(activeChannel.id) : muteChannel(activeChannel.id)
                  }
                  className="text-white/20 hover:text-white transition-colors"
                  aria-label={activeChannel.isMuted ? 'Activer les notifications' : 'Couper les notifications'}
                >
                  {activeChannel.isMuted ? <BellOff className="w-4 h-4" /> : <MoreVertical className="w-4 h-4" />}
                </button>
              </div>

              <div ref={containerRef} role="log" aria-live="polite" className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                <AnimatePresence>
                  {currentMessages.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="h-full flex flex-col items-center justify-center text-white/10"
                    >
                      <MessageSquare className="w-12 h-12 mb-4" />
                      <span className="font-mono text-[10px] uppercase font-black tracking-widest">
                        Aucun message dans cette discussion
                      </span>
                    </motion.div>
                  )}
                  {currentMessages.map((message) => {
                    const isMe = message.senderId === user?.id;

                    if (message.isSystem) {
                      return (
                        <motion.div
                          key={message.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="w-full flex items-center gap-4 py-2"
                        >
                          <div className="flex-1 h-[1px] bg-white/5" />
                          <span className="text-zoyd-yellow text-[9px] uppercase font-black tracking-[0.2em] italic bg-zoyd-yellow/5 px-3 py-1 border border-zoyd-yellow/10">
                            Systeme: {sanitizeText(message.text)}
                          </span>
                          <div className="flex-1 h-[1px] bg-white/5" />
                        </motion.div>
                      );
                    }

                    return (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {!isMe && <div className="w-1.5 h-1.5 bg-zoyd-blue" />}
                          <span className={`text-[10px] font-display font-black tracking-widest uppercase ${isMe ? 'text-white' : 'text-white/40'}`}>
                            {message.senderPseudo}
                          </span>
                          <span className="text-[9px] font-mono text-white/20">{getRelativeTime(message.timestamp)}</span>
                          {isMe && <div className="w-1.5 h-1.5 bg-zoyd-yellow" />}
                        </div>
                        <div
                          className={`max-w-[70%] p-4 border transition-all ${
                            isMe
                              ? 'border-zoyd-yellow/20 bg-zoyd-yellow/5 text-white'
                              : 'border-white/5 bg-zoyd-surface/40 text-white/70'
                          } ${message.isDeleted ? 'opacity-50 line-through' : ''}`}
                        >
                          {sanitizeText(message.text)}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSend} className="p-4 border-t border-white/5 bg-zoyd-surface/40 flex gap-3">
                <input
                  type="text"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend(event);
                    }
                  }}
                  placeholder="Envoyer un message..."
                  aria-label="Saisir un message"
                  className="touch-target flex-1 bg-black border border-white/10 px-5 py-3.5 text-xs font-display font-bold tracking-widest text-white focus:outline-none focus:border-zoyd-blue transition-colors"
                />
                <Button type="submit" variant="primary" disabled={!input.trim()} className="touch-target px-6" aria-label="Envoyer le message">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-white/10">
              <div className="text-center">
                <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <span className="font-mono text-[10px] uppercase font-black tracking-widest">
                  Selectionne une discussion
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
