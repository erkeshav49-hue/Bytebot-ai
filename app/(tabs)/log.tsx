import { useCallback } from "react";
import { ScrollView, Text, View, Pressable, StyleSheet, Platform, Alert, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";

function LogItem({ trade }: { trade: any }) {
  const pnl = +trade.pnl;
  const color = pnl >= 0 ? "#00f5a0" : "#ff4060";
  const isLong = trade.side === "long";
  const sideBg = isLong ? "rgba(0,245,160,0.1)" : "rgba(255,64,96,0.1)";
  const sideColor = isLong ? "#00f5a0" : "#ff4060";

  return (
    <View style={styles.logItem}>
      <View style={styles.logTop}>
        <View style={[styles.sideBadge, { backgroundColor: sideBg }]}>
          <Text style={[styles.sideBadgeText, { color: sideColor }]}>{trade.side.toUpperCase()}</Text>
        </View>
        <Text style={styles.logSym}>{trade.sym}</Text>
        <Text style={styles.logMkt}>{trade.mkt}{trade.conf ? ` · ${trade.conf}%` : ""}</Text>
      </View>
      {trade.reasoning ? (
        <Text style={styles.logReasoning} numberOfLines={2}>🧠 {trade.reasoning}</Text>
      ) : null}
      <View style={styles.logBottom}>
        <Text style={styles.logTime}>{trade.time} · {trade.reason}</Text>
        <Text style={[styles.logPnl, { color }]}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(3)} USDT</Text>
      </View>
    </View>
  );
}

export default function LogScreen() {
  const { data: snapshot, isLoading } = trpc.bot.snapshot.useQuery(undefined, {
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const clearLogMutation = trpc.bot.clearLog.useMutation();

  const handleClear = useCallback(() => {
    const doIt = () => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      clearLogMutation.mutate();
    };
    if (Platform.OS === "web") {
      if (confirm("Clear all trade history?")) doIt();
    } else {
      Alert.alert("Clear Log", "Clear all trade history?", [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: doIt },
      ]);
    }
  }, [clearLogMutation]);

  if (isLoading || !snapshot) {
    return (
      <ScreenContainer containerClassName="bg-background">
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Trade Log</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#00f5a0" />
        </View>
      </ScreenContainer>
    );
  }

  const { tradeLog, stats } = snapshot;
  const pnl = stats.pnl;
  const pnlStr = (pnl >= 0 ? "+" : "") + pnl.toFixed(2) + " USDT";
  const pnlColor = pnl >= 0 ? "#00f5a0" : "#ff4060";
  const wr = stats.trades ? ((stats.wins / stats.trades) * 100).toFixed(0) + "%" : "—";

  return (
    <ScreenContainer containerClassName="bg-background">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Trade Log</Text>
        {tradeLog.length > 0 ? (
          <Pressable
            onPress={handleClear}
            style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.clearBtnText}>CLEAR</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 100, paddingTop: 12 }}>
        {/* Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>TOTAL P&L</Text>
              <Text style={[styles.summaryValue, { color: pnlColor }]}>{pnlStr}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>TRADES</Text>
              <Text style={styles.summaryValue}>{stats.trades}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>WIN RATE</Text>
              <Text style={styles.summaryValue}>{wr}</Text>
            </View>
          </View>
        </View>

        {/* Trade List */}
        {tradeLog.length > 0 ? (
          tradeLog.map((t, i) => <LogItem key={i} trade={t} />)
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>No trades yet</Text>
            <Text style={styles.emptySubtext}>Completed trades will appear here with P&L details</Text>
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
  clearBtn: { backgroundColor: "rgba(255,64,96,0.1)", borderWidth: 1, borderColor: "rgba(255,64,96,0.3)", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  clearBtnText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, fontWeight: "700", color: "#ff4060", letterSpacing: 1 },
  summaryCard: { backgroundColor: "#080d18", borderWidth: 1, borderColor: "#1a2d48", borderRadius: 12, padding: 14, marginBottom: 10 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryItem: { alignItems: "center", flex: 1 },
  summaryLabel: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 7, color: "#3d5470", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 },
  summaryValue: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 14, fontWeight: "700", color: "#daeaf8" },
  logItem: { backgroundColor: "#0d1422", borderWidth: 1, borderColor: "#1a2d48", borderRadius: 8, padding: 10, marginBottom: 6 },
  logTop: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  sideBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 3 },
  sideBadgeText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontWeight: "700", fontSize: 9 },
  logSym: { color: "#daeaf8", fontWeight: "700", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12 },
  logMkt: { color: "#3d5470", fontSize: 8, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  logReasoning: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", lineHeight: 12, marginBottom: 4 },
  logBottom: { flexDirection: "row", justifyContent: "space-between" },
  logTime: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: "#3d5470", fontSize: 8 },
  logPnl: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontWeight: "700", fontSize: 11 },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 14, color: "#3d5470", fontWeight: "700" },
  emptySubtext: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, color: "#3d5470", marginTop: 6, textAlign: "center", paddingHorizontal: 40 },
});
