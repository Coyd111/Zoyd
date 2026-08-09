import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('./supabase.mjs', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
    })),
  },
}));

// Import after mocking
import * as persistence from './persistence.mjs';

describe('persistence - Password Hashing', () => {
  it('should hash password with salt', async () => {
    const password = 'TestPassword123';
    const hash = await persistence.hashPassword(password);
    
    expect(hash).toContain(':');
    const [salt, digest] = hash.split(':');
    expect(salt).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(digest).toHaveLength(128); // 64 bytes = 128 hex chars
  });

  it('should generate different hashes for same password', async () => {
    const password = 'TestPassword123';
    const hash1 = await persistence.hashPassword(password);
    const hash2 = await persistence.hashPassword(password);
    
    expect(hash1).not.toBe(hash2);
  });

  it('should verify correct password', async () => {
    const password = 'TestPassword123';
    const hash = await persistence.hashPassword(password);
    
    expect(await persistence.verifyPassword(password, hash)).toBe(true);
  });

  it('should reject incorrect password', async () => {
    const password = 'TestPassword123';
    const hash = await persistence.hashPassword(password);
    
    expect(await persistence.verifyPassword('WrongPassword', hash)).toBe(false);
  });

  it('should handle invalid hash format', async () => {
    expect(await persistence.verifyPassword('test', 'invalid')).toBe(false);
    expect(await persistence.verifyPassword('test', '')).toBe(false);
    expect(await persistence.verifyPassword('test', null)).toBe(false);
  });
});

describe('persistence - Normalization Functions', () => {
  it('should normalize pseudo key', () => {
    expect(persistence.normalizePseudoKey('  TestUser  ')).toBe('testuser');
    expect(persistence.normalizePseudoKey('TESTUSER')).toBe('testuser');
    expect(persistence.normalizePseudoKey('Test User')).toBe('test user');
  });

  it('should normalize email key', () => {
    expect(persistence.normalizeEmailKey('  Test@Example.COM  ')).toBe('test@example.com');
    expect(persistence.normalizeEmailKey('TEST@EXAMPLE.COM')).toBe('test@example.com');
  });

  it('should normalize phone key', () => {
    expect(persistence.normalizePhoneKey('+229 60 00 00 00')).toBe('22960000000');
    expect(persistence.normalizePhoneKey('229-60-00-00-00')).toBe('22960000000');
    expect(persistence.normalizePhoneKey(' (229) 60 00 00 00 ')).toBe('22960000000');
  });

  it('should normalize game ID key', () => {
    expect(persistence.normalizeGameIdKey('  674292618  ')).toBe('674292618');
    expect(persistence.normalizeGameIdKey('674292618')).toBe('674292618');
  });

  it('should normalize chat participants', () => {
    const participants = ['user1', 'user2', 'user1', '', '  user3  '];
    const result = persistence.normalizeChatParticipants(participants);
    
    expect(result).toEqual(['user1', 'user2', 'user3']);
  });

  it('should handle empty or null participants', () => {
    expect(persistence.normalizeChatParticipants([])).toEqual([]);
    expect(persistence.normalizeChatParticipants(null)).toEqual([]);
    expect(persistence.normalizeChatParticipants(undefined)).toEqual([]);
  });
});

