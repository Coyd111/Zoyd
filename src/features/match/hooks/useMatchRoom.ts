import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../../app/stores/authStore';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderPseudo: string;
  text: string;
  timestamp: string;
  isSystem?: boolean;
}

export const useMatchRoom = (matchId: string) => {
  const { user } = useAuthStore();
  const safeUser = user || { id: 'u1', pseudo: 'ShadowX' };

  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Simulate connecting to the match room
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    
    // Fake connection delay
    timeout = setTimeout(() => {
      setIsConnected(true);
      setMessages([
        {
          id: 'sys1',
          senderId: 'system',
          senderPseudo: 'ZOYD Arbiter',
          text: 'Bienvenue dans le salon du match. Soyez fair-play.',
          timestamp: new Date().toISOString(),
          isSystem: true,
        }
      ]);
    }, 800);

    return () => clearTimeout(timeout);
  }, [matchId]);

  // Simulate opponent becoming ready
  useEffect(() => {
    if (isConnected) {
      const timeout = setTimeout(() => {
        setOpponentReady(true);
        setMessages(prev => [...prev, {
          id: `sys-${Date.now()}`,
          senderId: 'system',
          senderPseudo: 'System',
          text: "Ton adversaire est prêt.",
          timestamp: new Date().toISOString(),
          isSystem: true,
        }]);
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [isConnected]);

  // Check if both are ready to start countdown
  useEffect(() => {
    if (isReady && opponentReady) {
      setCountdown(10); // Start 10s countdown
    }
  }, [isReady, opponentReady]);

  // Handle countdown logic
  useEffect(() => {
    if (countdown === null) return;
    
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      // Match starts
      setMessages(prev => [...prev, {
        id: `sys-${Date.now()}`,
        senderId: 'system',
        senderPseudo: 'ZOYD Arbiter',
        text: "LE MATCH COMMENCE ! Bonne chance.",
        timestamp: new Date().toISOString(),
        isSystem: true,
      }]);
    }
  }, [countdown]);

  const sendMessage = useCallback((text: string) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      senderId: safeUser.id,
      senderPseudo: safeUser.pseudo,
      text,
      timestamp: new Date().toISOString(),
    };
    
    setMessages(prev => [...prev, newMessage]);
    
    // Simulate opponent replying sometimes
    if (text.toLowerCase().includes('gl') || text.toLowerCase().includes('hf')) {
      setTimeout(() => {
        setMessages(prev => [...prev, {
          id: Date.now().toString() + 'opp',
          senderId: 'opp1',
          senderPseudo: 'PhoenixX', // Mock opponent
          text: 'GL HF!',
          timestamp: new Date().toISOString(),
        }]);
      }, 2000);
    }
  }, [safeUser]);

  const toggleReady = useCallback(() => {
    setIsReady(prev => !prev);
  }, []);

  return {
    isConnected,
    messages,
    isReady,
    opponentReady,
    sendMessage,
    toggleReady,
    countdown
  };
};
