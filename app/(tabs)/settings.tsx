import { useState, useCallback, useEffect } from "react";
import { ScrollView, Text, View, TextInput, Switch, Pressable, StyleSheet, Platform, Alert, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import type { BotConfig } from "@/shared/bot-types";
import { DEFAULT_CONFIG, SUPPORTED_COINS } from "@/shared/bot-types";

const PRESETS: Record<string, { sz: number; lv: number; tp: number; sl: number }> = {
  low: { sz: 10, lv: 3, tp: 0.3, sl: 0.15 },
  med: { sz: 20, lv: 5, tp: 0.5, sl: 0.25 },
  high: { sz: 50, lv: 10, tp: 1.0, sl: 0.5 },
};

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function ToggleRow({ label, subtitle, value, onValueChange }: { label: string; subtitle?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {subtitle ? <Text style={styles.toggleSub}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onValueChange(v);
        }}
        trackColor={{ false: "#121a2e", true: "rgba(0,245,160,0.18)" }}
        thumbColor={value ? "#00f5a0" : "#3d5470"}
      />
    </View>
  );
}

function InputField({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, hint }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string; secureTextEntry?: boolean; keyboardType?: any; hint?: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#3d5470"
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export default function SettingsScreen() {
  const { data: serverConfig, isLoading } = trpc.bot.getConfig.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const setConfigMutation = trpc.bot.setConfig.useMutation();
  const testTelegramMutation = trpc.bot.testTelegram.useMutation();
  const resetMutation = trpc.bot.reset.useMutation();

  const [form, setForm] = useState<BotConfig>({ ...DEFAULT_CONFIG });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (serverConfig && !initialized) {
      setForm({ ...serverConfig });
      setInitialized(true);
    }
  }, [serverConfig, initialized]);

  const update = useCallback((key: keyof BotConfig, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const updatePairToggle = useCallback((coin: string, kind: "s" | "f", value: boolean) => {
    setForm(prev => {
      const cur = prev.p?.[coin] || { s: false, f: false };
      return { ...prev, p: { ...prev.p, [coin]: { ...cur, [kind]: value } } };
    });
  }, []);

  const [strategyText, setStrategyText] = useState("");
  const [strategyResp, setStrategyResp] = useState<string | null>(null);
  const applyStrategyMutation = trpc.bot.applyStrategy.useMutation();
  const utils = trpc.useUtils();

  const handleApplyStrategy = useCallback(async () => {
    if (!strategyText.trim()) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStrategyResp("⏳ AI is processing...");
    try {
      const res = await applyStrategyMutation.mutateAsync({ instruction: strategyText.trim() });
      setStrategyResp(res.response);
      setStrategyText("");
      // Refresh server config so UI reflects any setting changes
      const fresh = await utils.bot.getConfig.fetch();
      if (fresh) setForm({ ...fresh });
    } catch (e: any) {
      setStrategyResp("❌ Error: " + (e?.message || "unknown"));
    }
  }, [strategyText, applyStrategyMutation, utils]);

  const handleSave = useCallback(async () => {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setConfigMutation.mutate(form);
  }, [form, setConfigMutation]);

  const handlePreset = useCallback((name: string) => {
    const p = PRESETS[name];
    if (!p) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setForm(prev => ({ ...prev, sz: p.sz, lv: p.lv, tp: p.tp, sl: p.sl }));
  }, []);

  const handleTestTg = useCallback(async () => {
    if (!form.tgt || !form.tgc) return;
    testTelegramMutation.mutate({ token: form.tgt, chatId: form.tgc }, {
      onSuccess: (data) => {
        if (data.ok) {
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          if (Platform.OS === "web") alert("Sent! Check Telegram");
          else Alert.alert("Success", "Sent! Check Telegram");
        } else {
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          if (Platform.OS === "web") alert("Failed to send test message");
          else Alert.alert("Error", "Failed to send test message");
        }
      },
    });
  }, [form.tgt, form.tgc, testTelegramMutation]);

  const handleReset = useCallback(() => {
    const doReset = () => {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      resetMutation.mutate(undefined, {
        onSuccess: () => {
          setForm({ ...DEFAULT_CONFIG });
          setInitialized(false);
        },
      });
    };
    if (Platform.OS === "web") {
      if (confirm("Reset all data and settings?")) doReset();
    } else {
      Alert.alert("Reset App", "Reset all data and settings?", [
        { text: "Cancel", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: doReset },
      ]);
    }
  }, [resetMutation]);

  if (isLoading) {
    return (
      <ScreenContainer containerClassName="bg-background">
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#00f5a0" />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer containerClassName="bg-background">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.serverTag}>
          <Text style={styles.serverTagText}>SERVER-SIDE</Text>
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 120, paddingTop: 12 }}>
        {/* AI Brain */}
        <View style={styles.card}>
          <SectionTitle title="AI BRAIN" />
          <Text style={{ color: "#7892b8", fontSize: 11, marginBottom: 8 }}>AI Provider</Text>
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 14 }}>
            {(["cerebras", "groq", "deepseek"] as const).map((prov) => {
              const active = (form.aiProvider || "cerebras") === prov;
              const labels: Record<string, { name: string; sub: string }> = {
                cerebras: { name: "⚡ CEREBRAS", sub: "1M free/day" },
                groq: { name: "⚡ GROQ", sub: "500K free/day" },
                deepseek: { name: "🧠 DEEPSEEK", sub: "Paid, smart" },
              };
              return (
                <Pressable
                  key={prov}
                  onPress={() => update("aiProvider", prov)}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      paddingVertical: 10,
                      paddingHorizontal: 4,
                      borderRadius: 8,
                      backgroundColor: active ? "#1f6feb" : "#0f1a2e",
                      borderWidth: 1,
                      borderColor: active ? "#3b82f6" : "#1a2840",
                      opacity: pressed ? 0.7 : 1,
                      alignItems: "center",
                    },
                  ]}
                >
                  <Text style={{ color: active ? "#fff" : "#9bb3d4", fontWeight: "700", fontSize: 11 }}>
                    {labels[prov].name}
                  </Text>
                  <Text style={{ color: active ? "#cfe1ff" : "#5f7390", fontSize: 9, marginTop: 2 }}>
                    {labels[prov].sub}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {(form.aiProvider || "cerebras") === "groq" ? (
            <InputField
              label="Groq API Key *"
              value={form.groq}
              onChangeText={(t) => update("groq", t)}
              placeholder="gsk_xxxx"
              secureTextEntry
              hint="Free at console.groq.com — 500K tokens/day limit"
            />
          ) : (form.aiProvider || "cerebras") === "deepseek" ? (
            <InputField
              label="DeepSeek API Key *"
              value={form.deepseek || ""}
              onChangeText={(t) => update("deepseek", t)}
              placeholder="sk-xxxx"
              secureTextEntry
              hint="platform.deepseek.com/api_keys — pay-as-you-go (~$0.27/M tokens)"
            />
          ) : (
            <InputField
              label="Cerebras API Key *"
              value={form.cerebras || ""}
              onChangeText={(t) => update("cerebras", t)}
              placeholder="csk-xxxx"
              secureTextEntry
              hint="Free at cloud.cerebras.ai — 1M tokens/day, ultra-fast"
            />
          )}

          {/* Scan Interval */}
          <Text style={{ color: "#7892b8", fontSize: 11, marginTop: 14, marginBottom: 8 }}>Scan Interval</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {[
              { v: 30, l: "30s" },
              { v: 60, l: "1min" },
              { v: 120, l: "2min" },
              { v: 300, l: "5min ⭐" },
              { v: 600, l: "10min" },
            ].map((opt) => {
              const active = (form.scanInterval || 300) === opt.v;
              return (
                <Pressable
                  key={opt.v}
                  onPress={() => update("scanInterval", opt.v)}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      minWidth: 60,
                      paddingVertical: 10,
                      borderRadius: 6,
                      backgroundColor: active ? "#1f6feb" : "#0f1a2e",
                      borderWidth: 1,
                      borderColor: active ? "#3b82f6" : "#1a2840",
                      opacity: pressed ? 0.7 : 1,
                      alignItems: "center",
                    },
                  ]}
                >
                  <Text style={{ color: active ? "#fff" : "#9bb3d4", fontWeight: "700", fontSize: 12 }}>{opt.l}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: "#5f7390", fontSize: 10, marginTop: 6, lineHeight: 14 }}>
            5min recommended for free tier. Faster scans = more API calls = cost up. Restart bot after changing.
          </Text>
        </View>

        {/* Trading Mode */}
        <View style={styles.card}>
          <SectionTitle title="TRADING MODE" />
          <ToggleRow
            label="Paper Trading"
            subtitle="Simulate trades without real money"
            value={form.paper}
            onValueChange={(v) => update("paper", v)}
          />
          {!form.paper && (
            <View style={{ marginTop: 8 }}>
              <InputField
                label="Bybit API Key"
                value={form.key === "PAPER_MODE" ? "" : form.key}
                onChangeText={(t) => update("key", t)}
                placeholder="Your Bybit API key"
              />
              <InputField
                label="Bybit API Secret"
                value={form.secret === "PAPER_MODE" ? "" : form.secret}
                onChangeText={(t) => update("secret", t)}
                placeholder="Your Bybit API secret"
                secureTextEntry
              />
              <ToggleRow
                label="Testnet Mode"
                subtitle="Use Bybit testnet (no real funds)"
                value={form.testnet}
                onValueChange={(v) => update("testnet", v)}
              />
            </View>
          )}
        </View>

        {/* Telegram */}
        <View style={styles.card}>
          <SectionTitle title="TELEGRAM ALERTS" />
          <InputField
            label="Bot Token"
            value={form.tgt}
            onChangeText={(t) => update("tgt", t)}
            placeholder="From @BotFather"
          />
          <InputField
            label="Chat ID"
            value={form.tgc}
            onChangeText={(t) => update("tgc", t)}
            placeholder="From @userinfobot"
          />
          <Pressable
            onPress={handleTestTg}
            style={({ pressed }) => [styles.testBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.testBtnText}>{testTelegramMutation.isPending ? "SENDING..." : "TEST CONNECTION"}</Text>
          </Pressable>
        </View>

        {/* AI Strategy Input — natural language → settings + notes */}
        <View style={styles.card}>
          <SectionTitle title="AI STRATEGY (NATURAL LANGUAGE)" />
          <Text style={styles.fieldHint}>
            Type any instruction. AI will update settings and add strategy notes automatically.
            {"\n"}Examples: "Add SOL and XRP", "Set min confidence to 60%", "Avoid shorting in ranging markets", "Set TP 2% and SL 1%".
          </Text>
          <TextInput
            style={[styles.fieldInput, { minHeight: 70, textAlignVertical: "top", marginTop: 8 }]}
            value={strategyText}
            onChangeText={setStrategyText}
            placeholder="e.g. Add SOL spot+futures, set min confidence 60, TP 2%"
            placeholderTextColor="#3d5470"
            multiline
          />
          <Pressable
            onPress={handleApplyStrategy}
            disabled={applyStrategyMutation.isPending || !strategyText.trim()}
            style={({ pressed }) => [styles.testBtn, { marginTop: 10, opacity: !strategyText.trim() ? 0.4 : pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.testBtnText}>{applyStrategyMutation.isPending ? "PROCESSING..." : "APPLY STRATEGY"}</Text>
          </Pressable>
          {strategyResp ? (
            <View style={{ marginTop: 12, padding: 10, backgroundColor: "#0a1628", borderRadius: 8, borderLeftWidth: 3, borderLeftColor: "#00f5a0" }}>
              <Text style={{ color: "#daeaf8", fontSize: 12, lineHeight: 17 }}>{strategyResp}</Text>
            </View>
          ) : null}
        </View>

        {/* Trading Pairs — all major coins */}
        <View style={styles.card}>
          <SectionTitle title="TRADING PAIRS" />
          <Text style={styles.fieldHint}>Toggle Spot (S) and/or Futures (F) for each coin you want the bot to trade.</Text>
          <View style={{ flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#1a2d48" }}>
            <Text style={[styles.toggleLabel, { flex: 1 }]}>Coin</Text>
            <Text style={[styles.toggleSub, { width: 70, textAlign: "center", color: "#7c93b3" }]}>SPOT</Text>
            <Text style={[styles.toggleSub, { width: 70, textAlign: "center", color: "#7c93b3" }]}>FUTURES</Text>
          </View>
          {SUPPORTED_COINS.map((coin) => {
            const t = form.p?.[coin] || { s: false, f: false };
            return (
              <View key={coin} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#1a2d48" }}>
                <Text style={[styles.toggleLabel, { flex: 1 }]}>{coin}/USDT</Text>
                <View style={{ width: 70, alignItems: "center" }}>
                  <Switch
                    value={!!t.s}
                    onValueChange={(v) => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); updatePairToggle(coin, "s", v); }}
                    trackColor={{ false: "#121a2e", true: "rgba(0,245,160,0.18)" }}
                    thumbColor={t.s ? "#00f5a0" : "#3d5470"}
                  />
                </View>
                <View style={{ width: 70, alignItems: "center" }}>
                  <Switch
                    value={!!t.f}
                    onValueChange={(v) => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); updatePairToggle(coin, "f", v); }}
                    trackColor={{ false: "#121a2e", true: "rgba(0,245,160,0.18)" }}
                    thumbColor={t.f ? "#00f5a0" : "#3d5470"}
                  />
                </View>
              </View>
            );
          })}
        </View>

        {/* Risk Parameters */}
        <View style={styles.card}>
          <SectionTitle title="RISK PARAMETERS" />
          <View style={styles.presetRow}>
            {["low", "med", "high"].map((p) => (
              <Pressable
                key={p}
                onPress={() => handlePreset(p)}
                style={({ pressed }) => [styles.presetBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.presetBtnText}>{p.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.fieldRow}>
            <View style={{ flex: 1 }}>
              <InputField
                label="Order Size (USDT)"
                value={String(form.sz)}
                onChangeText={(t) => update("sz", +t || 0)}
                keyboardType="numeric"
              />
            </View>
            <View style={{ flex: 1 }}>
              <InputField
                label="Max Open Trades"
                value={String(form.mx)}
                onChangeText={(t) => update("mx", +t || 0)}
                keyboardType="numeric"
              />
            </View>
          </View>
          <View style={styles.fieldRow}>
            <View style={{ flex: 1 }}>
              <InputField
                label="Take Profit %"
                value={String(form.tp)}
                onChangeText={(t) => update("tp", +t || 0)}
                keyboardType="numeric"
              />
            </View>
            <View style={{ flex: 1 }}>
              <InputField
                label="Stop Loss %"
                value={String(form.sl)}
                onChangeText={(t) => update("sl", +t || 0)}
                keyboardType="numeric"
              />
            </View>
          </View>
          <ToggleRow
            label="🎯 Trailing Stop Loss"
            subtitle={form.trail ? `ON — SL trails ${form.trailDist || 0.5}% behind peak (TP disabled)` : "OFF — using fixed TP/SL above"}
            value={!!form.trail}
            onValueChange={(v) => update("trail", v)}
          />
          {form.trail ? (
            <InputField
              label="Trailing Distance %"
              value={String(form.trailDist ?? 0.5)}
              onChangeText={(t) => update("trailDist", +t || 0)}
              keyboardType="numeric"
              hint="SL stays this % below highest price (long) / above lowest (short). Smaller = tighter trail = exit on small dips. Larger = looser = lets profits run."
            />
          ) : null}
          <InputField
            label="Futures Leverage"
            value={String(form.lv)}
            onChangeText={(t) => update("lv", +t || 0)}
            keyboardType="numeric"
            hint="Recommended: 3-5x for small accounts"
          />
          <InputField
            label="Min AI Confidence % to trade"
            value={String(form.mc)}
            onChangeText={(t) => update("mc", +t || 0)}
            keyboardType="numeric"
            hint="Higher = fewer but more confident trades"
          />
        </View>

        {/* Save Button */}
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] }]}
        >
          <Text style={styles.saveBtnText}>{setConfigMutation.isPending ? "SAVING..." : "SAVE SETTINGS"}</Text>
        </Pressable>
        {setConfigMutation.isSuccess ? (
          <Text style={styles.savedText}>Settings saved to server</Text>
        ) : null}

        {/* Danger Zone */}
        <View style={[styles.card, { borderColor: "rgba(255,64,96,0.2)", marginTop: 10 }]}>
          <SectionTitle title="DANGER ZONE" />
          <Pressable
            onPress={handleReset}
            style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.resetBtnText}>RESET ALL DATA</Text>
          </Pressable>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a2d48",
    backgroundColor: "rgba(4,8,15,0.95)",
  },
  headerTitle: { fontWeight: "800", fontSize: 17, color: "#daeaf8" },
  serverTag: { backgroundColor: "rgba(0,245,160,0.1)", borderWidth: 1, borderColor: "rgba(0,245,160,0.3)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  serverTagText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, fontWeight: "700", color: "#00f5a0", letterSpacing: 1 },
  card: { backgroundColor: "#080d18", borderWidth: 1, borderColor: "#1a2d48", borderRadius: 12, padding: 14, marginBottom: 10 },
  sectionTitle: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, fontWeight: "700", color: "#3d5470", letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 11 },
  fieldGroup: { marginBottom: 11 },
  fieldLabel: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", letterSpacing: 2, textTransform: "uppercase", marginBottom: 5 },
  fieldInput: { width: "100%", backgroundColor: "#0d1422", borderWidth: 1, borderColor: "#1a2d48", borderRadius: 8, paddingHorizontal: 13, paddingVertical: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, color: "#daeaf8" },
  fieldHint: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 8, color: "#3d5470", marginTop: 3, lineHeight: 12 },
  fieldRow: { flexDirection: "row", gap: 8 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1a2d48" },
  toggleLabel: { fontSize: 13, fontWeight: "700", color: "#daeaf8" },
  toggleSub: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 9, color: "#3d5470", marginTop: 1 },
  presetRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  presetBtn: { flex: 1, backgroundColor: "#0d1422", borderWidth: 1, borderColor: "#1a2d48", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  presetBtnText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11, fontWeight: "700", color: "#9ab3ce", letterSpacing: 1 },
  testBtn: { backgroundColor: "rgba(61,155,255,0.1)", borderWidth: 1, borderColor: "rgba(61,155,255,0.3)", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  testBtnText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, fontWeight: "700", color: "#3d9bff", letterSpacing: 1 },
  saveBtn: { backgroundColor: "#00f5a0", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  saveBtnText: { fontSize: 16, fontWeight: "800", color: "#000", letterSpacing: 1, textTransform: "uppercase" },
  savedText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, color: "#00f5a0", textAlign: "center", marginTop: 6 },
  resetBtn: { backgroundColor: "rgba(255,64,96,0.1)", borderWidth: 1, borderColor: "rgba(255,64,96,0.3)", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  resetBtnText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 10, fontWeight: "700", color: "#ff4060", letterSpacing: 1 },
});