describe('persistence - Wallet Normalization', () => {
  it('should normalize wallet snapshot with default values', () => {
    const wallet = persistence.normalizeWalletSnapshot(null);
    
    expect(wallet.cashBalance).toBe(0);
    expect(wallet.bonusBalance).toBe(0);
    expect(wallet.lockedBalance).toBe(0);
    expect(wallet.pendingWinnings).toBe(0);
    expect(wallet.lockedEntries).toEqual({});
    expect(wallet.transactions).toEqual([]);
  });

  it('should normalize wallet snapshot with provided values', () => {
    const input = {
      cashBalance: 100.123,
      bonusBalance: 50.456,
      lockedBalance: 25.789,
      pendingWinnings: 10,
      lockedEntries: { match1: { amount: 10 } },
      transactions: [{ id: 'tx1', amount: 50 }],
    };
    const wallet = persistence.normalizeWalletSnapshot(input);
    
    expect(wallet.cashBalance).toBe(100.12);
    expect(wallet.bonusBalance).toBe(50.46);
    expect(wallet.lockedBalance).toBe(25.79);
    expect(wallet.pendingWinnings).toBe(10);
    expect(wallet.lockedEntries).toEqual({ match1: { amount: 10 } });
    expect(wallet.transactions).toEqual([{ id: 'tx1', amount: 50 }]);
  });

  it('should handle invalid lockedEntries', () => {
    const wallet = persistence.normalizeWalletSnapshot({ lockedEntries: 'invalid' });
    expect(wallet.lockedEntries).toEqual({});
  });

  it('should handle invalid transactions', () => {
    const wallet = persistence.normalizeWalletSnapshot({ transactions: 'invalid' });
    expect(wallet.transactions).toEqual([]);
  });
});

describe('persistence - User Payload Sanitization', () => {
  it('should sanitize user payload with defaults', () => {
    const input = {
      id: 'user1',
      pseudo: 'TestUser',
      email: 'test@example.com',
      phone: '+22960000000',
      gameId: '674292618',
    };
    const user = persistence.sanitizeUserPayload(input);
    
    expect(user.id).toBe('user1');
    expect(user.walletBalance).toBe(0);
    expect(user.trustScore).toBe(0);
    expect(user.levelCODM).toBe(1);
    expect(user.isOnline).toBe(false);
    expect(user.lastSeen).toBeDefined();
  });

  it('should calculate wallet balance correctly', () => {
    const input = {
      id: 'user1',
      pseudo: 'TestUser',
      email: 'test@example.com',
      phone: '+22960000000',
      gameId: '674292618',
      wallet: {
        cashBalance: 100,
        bonusBalance: 50,
        lockedBalance: 25,
        pendingWinnings: 10,
      },
    };
    const user = persistence.sanitizeUserPayload(input);
    
    expect(user.walletBalance).toBe(150);
  });

  it('should return null for null input', () => {
    expect(persistence.sanitizeUserPayload(null)).toBe(null);
  });
});

describe('persistence - Chat Channel Normalization', () => {
  it('should normalize chat channel with defaults', () => {
    const channel = persistence.normalizeChatChannelPayload({});
    
    expect(channel.id).toBe('');
    expect(channel.type).toBe('private');
    expect(channel.name).toBe('Canal ZOYD');
    expect(channel.participants).toEqual([]);
    expect(channel.unreadCount).toBe(0);
    expect(channel.isMuted).toBe(false);
    expect(channel.scope).toBe('participants');
    expect(channel.inbox).toBe('participants');
  });

  it('should normalize chat channel with provided values', () => {
    const input = {
      id: 'channel1',
      type: 'public',
      name: 'Test Channel',
      participants: ['user1', 'user2'],
      unreadCount: 5,
      isMuted: true,
      scope: 'public',
      inbox: 'all',
    };
    const channel = persistence.normalizeChatChannelPayload(input);
    
    expect(channel.id).toBe('channel1');
    expect(channel.type).toBe('public');
    expect(channel.name).toBe('Test Channel');
    expect(channel.participants).toEqual(['user1', 'user2']);
    expect(channel.unreadCount).toBe(5);
    expect(channel.isMuted).toBe(true);
    expect(channel.scope).toBe('public');
    expect(channel.inbox).toBe('all');
  });
});

describe('persistence - Chat Message Normalization', () => {
  it('should normalize chat message with defaults', () => {
    const message = persistence.normalizeChatMessagePayload({});
    
    expect(message.id).toBe('');
    expect(message.channelId).toBe('');
    expect(message.channelType).toBe('private');
    expect(message.senderId).toBe('');
    expect(message.senderPseudo).toBe('ZOYD');
    expect(message.text).toBe('');
    expect(message.isSystem).toBe(false);
    expect(message.isDeleted).toBe(false);
  });

  it('should normalize chat message with provided values', () => {
    const input = {
      id: 'msg1',
      channelId: 'channel1',
      channelType: 'public',
      senderId: 'user1',
      senderPseudo: 'TestUser',
      text: 'Hello world',
      isSystem: true,
      isDeleted: true,
    };
    const message = persistence.normalizeChatMessagePayload(input);
    
    expect(message.id).toBe('msg1');
    expect(message.channelId).toBe('channel1');
    expect(message.channelType).toBe('public');
    expect(message.senderId).toBe('user1');
    expect(message.senderPseudo).toBe('TestUser');
    expect(message.text).toBe('Hello world');
    expect(message.isSystem).toBe(true);
    expect(message.isDeleted).toBe(true);
  });
});

