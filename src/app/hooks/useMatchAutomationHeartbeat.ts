import { useEffect } from 'react';

export const useMatchAutomationHeartbeat = (enabled = true) => {
  useEffect(() => {
    if (!enabled) return;
    // Match automation now runs on the realtime backend to keep every device in sync.
  }, [enabled]);
};
