/**
 * ChatPage - messagerie : canaux, messages, non-lus, saisie en cours.
 *
 * Compose les canaux (global, match, prive), la lecture, l'envoi et la
 * presence du canal actif. La lecture et l'ecriture passent par l'API, les
 * messages entrants par le socket.
 *
 * INVARIANT : l'envoi d'un message passe par sendServerChatMessage (API).
 * chatStore.sendMessage ne fait qu'une mutation LOCALE : le message
 * n'existerait pour personne d'autre et disparaitrait au rechargement.
 * INVARIANT : l'ecriture de presence et de saisie passe par le socket, avec
 * un garde `isRealtimeSocketConnected`. Hors ligne, le store garde l'etat
 * local et le serveur rattrapera a la reconnexion.
 * PIEGE : marquer un canal comme lu est une ecriture : elle part au serveur
 * et se propage aux autres onglets par l'evenement socket chat:read.
 * PIEGE : ne jamais afficher un message systeme comme un message de joueur :
 * le rendu distingue les deux (isSystem).
 * P13 C3 (audit-3) : la creation de canal prive etait mono-participant
 * (participants: [user.id]) — un salon sans interlocuteur, et le bouton
 * "Nouvelle discussion" n'avait aucun autre moyen de designer le destinaire.
 * La voie est openDm : find-or-create du canal PRIVE A DEUX (le serveur
 * ajoute la session aux participants valides, chat.mjs:131), declenche par
 * le selecteur d'amis ici, le bouton Message du widget amis, ou un profil
 * public via /chat?dm=<id> (effet dedie). PIEGE : le find passe par un
 * bootstrap FRAIS (fetchChatBootstrap), pas par les canaux deja hydrates :
 * au demarrage a froid via /chat?dm=, le bootstrap App peut encore etre en
 * vol et un find local raterait le canal existant (les ids de canal sont
 * des timestamps : aucune deduplication par participants cote serveur).
 *
 * Voir aussi : docs/08-frontend.md - section 7.2 (Les 13 evenements)
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Send, Hash, Lock, Globe, Users, MessageSquare, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from '../lib/toast';
import {
  createServerChatChannel,
  fetchChatBootstrap,
  fetchServerChatChannel,
  markServerChatChannelRead,
  sendServerChatMessage,
} from '../lib/chatApi';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useFriendsStore } from '../stores/friendsStore';
import { Button } from '../components/ui/Button';
import { cn, getRelativeTime, sanitizeText } from '../../lib/utils';
import { SEOHead } from '../components/SEOHead';

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
  const prefersReducedMotion = useReducedMotion();
  const channels = useChatStore((s) => s.channels);
  const messages = useChatStore((s) => s.messages);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const hydrateFromServer = useChatStore((s) => s.hydrateFromServer);
  const receiveServerMessage = useChatStore((s) => s.receiveServerMessage);
  const markAsRead = useChatStore((s) => s.markAsRead);
  const getMessagesForChannel = useChatStore((s) => s.getMessagesForChannel);
  const getUnreadTotal = useChatStore((s) => s.getUnreadTotal);
  const friends = useFriendsStore((s) => s.friends);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // P13 C3 : le dm=<id> deja traite (evite de rejouer a chaque rendu de
  // l'effet) et le garde anti double-creation en vol.
  const dmHandledRef = useRef<string | null>(null);
  const isCreatingDmRef = useRef(false);

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

  /**
   * P13 C3 (audit-3) : ouvre — ou cree si besoin — le canal prive a deux
   * avec un joueur. Le front n'envoie QUE l'autre participant : le serveur
   * ajoute la session aux participants valides (chat.mjs:131) — envoyer
   * user.id recreait le canal mono-participant du constat. Le nom du canal
   * est le pseudo de l'interlocuteur (lorsqu'il est un ami hydrate) : les
   * deux côtés voient ainsi le pseudo de l'autre, sans champ usurpable.
   */
  const openDm = useCallback((targetId: string) => {
    if (!user || isCreatingDmRef.current) return;
    isCreatingDmRef.current = true;
    const nameHint = friends.find((friend) => friend.id === targetId)?.pseudo || 'Conversation privée';
    // Le find passe par un bootstrap FRAIS, pas par les canaux deja
    // hydrates : au demarrage a froid le bootstrap App peut encore etre en
    // vol (voir docstring).
    fetchChatBootstrap()
      .then((payload) => {
        const existing = payload.channels.find(
          (channel) =>
            channel.type === 'private' &&
            channel.participants.length === 2 &&
            channel.participants.includes(user.id) &&
            channel.participants.includes(targetId)
        );
        if (existing) {
          hydrateFromServer(payload.channels, payload.messages);
          setActiveChannel(existing.id);
          return null;
        }
        return createServerChatChannel({ type: 'private', name: nameHint, participants: [targetId] });
      })
      .then((created) => {
        if (created) {
          hydrateFromServer([created.channel], created.messages);
          setActiveChannel(created.channel.id);
        }
      })
      .catch((error) => {
        // Re-autorise un essai ulterieur (nouveau clic, nouvelle navigation).
        dmHandledRef.current = null;
        toast.error(error instanceof Error ? error.message : "Impossible d'ouvrir cette conversation.");
      })
      .finally(() => {
        isCreatingDmRef.current = false;
      });
  }, [user, friends, hydrateFromServer, setActiveChannel]);

  // P13 C3 : point d'entree /chat?dm=<id> (bouton Message du widget amis et
  // des profils publics). Le parametre est purge apres lecture : la
  // conversation ouverte reste active via le store, le rafraichissement ne
  // rejoue pas la creation.
  useEffect(() => {
    const dmId = searchParams.get('dm');
    if (!dmId || !user) return;
    if (dmHandledRef.current === dmId) return;
    dmHandledRef.current = dmId;
    openDm(dmId);
    setSearchParams({}, { replace: true });
  }, [searchParams, user, openDm, setSearchParams]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom) {
      // Scrolle le conteneur uniquement (scrollIntoView déplacerait aussi la page)
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [currentMessages.length]);

  const handleSend = async (event: React.FormEvent | React.KeyboardEvent) => {
    event.preventDefault();
    if (!activeChannelId || isSending) return;
    if (!user) {
      navigate('/auth/login');
      return;
    }
    if (!input.trim()) return;

    setIsSending(true);
    try {
      const payload = await sendServerChatMessage(activeChannelId, input.trim());
      receiveServerMessage(payload.message, user.id);
      setInput('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'envoyer ce message.");
    } finally {
      setIsSending(false);
    }
  };

  const unreadTotal = getUnreadTotal();
  const onlineFriends = useMemo(() => friends.filter((friend) => friend.status === 'online'), [friends]);

  return (
    <div className="safe-top flex flex-col bg-zoyd-black text-white font-ui scanline h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-4.5rem)]">
      <SEOHead title="Chat — ZOYD" description="Discute avec la communauté ZOYD en temps réel." path="/chat" noindex />
      <a href="#chat-main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-zoyd-blue focus:text-white">
        Aller au contenu principal
      </a>
      <div className="fixed inset-0 tactical-grid opacity-5 pointer-events-none" />

      <header className="relative border-b border-white/5 bg-zoyd-surface/40 z-10 shrink-0">
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Back button on mobile when channel is active */}
            {activeChannelId && (
              <button
                onClick={() => setActiveChannel(null)}
                className="touch-target sm:hidden text-white/70 hover:text-white transition-colors mr-1"
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
          <div className="hidden sm:flex items-center gap-4 text-[10px] font-mono font-black uppercase tracking-widest text-white/60">
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
            {/* P13 C3 (audit-3) : l'ancien bouton creait un canal prive
                mono-participant (participants: [user.id]) — un salon sans
                interlocuteur. Il ouvre maintenant un selecteur parmi les
                amis : le canal a deux passe par openDm (find-or-create,
                voir docstring). */}
            <button
              onClick={() => {
                if (!user) {
                  navigate('/auth/login');
                  return;
                }
                setShowFriendPicker((open) => !open);
              }}
              aria-expanded={showFriendPicker}
              className="w-full bg-white text-black py-3 font-display font-black text-[10px] tracking-[0.2em] uppercase italic hover:bg-zoyd-yellow transition-colors"
              aria-label="Choisir un ami pour démarrer une discussion"
            >
              Nouvelle discussion
            </button>
            {showFriendPicker && (
              <div className="mt-2 max-h-52 overflow-y-auto border border-white/10 bg-zoyd-black/80">
                {friends.length === 0 ? (
                  <p className="p-3 text-[10px] font-mono text-white/70">
                    Ajoute des amis pour démarrer une conversation privée.
                  </p>
                ) : (
                  friends.map((friend) => (
                    <button
                      key={friend.id}
                      onClick={() => {
                        setShowFriendPicker(false);
                        openDm(friend.id);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-left text-[11px] font-display font-black uppercase italic text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                      aria-label={`Ouvrir une conversation avec ${friend.pseudo}`}
                    >
                      <span className="truncate">{friend.pseudo}</span>
                      <span className={cn('w-2 h-2 rounded-full shrink-0', friend.status === 'online' ? 'bg-green-500' : 'bg-white/10')} />
                    </button>
                  ))
                )}
              </div>
            )}
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
                    : 'text-white/70 hover:bg-white/5 hover:text-white/60'
                )}
              >
                <div className="flex items-center gap-3">
                  {channelIcons[channel.type] || <Hash className="w-4 h-4" />}
                  <span className="truncate max-w-[120px]">{channel.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {channel.unreadCount > 0 && (
                    <span className="bg-zoyd-blue text-white text-[10px] px-1.5 py-0.5 font-mono font-bold">
                      {channel.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-white/5 p-4">
            <div className="text-[10px] font-mono font-black uppercase tracking-widest text-white/70 mb-3 italic">
              Amis en ligne
            </div>
            <div className="space-y-2">
              {onlineFriends.slice(0, 5).map((friend) => (
                <div key={friend.id} className="flex items-center gap-2 text-[11px] font-display font-black text-white/70 uppercase italic">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  {friend.pseudo}
                </div>
              ))}
              {onlineFriends.length === 0 && (
                <div className="text-[10px] font-mono text-white/70">Aucun ami connecté</div>
              )}
            </div>
          </div>
        </div>

        <div className={cn('flex-1 flex flex-col bg-zoyd-black/40 min-w-0', !activeChannelId && 'hidden sm:flex')}>
          {activeChannel ? (
            <>
              <div className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-zoyd-surface/20">
                <div className="flex items-center gap-3">
                  {channelIcons[activeChannel.type] || <Hash className="w-4 h-4 text-white/70" />}
                  <div>
                    <h2 className="font-display font-black text-white text-sm uppercase italic">{activeChannel.name}</h2>
                    <span className="text-[10px] font-mono text-white/70 uppercase tracking-wider">
                      {activeChannel.participants.length} participant{activeChannel.participants.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </div>
              {/* P13 C16 (audit-3) : le bouton mute/unmute du canal est retire.
                  Son fetch POST /api/chat/channels/:id/mute pointait sur une
                  route qui N'EXISTE PAS cote serveur (grep server : aucune
                  route mute) : le fetch repondait 404 sans rejeter, le
                  rollback du catch n'a jamais pu s'executer, et l'etat
                  isMuted n'etait qu'une fiction de session perdue au
                  rechargement. De plus isMuted est un champ GLOBAL du canal :
                  l'implementer tel quel mueterait le canal pour TOUS les
                  participants. Un vrai mute est une preference PAR
                  UTILISATEUR (mutedChannelIds persistes + routes serveur) :
                  le reintroduire suppose ce mecanisme d'abord. */}

              <div ref={containerRef} role="log" aria-live="polite" className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                <AnimatePresence>
                  {currentMessages.length === 0 && (
                    <motion.div
                      initial={prefersReducedMotion ? false : { opacity: 0 }}
                      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1 }}
                      className="h-full flex flex-col items-center justify-center text-white/70"
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
                          initial={prefersReducedMotion ? false : { opacity: 0 }}
                          animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1 }}
                          className="w-full flex items-center gap-4 py-2"
                        >
                          <div className="flex-1 h-[1px] bg-white/5" />
                          <span className="text-zoyd-yellow text-[10px] uppercase font-black tracking-[0.2em] italic bg-zoyd-yellow/5 px-3 py-1 border border-zoyd-yellow/10">
                            Système: {sanitizeText(message.text)}
                          </span>
                          <div className="flex-1 h-[1px] bg-white/5" />
                        </motion.div>
                      );
                    }

                    return (
                      <motion.div
                        key={message.id}
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 5 }}
                        animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {!isMe && <div className="w-1.5 h-1.5 bg-zoyd-blue" />}
                          <span className={`text-[10px] font-display font-black tracking-widest uppercase ${isMe ? 'text-white' : 'text-white/70'}`}>
                            {sanitizeText(message.senderPseudo)}
                          </span>
                          <span className="text-[10px] font-mono text-white/70" title={new Date(message.timestamp).toLocaleString('fr-FR')}>{getRelativeTime(message.timestamp)}</span>
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
                  className="touch-target flex-1 min-w-0 bg-black border border-white/10 px-5 py-3.5 text-xs font-display font-bold tracking-widest text-white focus:border-zoyd-blue transition-colors"
                />
                <Button type="submit" variant="primary" disabled={!input.trim() || isSending} className="touch-target px-6" aria-label="Envoyer le message">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </>
          ) : (
            <div id="chat-main" className="flex-1 flex items-center justify-center text-white/70">
              <div className="text-center">
                <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <span className="font-mono text-[10px] uppercase font-black tracking-widest">
                  Sélectionne une discussion
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
