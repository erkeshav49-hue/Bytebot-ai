# ByteBot Strategy Reference

User provided a detailed strategy document recommending:
- Supertrend (10,3) on 5m + 1H alignment
- EMA(50), RSI(14), ADX(14)>20 filters
- 1.5 ATR stop, 3.0 ATR target (1:2 R:R)
- Post-only limit orders, 3x leverage
- 1% per-trade risk, 3% daily loss cap, 15% drawdown kill-switch
- Session filter: skip 22:00-02:00 UTC weekdays
- Primary: ETHUSDT perp, Secondary: BTCUSDT perp

This is reference material. The app already implements the Groq AI-based analysis from the HTML file.
The strategy insights can inform the AI prompts and risk parameters.
