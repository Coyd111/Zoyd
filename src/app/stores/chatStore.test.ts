import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore, type ChatChannelDef, type ChatMessage } from './chatStore';

const makeChannel = (id = 'ch1', overrides: Partial<ChatChannelDef> = {}): ChatChannelDef => ({
  id,
  type: 'global',
  name: 'Global',
  participants: ['user1'],
  unreadCount: 0,
  isMuted: false,
  ...overrides,
});

const makeMessage = (id: string, channelId = 'ch1', senderId = 'user1'): ChatMessage => ({
  id,
  channelId,
  channelType: 'global',
  senderId,
  senderPseudo: 'Test',
  text: `Message ${id}`,
  timestamp: new Date().toISOString(),
});

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({ channels: [], messages: [], activeChannelId: null });
  });

  it('should replace from server', () => {
    const channels = [makeChannel('ch1'), makeChannel('ch2')];
    const messages = [makeMessage('m1', 'ch1'), makeMessage('m2', 'ch2')];
    useChatStore.getState().replaceFromServer(channels, messages);
    expect(useChatStore.getState().channels).toHaveLength(2);
    expect(useChatStore.getState().messages).toHaveLength(2);
  });

  it('should set active channel', () => {
    useChatStore.getState().setActiveChannel('ch1');
    expect(useChatStore.getState().activeChannelId).toBe('ch1');
  });

  it('should receive a message and increment unread when channel not active', () => {
    useChatStore.getState().replaceFromServer([makeChannel('ch1')], []);
    useChatStore.getState().setActiveChannel('ch2');
    const msg = makeMessage('m1', 'ch1', 'other-user');
    useChatStore.getState().receiveServerMessage(msg, 'user1');
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().channels.find(c => c.id === 'ch1')?.unreadCount).toBe(1);
  });

  it('should not increment unread for own messages', () => {
    useChatStore.getState().replaceFromServer([makeChannel('ch1')], []);
    const msg = makeMessage('m1', 'ch1', 'user1');
    useChatStore.getState().receiveServerMessage(msg, 'user1');
    expect(useChatStore.getState().channels[0].unreadCount).toBe(0);
  });

  it('should send a message', () => {
    useChatStore.getState().replaceFromServer([makeChannel('ch1')], []);
    useChatStore.getState().sendMessage('ch1', 'Hello', 'user1', 'Test');
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].text).toBe('Hello');
  });

  it('should mute and unmute channel', () => {
    useChatStore.getState().replaceFromServer([makeChannel('ch1')], []);
    useChatStore.getState().muteChannel('ch1');
    expect(useChatStore.getState().channels[0].isMuted).toBe(true);
    useChatStore.getState().unmuteChannel('ch1');
    expect(useChatStore.getState().channels[0].isMuted).toBe(false);
  });

  it('should get messages for channel', () => {
    useChatStore.getState().replaceFromServer(
      [makeChannel('ch1'), makeChannel('ch2')],
      [makeMessage('m1', 'ch1'), makeMessage('m2', 'ch2'), makeMessage('m3', 'ch1')]
    );
    expect(useChatStore.getState().getMessagesForChannel('ch1')).toHaveLength(2);
    expect(useChatStore.getState().getMessagesForChannel('ch2')).toHaveLength(1);
  });

  it('should compute unread total', () => {
    useChatStore.getState().replaceFromServer(
      [makeChannel('ch1', { unreadCount: 3 }), makeChannel('ch2', { unreadCount: 2 })],
      []
    );
    expect(useChatStore.getState().getUnreadTotal()).toBe(5);
  });

  it('should create a channel', () => {
    const id = useChatStore.getState().createChannel('private', 'Test Channel', ['user1']);
    expect(useChatStore.getState().channels).toHaveLength(1);
    expect(useChatStore.getState().channels[0].name).toBe('Test Channel');
    expect(id).toMatch(/^CH-/);
  });
});
