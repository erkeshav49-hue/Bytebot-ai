import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BotConfig {
  groq: string;
  paper: boolean;
  key: string;
  secret: string;
  testnet: boolean;
  tgt: string;   // Telegram bot token
  tgc: string;   // Telegram chat ID
  sz: number;    // order size USDT
  mx: number;    // max open trades
  tp: number;    // take profit %
  sl: number;    // stop loss %
  lv: number;    // leverage
  mc: number;    // min confidence %
  p: {           // pairs
    bs: boolean; // BTC spot
    es: boolean; // ETH spot
    bf: boolean; // BTC futures
    ef: boolean; // ETH futures
  };
}

export interface OpenTrade {
  sym: string;
  mkt: string;
  cat: string;
  side: 'long' | 'short';
  entry: number;
  qty: number;
  tp: number;
  sl: number;
  time: number;
  conf: number;
  reasoning: string;
  key_factor: string;
  regime: string;
  paper?: boolean;
}

export interface TradeLog {
  time: string;
  sym: string;
  mkt: string;
  side: 'long' | 'short';
  entry: number;
  exit: number;
  pnl: string;
  reason: string;
  conf: number;
  reasoning: string;
}

export interface AIDecision {
  sym: string;
  mkt: string;
  thinking: boolean;
  action?: 'long' | 'short' | 'wait';
  confidence?: number;
  reasoning?: string;
  key_factor?: string;
  risk_level?: string;
  market_regime?: string;
  warnings?: string[];
  time?: string;
  price?: number;
}

export interface BotStats {
  pnl: number;
  trades: number;
  wins: number;
}

export type BotStatus = 'offline' | 'running' | 'thinking';

export interface BotState {
  config: BotConfig;
  setupDone: boolean;
  status: BotStatus;
  paused: boolean;
  scanCount: number;
  nextScanIn: number;
  openTrades: Record<string, OpenTrade>;
  tradeLog: TradeLog[];
  aiDecisions: Record<string, AIDecision>;
  stats: BotStats;
  newsHeadlines: string[];
  tickers: Record<string, { last: number; chg: number; vol: number } | null>;
}

// ─── Default Config ───────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: BotConfig = {
  groq: '',
  paper: true,
  key: '',
  secret: '',
  testnet: false,
  tgt: '',
  tgc: '',
  sz: 20,
  mx: 2,
  tp: 0.5,
  sl: 0.25,
  lv: 5,
  mc: 65,
  p: { bs: true, es: true, bf: true, ef: true },
};

const INITIAL_STATE: BotState = {
  config: DEFAULT_CONFIG,
  setupDone: false,
  status: 'offline',
  paused: false,
  scanCount: 0,
  nextScanIn: 0,
  openTrades: {},
  tradeLog: [],
  aiDecisions: {},
  stats: { pnl: 0, trades: 0, wins: 0 },
  newsHeadlines: [],
  tickers: {},
};

// ─── Actions ─────────────────────────────────────────────────────────────────

type Action =
  | { type: 'LOAD_STATE'; payload: Partial<BotState> }
  | { type: 'SET_CONFIG'; payload: BotConfig }
  | { type: 'SET_SETUP_DONE'; payload: boolean }
  | { type: 'SET_STATUS'; payload: BotStatus }
  | { type: 'SET_PAUSED'; payload: boolean }
  | { type: 'INCREMENT_SCAN' }
  | { type: 'SET_NEXT_SCAN'; payload: number }
  | { type: 'SET_AI_DECISION'; key: string; payload: AIDecision }
  | { type: 'CLEAR_AI_DECISIONS' }
  | { type: 'ADD_OPEN_TRADE'; key: string; payload: OpenTrade }
  | { type: 'REMOVE_OPEN_TRADE'; key: string }
  | { type: 'ADD_TRADE_LOG'; payload: TradeLog }
  | { type: 'CLEAR_TRADE_LOG' }
  | { type: 'UPDATE_STATS'; pnl: number; win: boolean }
  | { type: 'SET_NEWS'; payload: string[] }
  | { type: 'SET_TICKER'; key: string; payload: { last: number; chg: number; vol: number } | null };

