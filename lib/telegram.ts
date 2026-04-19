export async function tgSend(token: string, chatId: string, msg: string): Promise<void> {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
    });
  } catch (e) {
    // silent fail
  }
}

export async function tgTestConnection(token: string, chatId: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ <b>ByteBot AI connected!</b>\n🤖 Brain: Groq AI (llama-3.3-70b) FREE\n\nSend /help for all commands 👇',
        parse_mode: 'HTML',
      }),
    });
    const d = await r.json();
    return d.ok === true;
  } catch (e) {
    return false;
  }
}