describe('persistence - Error Creation', () => {
  it('should create error with code', () => {
    const error = persistence.makeError('TEST_CODE', 'Test message');
    
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Test message');
    expect(error.code).toBe('TEST_CODE');
  });
});

describe('persistence - Round Amount', () => {
  it('should round amounts correctly', () => {
    expect(persistence.roundAmount(10.123)).toBe(10.12);
    expect(persistence.roundAmount(10.125)).toBe(10.13);
    expect(persistence.roundAmount(10.127)).toBe(10.13);
    expect(persistence.roundAmount(0)).toBe(0);
    expect(persistence.roundAmount(null)).toBe(0);
    expect(persistence.roundAmount(undefined)).toBe(0);
    expect(persistence.roundAmount('100.456')).toBe(100.46);
  });
});

describe('persistence - User Payload Building', () => {
  it('should build user payload with defaults', () => {
    const input = {
      id: 'user1',
      pseudo: 'TestUser',
      email: 'test@example.com',
      phone: '+22960000000',
      gameId: '674292618',
    };
    const payload = persistence.buildUserPayload(input);
    
    expect(payload.id).toBe('user1');
    expect(payload.role).toBe('player');
    expect(payload.pseudo).toBe('TestUser');
    expect(payload.email).toBe('test@example.com');
    expect(payload.phone).toBe('+22960000000');
    expect(payload.gameId).toBe('674292618');
    expect(payload.controllerType).toBe('touch');
    expect(payload.device).toBe('phone');
    expect(payload.levelCODM).toBe(1);
    expect(payload.rankMJ).toBe('Bronze');
    expect(payload.rankBR).toBe('Bronze');
    expect(payload.country).toBe('Benin');
    expect(payload.trustScore).toBe(100);
    expect(payload.streamerMode).toBe(false);
    expect(payload.isOnline).toBe(false);
  });

  it('should build user payload with custom values', () => {
    const input = {
      id: 'user1',
      pseudo: 'TestUser',
      email: 'test@example.com',
      phone: '+22960000000',
      gameId: '674292618',
      controllerType: 'controller',
      device: 'pc',
      levelCODM: 150,
      rankMJ: 'Master',
      rankBR: 'Legendary',
      country: 'Senegal',
      trustScore: 85,
      streamerMode: true,
      streamerPseudo: 'TestStreamer',
      role: 'arbiter',
    };
    const payload = persistence.buildUserPayload(input, 'arbiter');
    
    expect(payload.role).toBe('arbiter');
    expect(payload.controllerType).toBe('controller');
    expect(payload.device).toBe('pc');
    expect(payload.levelCODM).toBe(150);
    expect(payload.rankMJ).toBe('Master');
    expect(payload.rankBR).toBe('Legendary');
    expect(payload.country).toBe('Senegal');
    expect(payload.trustScore).toBe(85);
    expect(payload.streamerMode).toBe(true);
    expect(payload.streamerPseudo).toBe('TestStreamer');
  });

  it('should trim whitespace from fields', () => {
    const input = {
      id: 'user1',
      pseudo: '  TestUser  ',
      email: '  test@example.com  ',
      phone: '  +22960000000  ',
      gameId: '  674292618  ',
    };
    const payload = persistence.buildUserPayload(input);
    
    expect(payload.pseudo).toBe('TestUser');
    expect(payload.email).toBe('test@example.com');
    expect(payload.phone).toBe('+22960000000');
    expect(payload.gameId).toBe('674292618');
  });
});