function reducer(state: BotState, action: Action): BotState {
  switch (action.type) {
    case 'LOAD_STATE':
      return { ...state, ...action.payload };
    case 'SET_CONFIG':
      return { ...state, config: action.payload };
    case 'SET_SETUP_DONE':
      return { ...state, setupDone: action.payload };
    case 'SET_STATUS':
      return { ...state, status: action.payload };
    case 'SET_PAUSED':
      return { ...state, paused: action.payload };
    case 'INCREMENT_SCAN':
      return { ...state, scanCount: state.scanCount + 1 };
    case 'SET_NEXT_SCAN':
      return { ...state, nextScanIn: action.payload };
    case 'SET_AI_DECISION':
      return { ...state, aiDecisions: { ...state.aiDecisions, [action.key]: action.payload } };
    case 'CLEAR_AI_DECISIONS':
      return { ...state, aiDecisions: {} };
    case 'ADD_OPEN_TRADE':
      return { ...state, openTrades: { ...state.openTrades, [action.key]: action.payload } };
    case 'REMOVE_OPEN_TRADE': {
      const next = { ...state.openTrades };
      delete next[action.key];
      return { ...state, openTrades: next };
    }
    case 'ADD_TRADE_LOG':
      return { ...state, tradeLog: [action.payload, ...state.tradeLog].slice(0, 200) };
    case 'CLEAR_TRADE_LOG':
      return { ...state, tradeLog: [] };
    case 'UPDATE_STATS':
      return {
        ...state,
        stats: {
          pnl: state.stats.pnl + action.pnl,
          trades: state.stats.trades + 1,
          wins: state.stats.wins + (action.win ? 1 : 0),
        },
      };
    case 'SET_NEWS':
      return { ...state, newsHeadlines: action.payload };
    case 'SET_TICKER':
      return { ...state, tickers: { ...state.tickers, [action.key]: action.payload } };
    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface BotContextValue {
  state: BotState;
  dispatch: React.Dispatch<Action>;
  saveConfig: (config: BotConfig) => Promise<void>;
  completeSetup: (config: BotConfig) => Promise<void>;
}

const BotContext = createContext<BotContextValue | null>(null);

const STORAGE_KEY_CONFIG = 'bbg5_config';
const STORAGE_KEY_LOG = 'bbg5_log';
const STORAGE_KEY_STATS = 'bbg5_stats';
const STORAGE_KEY_SETUP = 'bbg5_setup';

export function BotProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Load persisted state on mount
  useEffect(() => {
    (async () => {
      try {
        const [configStr, logStr, statsStr, setupStr] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_CONFIG),
          AsyncStorage.getItem(STORAGE_KEY_LOG),
          AsyncStorage.getItem(STORAGE_KEY_STATS),
          AsyncStorage.getItem(STORAGE_KEY_SETUP),
        ]);
        const payload: Partial<BotState> = {};
        if (configStr) payload.config = { ...DEFAULT_CONFIG, ...JSON.parse(configStr) };
        if (logStr) payload.tradeLog = JSON.parse(logStr);
        if (statsStr) payload.stats = JSON.parse(statsStr);
        if (setupStr) payload.setupDone = JSON.parse(setupStr);
        dispatch({ type: 'LOAD_STATE', payload });
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  const saveConfig = useCallback(async (config: BotConfig) => {
    dispatch({ type: 'SET_CONFIG', payload: config });
    await AsyncStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
  }, []);

  const completeSetup = useCallback(async (config: BotConfig) => {
    dispatch({ type: 'SET_CONFIG', payload: config });
    dispatch({ type: 'SET_SETUP_DONE', payload: true });
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config)),
      AsyncStorage.setItem(STORAGE_KEY_SETUP, JSON.stringify(true)),
    ]);
  }, []);

  return (
    <BotContext.Provider value={{ state, dispatch, saveConfig, completeSetup }}>
      {children}
    </BotContext.Provider>
  );
}

export function useBotContext() {
  const ctx = useContext(BotContext);
  if (!ctx) throw new Error('useBotContext must be used within BotProvider');
  return ctx;
}
