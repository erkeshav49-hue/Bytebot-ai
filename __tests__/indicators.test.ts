import { describe, it, expect } from 'vitest';
import { emaArr, calcRSI, calcMACD, calcADX, calcBB, buildIndicators, Candle } from '../lib/indicators';

describe('emaArr', () => {
  it('returns array of same length as input', () => {
    const data = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const result = emaArr(data, 3);
    expect(result.length).toBe(data.length);
  });

  it('first value equals first input value', () => {
    const data = [100, 105, 110, 108, 112];
    const result = emaArr(data, 5);
    expect(result[0]).toBe(100);
  });
});

describe('calcRSI', () => {
  it('returns 50 for insufficient data', () => {
    expect(calcRSI([10, 11], 14)).toBe(50);
  });

  it('returns value between 0 and 100 for valid data', () => {
    const data = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
    const rsi = calcRSI(data, 14);
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });

  it('returns high RSI for consistently rising prices', () => {
    const data = Array.from({ length: 30 }, (_, i) => 100 + i);
    const rsi = calcRSI(data, 14);
    expect(rsi).toBeGreaterThan(70);
  });
});

describe('calcMACD', () => {
  it('returns flat for insufficient data', () => {
    const result = calcMACD([10, 11, 12]);
    expect(result.sig).toBe('flat');
  });

  it('returns valid structure for sufficient data', () => {
    const data = Array.from({ length: 50 }, (_, i) => 100 + i * 0.5);
    const result = calcMACD(data);
    expect(result).toHaveProperty('h');
    expect(result).toHaveProperty('sig');
  });
});

describe('calcADX', () => {
  it('returns zeros for insufficient data', () => {
    const result = calcADX([10], [9], [9.5]);
    expect(result.adx).toBe('0');
  });
});

describe('calcBB', () => {
  it('returns valid structure for sufficient data', () => {
    const data = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 3);
    const result = calcBB(data);
    expect(parseFloat(result.u)).toBeGreaterThan(parseFloat(result.lo));
    expect(typeof result.squeeze).toBe('boolean');
  });
});

describe('buildIndicators', () => {
  it('builds full indicator set from candle data', () => {
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => ({
      o: 100 + i * 0.3,
      h: 101 + i * 0.3,
      l: 99 + i * 0.3,
      c: 100.5 + i * 0.3,
      v: 1000 + i * 10,
    }));
    const result = buildIndicators(candles);
    expect(result).toHaveProperty('ema');
    expect(result).toHaveProperty('rsi');
    expect(result).toHaveProperty('macd');
    expect(result).toHaveProperty('adx');
    expect(result).toHaveProperty('bb');
    expect(result).toHaveProperty('atr_pct');
    expect(result).toHaveProperty('volume_ratio');
    expect(result).toHaveProperty('last_5_closes');
    expect(result.last_5_closes.length).toBe(5);
    expect(result.ema.status).toBeDefined();
    expect(parseFloat(result.rsi.value)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(result.rsi.value)).toBeLessThanOrEqual(100);
  });
});
