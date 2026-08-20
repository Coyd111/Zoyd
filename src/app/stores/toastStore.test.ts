import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useToastStore, cleanupToastTimers } from './toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    cleanupToastTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should add a toast with generated id', () => {
    useToastStore.getState().addToast({ type: 'success', title: 'OK', duration: 0 });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].title).toBe('OK');
    expect(toasts[0].id).toMatch(/^TOAST-/);
  });

  it('should auto-remove toast after duration', () => {
    useToastStore.getState().addToast({ type: 'info', title: 'Temp', duration: 1000 });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1001);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('should not auto-remove toast with duration 0', () => {
    useToastStore.getState().addToast({ type: 'info', title: 'Perm', duration: 0 });
    vi.advanceTimersByTime(5000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('should remove a specific toast', () => {
    useToastStore.getState().addToast({ type: 'error', title: 'A', duration: 0 });
    useToastStore.getState().addToast({ type: 'error', title: 'B', duration: 0 });
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].title).toBe('B');
  });

  it('should clear all toasts', () => {
    useToastStore.getState().addToast({ type: 'success', title: 'X', duration: 0 });
    useToastStore.getState().addToast({ type: 'error', title: 'Y', duration: 0 });
    useToastStore.getState().clearAll();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
