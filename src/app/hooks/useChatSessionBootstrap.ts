import { useEffect, useRef } from 'react';
import { fetchChatBootstrap } from '../lib/chatApi';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';

export const useChatSessionBootstrap = () => {
  const sessionToken = useAuthStore((state) => state.sessionToken);
  const replaceFromServer = useChatStore((state) => state.replaceFromServer);
  const hydratedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      hydratedTokenRef.current = null;
      replaceFromServer([], []);
      return;
    }

    if (hydratedTokenRef.current === sessionToken) {
      return;
    }

    let cancelled = false;

    fetchChatBootstrap()
      .then((payload) => {
        if (cancelled) return;
        replaceFromServer(payload.channels, payload.messages);
        hydratedTokenRef.current = sessionToken;
      })
      .catch(() => {
        if (!cancelled) {
          hydratedTokenRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [replaceFromServer, sessionToken]);
};
