import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "bytebot_server_url";

export async function getStoredServerUrl(): Promise<string> {
  try {
    const val = await AsyncStorage.getItem(KEY);
    return val?.trim() || "";
  } catch {
    return "";
  }
}

export async function saveServerUrl(url: string): Promise<void> {
  const cleaned = url.trim().replace(/\/$/, "");
  await AsyncStorage.setItem(KEY, cleaned);
}

export async function clearServerUrl(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
