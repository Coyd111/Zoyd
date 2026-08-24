import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users,
  UserPlus,
  UserCheck,
  UserX,
  MessageCircle,
  Search,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import { useFriendsStore } from '../../stores/friendsStore';
import { Button } from '../ui/Button';
import { cn } from '../../../lib/utils';
import { searchUsers } from '../../lib/usersApi';

const statusColors: Record<string, string> = {
  online: 'bg-green-500',
  offline: 'bg-white/10',
  in_match: 'bg-zoyd-yellow',
  in_lobby: 'bg-zoyd-blue',
};

const FriendsWidget: React.FC = () => {
  const {
    friends,
    requests,
    blockedIds,
    sendRequest,
    acceptRequest,
    declineRequest,
    removeFriend,
    unblockUser,
    getOnlineFriends,
  } = useFriendsStore();

  const [isOpen, setIsOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'friends' | 'requests' | 'blocked'>('friends');
  const [invitePseudo, setInvitePseudo] = useState('');

  const onlineFriends = getOnlineFriends();
  const filteredFriends = useMemo(
    () => friends.filter((friend) => friend.pseudo.toLowerCase().includes(search.toLowerCase())),
    [friends, search]
  );

  const pendingRequests = requests.filter((request) => request.status === 'pending');

  const handleInvite = async () => {
    const cleanPseudo = invitePseudo.trim();
    if (!cleanPseudo) return;
    const results = await searchUsers(cleanPseudo);
    const match = results[0];
    if (!match) return;
    await sendRequest(match.id, match.pseudo);
    setInvitePseudo('');
  };

  return (
    <div className="bg-zoyd-black border border-white/5 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Réduire le panneau amis' : 'Développer le panneau amis'}
        className="w-full flex items-center justify-between px-5 py-4 bg-zoyd-surface/20 hover:bg-zoyd-surface/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Users className="w-4 h-4 text-zoyd-yellow" />
          <span className="font-display font-black text-xs tracking-widest uppercase italic text-white">
            Amis ZOYD
          </span>
          <span className="text-[10px] font-mono font-black text-white/40 uppercase">
            {onlineFriends.length}/{friends.length} en ligne
          </span>
        </div>
        <div className="flex items-center gap-3">
          {pendingRequests.length > 0 && (
            <span className="bg-zoyd-blue text-white text-[9px] px-2 py-0.5 font-mono font-bold">
              {pendingRequests.length}
            </span>
          )}
          {isOpen ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex border-b border-white/5">
              {(['friends', 'requests', 'blocked'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  aria-label={value === 'friends' ? 'Amis' : value === 'requests' ? 'Demandes d\'amis' : 'Joueurs bloqués'}
                  className={cn(
                    'flex-1 py-2 text-[9px] font-display font-black uppercase tracking-widest italic transition-colors',
                    tab === value ? 'bg-white text-black' : 'text-white/30 hover:text-white/60'
                  )}
                >
                  {value === 'friends' && 'Amis'}
                  {value === 'requests' && `Demandes ${pendingRequests.length > 0 ? `(${pendingRequests.length})` : ''}`}
                  {value === 'blocked' && 'Bloques'}
                </button>
              ))}
            </div>

            <div className="p-3 border-b border-white/5">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={tab === 'friends' ? search : invitePseudo}
                    onChange={(event) => (tab === 'friends' ? setSearch(event.target.value) : setInvitePseudo(event.target.value))}
                    placeholder={tab === 'friends' ? 'Rechercher un ami...' : 'Pseudo a ajouter...'}
                    aria-label={tab === 'friends' ? 'Rechercher un ami' : 'Saisir un pseudo à ajouter'}
                    className="w-full bg-black border border-white/10 pl-8 pr-3 py-2 text-[11px] font-display font-bold tracking-wider text-white focus:outline-none focus:border-zoyd-yellow transition-colors"
                  />
                </div>
                {tab === 'requests' && (
                  <Button variant="primary" size="sm" onClick={handleInvite} className="px-3" aria-label="Ajouter un ami">
                    <UserPlus className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto custom-scrollbar">
              {tab === 'friends' && (
                <div className="divide-y divide-white/5">
                  {filteredFriends.length === 0 && (
                    <div className="p-4 text-center text-[10px] font-mono text-white/40 uppercase">
                      Aucun ami trouve
                    </div>
                  )}
                  {filteredFriends.map((friend) => (
                    <div key={friend.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors group">
                      <div className="relative">
                        <div className="w-8 h-8 border border-white/10 flex items-center justify-center font-display font-black text-white text-[10px]">
                          {friend.pseudo.slice(0, 2).toUpperCase()}
                        </div>
                        <div className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 border border-zoyd-black rounded-full', statusColors[friend.status])} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-black text-xs text-white uppercase italic truncate">
                          {friend.pseudo}
                        </div>
                        <div className="text-[9px] font-mono text-white/40 uppercase">
                          {friend.status === 'online'
                            ? 'En ligne'
                            : friend.status === 'in_match'
                              ? 'En match'
                              : friend.status === 'in_lobby'
                                ? 'En lobby'
                                : 'Hors ligne'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="p-1.5 text-white/40 hover:text-zoyd-blue transition-colors" title="Message" aria-label={`Envoyer un message à ${friend.pseudo}`}>
                          <MessageCircle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removeFriend(friend.id)}
                          className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                          title="Supprimer"
                          aria-label={`Supprimer ${friend.pseudo} des amis`}
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'requests' && (
                <div className="divide-y divide-white/5">
                  {pendingRequests.length === 0 && (
                    <div className="p-4 text-center text-[10px] font-mono text-white/40 uppercase">
                      Aucune demande en attente
                    </div>
                  )}
                  {pendingRequests.map((request) => (
                    <div key={request.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 border border-white/10 flex items-center justify-center font-display font-black text-white text-[10px]">
                        {request.senderPseudo.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-black text-xs text-white uppercase italic truncate">
                          {request.senderPseudo}
                        </div>
                        <div className="text-[9px] font-mono text-white/40 uppercase">
                          Demande d'ami
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => acceptRequest(request.id)}
                          className="p-1.5 text-green-400 hover:text-green-300 transition-colors"
                          title="Accepter"
                          aria-label={`Accepter la demande de ${request.senderPseudo}`}
                        >
                          <UserCheck className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => declineRequest(request.id)}
                          className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                          title="Refuser"
                          aria-label={`Refuser la demande de ${request.senderPseudo}`}
                        >
                          <UserX className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'blocked' && (
                <div className="divide-y divide-white/5">
                  {blockedIds.length === 0 && (
                    <div className="p-4 text-center text-[10px] font-mono text-white/40 uppercase">
                      Aucun joueur bloque
                    </div>
                  )}
                  {blockedIds.map((blockedId) => (
                    <div key={blockedId} className="flex items-center gap-3 px-4 py-3">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-black text-xs text-white uppercase italic truncate">
                          {blockedId}
                        </div>
                        <div className="text-[9px] font-mono text-white/40 uppercase">
                          Blocage actif
                        </div>
                      </div>
                      <button
                        onClick={() => unblockUser(blockedId)}
                        className="text-[9px] font-mono text-white/30 hover:text-white uppercase"
                        aria-label={`Débloquer ${blockedId}`}
                      >
                        Debloquer
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FriendsWidget;
