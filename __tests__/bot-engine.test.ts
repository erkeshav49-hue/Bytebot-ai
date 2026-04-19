import { describe, it, expect } from 'vitest';
import {
  botGetSnapshot,
  botGetConfig,
  botSetConfig,
  botStart,
  botStop,
  botClearLog,
  botResetAll,
} from '../server/bot-engine';
import { DEFAULT_CONFIG } from '../shared/bot-types';

describe('Bot Engine - Server Side', () => {
  it('botGetSnapshot returns valid snapshot shape', () => {
    const snap = botGetSnapshot();
    expect(snap).toBeDefined();
    expect(snap.status).toBe('offline');
    expect(snap.paused).toBe(false);
    expect(snap.scanCount).toBeTypeOf('number');
    expect(snap.nextScanIn).toBeTypeOf('number');
    expect(snap.openTrades).toBeTypeOf('object');
    expect(Array.isArray(snap.tradeLog)).toBe(true);
    expect(snap.aiDecisions).toBeTypeOf('object');
    expect(snap.stats).toHaveProperty('pnl');
    expect(snap.stats).toHaveProperty('trades');
    expect(snap.stats).toHaveProperty('wins');
    expect(Array.isArray(snap.newsHeadlines)).toBe(true);
    expect(snap.tickers).toBeTypeOf('object');
  });

  it('botGetSnapshot strips sensitive config keys', () => {
    const snap = botGetSnapshot();
    expect((snap.config as any).groq).toBeUndefined();
    expect((snap.config as any).key).toBeUndefined();
    expect((snap.config as any).secret).toBeUndefined();
    expect(snap.config).toHaveProperty('paper');
    expect(snap.config).toHaveProperty('testnet');
    expect(snap.config).toHaveProperty('sz');
  });

  it('botGetConfig returns full config including sensitive keys', () => {
    const cfg = botGetConfig();
    expect(cfg).toHaveProperty('groq');
    expect(cfg).toHaveProperty('key');
    expect(cfg).toHaveProperty('secret');
    expect(cfg).toHaveProperty('paper');
    expect(cfg).toHaveProperty('p');
    expect(cfg.p).toHaveProperty('bs');
  });

  it('botSetConfig updates config', () => {
    const newConfig = { ...DEFAULT_CONFIG, groq: 'test_key_123', sz: 100, mc: 80 };
    botSetConfig(newConfig);
    const cfg = botGetConfig();
    expect(cfg.groq).toBe('test_key_123');
    expect(cfg.sz).toBe(100);
    expect(cfg.mc).toBe(80);
    botSetConfig({ ...DEFAULT_CONFIG });
  });

  it('botStart returns error when no groq key', () => {
    botSetConfig({ ...DEFAULT_CONFIG, groq: '' });
    const result = botStart();
    expect(result.error).toBe('Add Groq API key in Settings');
    botSetConfig({ ...DEFAULT_CONFIG });
  });

  it('botStart returns error when live mode without API key', () => {
    botSetConfig({ ...DEFAULT_CONFIG, groq: 'gsk_test', paper: false, key: '' });
    const result = botStart();
    expect(result.error).toBe('Add Bybit API keys in Settings');
    botStop();
    botSetConfig({ ...DEFAULT_CONFIG });
  });

  it('botClearLog resets trade log and stats', () => {
    botClearLog();
    const snap = botGetSnapshot();
    expect(snap.tradeLog).toHaveLength(0);
    expect(snap.stats.pnl).toBe(0);
    expect(snap.stats.trades).toBe(0);
    expect(snap.stats.wins).toBe(0);
  });

  it('botResetAll resets everything to defaults', () => {
    botSetConfig({ ...DEFAULT_CONFIG, groq: 'test_key', sz: 999 });
    botResetAll();
    const cfg = botGetConfig();
    const snap = botGetSnapshot();
    expect(cfg.groq).toBe('');
    expect(cfg.sz).toBe(20);
    expect(snap.status).toBe('offline');
    expect(snap.scanCount).toBe(0);
    expect(Object.keys(snap.openTrades)).toHaveLength(0);
  });

  it('botStop sets status to offline', () => {
    botStop();
    const snap = botGetSnapshot();
    expect(snap.status).toBe('offline');
    expect(snap.nextScanIn).toBe(0);
  });

  it('config preserves Telegram settings for polling', () => {
    botSetConfig({ ...DEFAULT_CONFIG, tgt: 'bot123:ABC', tgc: '12345' });
    const cfg = botGetConfig();
    expect(cfg.tgt).toBe('bot123:ABC');
    expect(cfg.tgc).toBe('12345');
    botSetConfig({ ...DEFAULT_CONFIG });
  });

  it('config preserves risk preset values', () => {
    botSetConfig({ ...DEFAULT_CONFIG, sz: 50, lv: 10, tp: 0.8, sl: 0.4 });
    const cfg = botGetConfig();
    expect(cfg.sz).toBe(50);
    expect(cfg.lv).toBe(10);
    expect(cfg.tp).toBe(0.8);
    expect(cfg.sl).toBe(0.4);
    botSetConfig({ ...DEFAULT_CONFIG });
  });
});

describe('Shared Bot Types', () => {
  it('DEFAULT_CONFIG has expected shape', () => {
    expect(DEFAULT_CONFIG.paper).toBe(true);
    expect(DEFAULT_CONFIG.testnet).toBe(false);
    expect(DEFAULT_CONFIG.sz).toBe(20);
    expect(DEFAULT_CONFIG.mx).toBe(2);
    expect(DEFAULT_CONFIG.tp).toBe(0.5);
    expect(DEFAULT_CONFIG.sl).toBe(0.25);
    expect(DEFAULT_CONFIG.lv).toBe(5);
    expect(DEFAULT_CONFIG.mc).toBe(65);
    expect(DEFAULT_CONFIG.p).toEqual({ bs: true, es: true, bf: true, ef: true });
  });

  it('DEFAULT_CONFIG has empty Telegram credentials', () => {
    expect(DEFAULT_CONFIG.tgt).toBe('');
    expect(DEFAULT_CONFIG.tgc).toBe('');
  });

  it('DEFAULT_CONFIG has empty API keys', () => {
    expect(DEFAULT_CONFIG.groq).toBe('');
    expect(DEFAULT_CONFIG.key).toBe('');
    expect(DEFAULT_CONFIG.secret).toBe('');
  });
});
