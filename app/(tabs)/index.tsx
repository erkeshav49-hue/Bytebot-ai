import { useCallback } from "react";
import { ScrollView, Text, View, Pressable, StyleSheet, Platform, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function StatusDot({ status }: { status: string }) {
  const color = status === "running" ? "#00f5a0" : status === "thinking" ? "#a855f7" : "#3d5470";
  return (
    <View style={[styles.dot, { backgroundColor: color, shadowColor: color, shadowOpacity: status !== "offline" ? 0.8 : 0, shadowRadius: 4 }]} />
  );
}

function ModeBadge({ config }: { config: any }) {
  const label = config.paper ? "PAPER" : config.testnet ? "TESTNET" : "LIVE";
  const bg = config.paper ? "rgba(0,245,160,0.1)" : config.testnet ? "rgba(255,190,48,0.1)" : "rgba(255,64,96,0.1)";
  const color = config.paper ? "#00f5a0" : config.testnet ? "#ffbe30" : "#ff4060";
  const border = config.paper ? "rgba(0,245,160,0.3)" : config.testnet ? "rgba(255,190,48,0.25)" : "rgba(255,64,96,0.25)";
  return (
    <View style={[styles.modeBadge, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.modeBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

function StatBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function TickerRow({ sym, label, ticker }: { sym: string; label: string; ticker: { last: number; chg: number; vol: number } | null }) {
  if (!ticker) return null;
  const chg = ticker.chg >= 0 ? `+${(ticker.chg * 100).toFixed(2)}%` : `${(ticker.chg * 100).toFixed(2)}%`;
  const color = ticker.chg >= 0 ? "#00f5a0" : "#ff4060";
  return (
    <View style={styles.tickerRow}>
      <View>
        <Text style={styles.tickerSym}>{sym}</Text>
        <Text style={styles.tickerLabel}>{label}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[styles.tickerPrice, { color }]}>{ticker.last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
        <Text style={[styles.tickerChg, { color }]}>{chg}</Text>
      </View>
    </View>
  );
}

function AIDecisionCard({ d }: { d: any }) {
  if (d.thinking) {
    return (
      <View style={[styles.aiCard, { borderColor: "rgba(168,85,247,0.3)" }]}>
        <View style={styles.aiTop}>
          <View>
            <Text style={styles.aiSym}>{d.sym}</Text>
            <Text style={styles.aiSub}>[{d.mkt?.toUpperCase()}] Contacting Groq AI...</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: "rgba(168,85,247,0.1)", borderColor: "rgba(168,85,247,0.3)" }]}>
            <Text style={[styles.badgeText, { color: "#a855f7" }]}>THINKING</Text>
          </View>
        </View>
        <View style={styles.reasoning}>
          <Text style={[styles.reasoningText, { color: "#a855f7" }]}>Groq AI is reading price data, indicators, news and trade history...</Text>
        </View>
      </View>
    );
  }

  const isLong = d.action === "long";
  const isShort = d.action === "short";
  const borderColor = isLong ? "rgba(0,245,160,0.3)" : isShort ? "rgba(255,64,96,0.3)" : "#1a2d48";
  const actionText = isLong ? "LONG" : isShort ? "SHORT" : "WAIT";
  const actionBg = isLong ? "rgba(0,245,160,0.1)" : isShort ? "rgba(255,64,96,0.1)" : "rgba(13,20,34,1)";
  const actionBorder = isLong ? "rgba(0,245,160,0.3)" : isShort ? "rgba(255,64,96,0.3)" : "#1a2d48";
  const actionColor = isLong ? "#00f5a0" : isShort ? "#ff4060" : "#3d5470";
  const confColor = (d.confidence || 0) >= 70 ? "#00f5a0" : (d.confidence || 0) >= 50 ? "#ffbe30" : "#ff4060";

  return (
    <View style={[styles.aiCard, { borderColor }]}>
      <View style={styles.aiTop}>
        <View>
          <Text style={styles.aiSym}>{d.sym} <Text style={styles.aiMkt}>[{d.mkt}]</Text></Text>
          <Text style={styles.aiSub}>{d.time} · ${d.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <View style={[styles.badge, { backgroundColor: actionBg, borderColor: actionBorder }]}>
            <Text style={[styles.badgeText, { color: actionColor }]}>{actionText}</Text>
          </View>
          <Text style={[styles.confPercent, { color: confColor }]}>{d.confidence}%</Text>
        </View>
      </View>
      <View style={styles.confRow}>
        <Text style={styles.confLabel}>Confidence</Text>
        <View style={styles.confTrack}>
          <View style={[styles.confFill, { width: `${d.confidence || 0}%`, backgroundColor: confColor }]} />
        </View>
        <Text style={[styles.confPct, { color: confColor }]}>{d.confidence}%</Text>
      </View>
      <View style={styles.pills}>
        <View style={styles.pill}><Text style={styles.pillText}>Risk: {(d.risk_level || "?").toUpperCase()}</Text></View>
        <View style={styles.pill}><Text style={styles.pillText}>{(d.market_regime || "?").replace(/_/g, " ")}</Text></View>
      </View>
      <View style={styles.reasoning}>
        <Text style={styles.reasoningLabel}>Groq AI Reasoning</Text>
        <Text style={styles.reasoningText}>{d.reasoning || "—"}</Text>
        {d.key_factor ? <View style={styles.keyFactor}><Text style={styles.keyFactorText}>{d.key_factor}</Text></View> : null}
        {d.warnings?.[0] ? <Text style={styles.warnText}>{d.warnings[0]}</Text> : null}
      </View>
    </View>
  );
}

function NewsItem({ headline }: { headline: string }) {
  return (
    <View style={styles.newsItem}>
      <View style={styles.newsDot} />
      <Text style={styles.newsText}>{headline}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  // Poll server snapshot every 3 seconds
  const { data: snapshot, isLoading } = trpc.bot.snapshot.useQuery(undefined, {
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  const startMutation = trpc.bot.start.useMutation();
  const stopMutation = trpc.bot.stop.useMutation();

  const handleToggle = useCallback(() => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!snapshot || snapshot.status === "offline") {
      startMutation.mutate();
    } else {
      stopMutation.mutate();
    }
  }, [snapshot, startMutation, stopMutation]);

  if (isLoading || !snapshot) {
    return (
      <ScreenContainer containerClassName="bg-background">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#00f5a0" />
          <Text style={{ color: "#3d5470", marginTop: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10 }}>Connecting to server...</Text>
        </View>
      </ScreenContainer>
    );
  }

  const { config, status, stats, scanCount, nextScanIn, tickers, newsHeadlines, aiDecisions, strategy } = snapshot;
  const pnl = stats.pnl;
  const pnlStr = (pnl >= 0 ? "+$" : "-$") + Math.abs(pnl).toFixed(2);
  const pnlColor = pnl >= 0 ? "#00f5a0" : "#ff4060";
  const wr = stats.trades ? ((stats.wins / stats.trades) * 100).toFixed(0) + "%" : "—";
  const openCount = Object.keys(snapshot.openTrades).length;
  const statusLabel = status === "running" ? "RUNNING" : status === "thinking" ? "THINKING" : "OFFLINE";
  const aiKeys = Object.keys(aiDecisions);
  const isRunning = status !== "offline";

  return (
    <ScreenContainer containerClassName="bg-background">
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={styles.logo}>Byte<Text style={{ color: "#00f5a0" }}>Bot</Text></Text>
          <View style={styles.logoTag}><Text style={styles.logoTagText}>AI v5</Text></View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <ModeBadge config={config} />
          <View style={styles.statusPill}>
            <StatusDot status={status} />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 100, paddingTop: 12 }}>
        {/* Server-side badge */}
        <View style={styles.serverBadge}>
          <Text style={styles.serverBadgeText}>SERVER-SIDE 24/7 — bot runs even when app is closed</Text>
        </View>

        {/* Stats Grid */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PERFORMANCE</Text>
          <View style={styles.statsGrid}>
            <StatBox label="TOTAL P&L" value={pnlStr} sub={`${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`} color={pnlColor} />
            <StatBox label="TRADES" value={String(stats.trades)} sub={`Win: ${wr}`} />
            <StatBox label="OPEN" value={String(openCount)} sub="positions" color="#ffbe30" />
            <StatBox label="AI SCANS" value={String(scanCount)} sub={isRunning ? `Next: ${nextScanIn}s` : "—"} color="#a855f7" />
          </View>
        </View>

        {/* Start/Stop Button */}
        <View style={styles.startHero}>
          <Pressable
            onPress={handleToggle}
            style={({ pressed }) => [
              !isRunning ? styles.btnStart : styles.btnStop,
              pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] },
            ]}
          >
            <Text style={!isRunning ? styles.btnStartText : styles.btnStopText}>
              {!isRunning ? "▶  START AI AGENT" : "⏹  STOP AI AGENT"}
            </Text>
          </Pressable>
          <Text style={styles.startStatus}>
            {!isRunning ? "Agent stopped. Press START to begin." : status === "thinking" ? "Groq AI is analysing markets..." : "Scanning markets every 45s (server-side)..."}
          </Text>
          {startMutation.error ? (
            <Text style={styles.errorText}>{startMutation.error.message}</Text>
          ) : null}
        </View>

        {/* Live Prices */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>LIVE PRICES</Text>
          <TickerRow sym="BTC/USDT" label="BTC Spot" ticker={tickers["spot_BTC"]} />
          <TickerRow sym="ETH/USDT" label="ETH Spot" ticker={tickers["spot_ETH"]} />
          <TickerRow sym="BTC/USDT" label="BTC Perp" ticker={tickers["linear_BTC"]} />
          <TickerRow sym="ETH/USDT" label="ETH Perp" ticker={tickers["linear_ETH"]} />
          {!tickers["spot_BTC"] && !tickers["spot_ETH"] && (
            <Text style={styles.emptyText}>Loading prices...</Text>
          )}
        </View>

        {/* Crypto News */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>CRYPTO NEWS (AI reads this)</Text>
          {newsHeadlines.length > 0 ? newsHeadlines.map((h, i) => <NewsItem key={i} headline={h} />) : (
            <Text style={styles.emptyText}>Fetching news...</Text>
          )}
        </View>

        {/* Strategy Memory */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>STRATEGY MEMORY</Text>
          {strategy && (strategy.notes?.length > 0 || strategy.learnings?.length > 0) ? (
            <View>
              {strategy.notes?.length > 0 && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={styles.stratLabel}>ACTIVE RULES ({strategy.notes.length})</Text>
                  {strategy.notes.slice(0, 5).map((n: any) => (
                    <View key={n.id} style={styles.stratNote}>
                      <Text style={styles.stratIcon}>{n.type === 'user' ? '👤' : '🤖'}</Text>
                      <Text style={styles.stratText}>{n.text}</Text>
                    </View>
                  ))}
                </View>
              )}
              {strategy.learnings?.length > 0 && (
                <View>
                  <Text style={styles.stratLabel}>LEARNED PATTERNS ({strategy.learnings.length})</Text>
                  {strategy.learnings.slice(0, 3).map((l: any, i: number) => (
                    <View key={i} style={styles.stratLearning}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={[styles.stratText, { fontWeight: '600', flex: 1 }]}>{l.pattern}</Text>
                        <Text style={[styles.stratWr, { color: l.outcome === 'winning' ? '#00f5a0' : '#ff4060' }]}>{l.winRate?.toFixed(0)}% WR</Text>
                      </View>
                      <Text style={styles.stratRec}>{l.recommendation}</Text>
                    </View>
                  ))}
                </View>
              )}
              {strategy.totalAnalyses > 0 && (
                <Text style={styles.stratMeta}>Self-analyses: {strategy.totalAnalyses} | Last: {strategy.lastAnalysisTime ? new Date(strategy.lastAnalysisTime).toLocaleTimeString() : '—'}</Text>
              )}
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 14 }}>
              <Text style={{ fontSize: 24, marginBottom: 6 }}>🧠</Text>
              <Text style={styles.emptyText}>No strategy notes yet</Text>
              <Text style={[styles.emptyText, { marginTop: 2 }]}>Send /strategy {"<"}instruction{">"}  in Telegram to teach the AI</Text>
            </View>
          )}
        </View>

        {/* Telegram Commands */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>TELEGRAM COMMANDS</Text>
          <View style={styles.tgCmdBlock}>
            <Text style={styles.tgCmdGroup}>Info</Text>
            <Text style={styles.tgCmdText}>/status  /positions  /trades  /balance</Text>
            <Text style={styles.tgCmdText}>/ask {"<"}question{">"}</Text>
            <Text style={styles.tgCmdGroup}>Control</Text>
            <Text style={styles.tgCmdText}>/startbot  /stopbot  /pause  /resume</Text>
            <Text style={[styles.tgCmdGroup, { color: "#a855f7" }]}>Strategy</Text>
            <Text style={styles.tgCmdText}>/strategy {"<"}instruction{">"}  — teach a rule</Text>
            <Text style={styles.tgCmdText}>/notes  /insights  /analyze  /forget</Text>
            <Text style={styles.tgCmdGroup}>Settings</Text>
            <Text style={styles.tgCmdText}>/size  /tp  /sl  /leverage  /confidence</Text>
            <Text style={styles.tgCmdText}>/risk low|med|high  /settings</Text>
            <Text style={[styles.tgCmdGroup, { color: "#a855f7" }]}>AI Chat</Text>
            <Text style={styles.tgCmdText}>Just type any message and I'll respond!</Text>
          </View>
        </View>

        {/* AI Decisions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>GROQ AI DECISIONS</Text>
          {aiKeys.length > 0 ? aiKeys.map(k => <AIDecisionCard key={k} d={aiDecisions[k]} />) : (
            <View style={{ alignItems: "center", paddingVertical: 20 }}>
              <Text style={{ fontSize: 28, marginBottom: 8 }}>🤖</Text>
              <Text style={styles.emptyText}>Press START — Groq AI will analyse each pair and explain every decision</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1a2d48",
    backgroundColor: "rgba(4,8,15,0.95)",
  },
  logo: { fontWeight: "800", fontSize: 17, color: "#daeaf8" },
  logoTag: { backgroundColor: "rgba(0,245,160,0.1)", borderWidth: 1, borderColor: "rgba(0,245,160,0.3)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, marginLeft: 6 },
  logoTagText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#00f5a0", letterSpacing: 1 },
  modeBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 3, borderWidth: 1 },
  modeBadgeText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, letterSpacing: 1, fontWeight: "700" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#0d1422", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: "#1a2d48" },
  statusText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#9ab3ce" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  serverBadge: { backgroundColor: "rgba(0,245,160,0.06)", borderWidth: 1, borderColor: "rgba(0,245,160,0.2)", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 10, alignItems: "center" },
  serverBadgeText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#00f5a0", letterSpacing: 0.5, fontWeight: "600" },
  card: { backgroundColor: "#080d18", borderWidth: 1, borderColor: "#1a2d48", borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTitle: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, fontWeight: "700", color: "#3d5470", letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 11 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statBox: { flex: 1, minWidth: "45%", backgroundColor: "#0d1422", borderWidth: 1, borderColor: "#1a2d48", borderRadius: 10, padding: 11 },
  statLabel: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 7, color: "#3d5470", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 },
  statValue: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 19, fontWeight: "700", color: "#daeaf8" },
  statSub: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", marginTop: 2 },
  startHero: { backgroundColor: "rgba(0,245,160,0.04)", borderWidth: 1, borderColor: "rgba(0,245,160,0.15)", borderRadius: 14, padding: 16, marginBottom: 10, alignItems: "center" },
  btnStart: { width: "100%", paddingVertical: 16, borderRadius: 10, backgroundColor: "#00f5a0", alignItems: "center" },
  btnStartText: { fontSize: 18, fontWeight: "800", color: "#000", letterSpacing: 1, textTransform: "uppercase" },
  btnStop: { width: "100%", paddingVertical: 16, borderRadius: 10, backgroundColor: "#ff4060", alignItems: "center" },
  btnStopText: { fontSize: 18, fontWeight: "800", color: "#fff", letterSpacing: 1, textTransform: "uppercase" },
  startStatus: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, color: "#3d5470", marginTop: 10, textAlign: "center" },
  errorText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, color: "#ff4060", marginTop: 6 },
  tickerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#1a2d48" },
  tickerSym: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontWeight: "700", fontSize: 13, color: "#daeaf8" },
  tickerLabel: { fontSize: 9, color: "#3d5470" },
  tickerPrice: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 15, fontWeight: "600" },
  tickerChg: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10 },
  newsItem: { flexDirection: "row", gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#1a2d48" },
  newsDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#3d9bff", marginTop: 4 },
  newsText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#9ab3ce", lineHeight: 14, flex: 1 },
  aiCard: { borderRadius: 10, padding: 13, marginBottom: 8, borderWidth: 1, backgroundColor: "#0d1422" },
  aiTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  aiSym: { fontWeight: "700", fontSize: 14, color: "#daeaf8" },
  aiMkt: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#3d5470" },
  aiSub: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", marginTop: 2 },
  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  badgeText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  confPercent: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11, fontWeight: "700", marginTop: 4 },
  confRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 7 },
  confLabel: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", width: 52 },
  confTrack: { flex: 1, height: 5, backgroundColor: "#121a2e", borderRadius: 3, overflow: "hidden" },
  confFill: { height: "100%", borderRadius: 3 },
  confPct: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, fontWeight: "700", width: 30, textAlign: "right" },
  pills: { flexDirection: "row", gap: 4, flexWrap: "wrap", marginBottom: 8 },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, backgroundColor: "#121a2e", borderWidth: 1, borderColor: "#1a2d48" },
  pillText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470" },
  reasoning: { backgroundColor: "#121a2e", borderRadius: 7, padding: 9, marginTop: 4 },
  reasoningLabel: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 7, color: "#3d5470", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 },
  reasoningText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#9ab3ce", lineHeight: 15 },
  keyFactor: { marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "rgba(255,190,48,0.1)", borderRadius: 4, borderLeftWidth: 2, borderLeftColor: "#ffbe30" },
  keyFactorText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#ffbe30" },
  warnText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#ff4060", marginTop: 4 },
  emptyText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, color: "#3d5470", textAlign: "center", paddingVertical: 12 },
  tgCmdBlock: { paddingVertical: 4 },
  tgCmdGroup: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#00f5a0", fontWeight: "700", marginTop: 6, marginBottom: 2 },
  tgCmdText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#9ab3ce", lineHeight: 16 },
  stratLabel: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 7, color: "#3d5470", letterSpacing: 2, textTransform: "uppercase" as const, marginBottom: 6 },
  stratNote: { flexDirection: "row" as const, gap: 6, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#1a2d48" },
  stratIcon: { fontSize: 12, width: 20 },
  stratText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#9ab3ce", lineHeight: 14, flex: 1 },
  stratLearning: { backgroundColor: "#121a2e", borderRadius: 7, padding: 9, marginBottom: 6 },
  stratWr: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, fontWeight: "700" as const },
  stratRec: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", lineHeight: 13 },
  stratMeta: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", marginTop: 8, textAlign: "center" as const },
});
