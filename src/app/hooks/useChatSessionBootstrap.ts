import { useEffect, useRef } from 'react';
import { fetchChatBootstrap } from '../lib/chatApi';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';

export const useChatSessionBootstrap = () => {
  const userId = useAuthStore((state) => state.user?.id);
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      hydratedRef.current = null;
      useChatStore.getState().replaceFromServer([], []);
      return;
    }

    if (hydratedRef.current === userId) {
      return;
    }

    let cancelled = false;

    fetchChatBootstrap()
      .then((payload) => {
        if (cancelled) return;
        useChatStore.getState().replaceFromServer(payload.channels, payload.messages);
        hydratedRef.current = userId;
      })
      .catch(() => {
        if (!cancelled) {
          hydratedRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);
};
