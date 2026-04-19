import { ScrollView, Text, View, StyleSheet, Platform } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useBotContext } from "@/lib/bot-context";

function PositionCard({ trade }: { trade: any }) {
  const isLong = trade.side === "long";
  const color = isLong ? "#00f5a0" : "#ff4060";
  const sideLabel = isLong ? "LONG" : "SHORT";
  const sideIcon = isLong ? "🟢" : "🔴";

  return (
    <View style={styles.posCard}>
      <View style={styles.posTop}>
        <View>
          <Text style={styles.posSym}>{trade.sym}</Text>
          <Text style={styles.posSub}>{trade.mkt.toUpperCase()} · AI Conf {trade.conf}%</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.posSide, { color }]}>{sideIcon} {sideLabel}</Text>
          <Text style={styles.posEntry}>Entry: {trade.entry}</Text>
        </View>
      </View>
      {trade.reasoning ? (
        <View style={styles.posReasoning}>
          <Text style={styles.posReasoningText} numberOfLines={2}>🧠 {trade.reasoning}</Text>
        </View>
      ) : null}
      <View style={styles.posBar}>
        <View style={[styles.posBarFill, { width: "30%", backgroundColor: color }]} />
      </View>
      <View style={styles.posDetails}>
        <Text style={styles.posDetailText}>SL: {trade.sl}</Text>
        <Text style={styles.posDetailText}>Qty: {trade.qty}</Text>
        <Text style={styles.posDetailText}>TP: {trade.tp}</Text>
      </View>
      {trade.key_factor ? (
        <View style={styles.keyFactor}>
          <Text style={styles.keyFactorText}>💡 {trade.key_factor}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function PositionsScreen() {
  const { state } = useBotContext();
  const trades = Object.values(state.openTrades);

  return (
    <ScreenContainer containerClassName="bg-background">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Positions</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{trades.length}</Text>
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 100, paddingTop: 12 }}>
        {trades.length > 0 ? (
          trades.map((t, i) => <PositionCard key={i} trade={t} />)
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyText}>No open positions</Text>
            <Text style={styles.emptySubtext}>Start the AI agent on the Dashboard to begin trading</Text>
          </View>
        )}
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a2d48",
    backgroundColor: "rgba(4,8,15,0.95)",
  },
  headerTitle: { fontWeight: "800", fontSize: 17, color: "#daeaf8" },
  countBadge: { backgroundColor: "rgba(255,190,48,0.1)", borderWidth: 1, borderColor: "rgba(255,190,48,0.3)", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  countText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, fontWeight: "700", color: "#ffbe30" },
  posCard: { backgroundColor: "#0d1422", borderWidth: 1, borderColor: "#1a2d48", borderRadius: 10, padding: 12, marginBottom: 8 },
  posTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  posSym: { fontWeight: "700", fontSize: 14, color: "#daeaf8" },
  posSub: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", marginTop: 2 },
  posSide: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, fontWeight: "700" },
  posEntry: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, color: "#3d5470" },
  posReasoning: { backgroundColor: "#121a2e", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, marginBottom: 8 },
  posReasoningText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", lineHeight: 12 },
  posBar: { height: 3, backgroundColor: "#121a2e", borderRadius: 2, marginVertical: 7, overflow: "hidden" },
  posBarFill: { height: "100%", borderRadius: 2 },
  posDetails: { flexDirection: "row", justifyContent: "space-between" },
  posDetailText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#3d5470" },
  keyFactor: { marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "rgba(255,190,48,0.1)", borderRadius: 4, borderLeftWidth: 2, borderLeftColor: "#ffbe30" },
  keyFactorText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#ffbe30" },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 14, color: "#3d5470", fontWeight: "700" },
  emptySubtext: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, color: "#3d5470", marginTop: 6, textAlign: "center", paddingHorizontal: 40 },
});
