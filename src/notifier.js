'use strict';

const config = require('./config');

// Soyut bildirim arayüzü. İleride e-posta/SMS eklenince her biri
// { name, send(text) } sözleşmesini uygular ve listeye katılır.

class ConsoleNotifier {
  constructor() {
    this.name = 'console';
  }
  async send(text) {
    console.log(`[notify] ${text}`);
  }
}

class TelegramNotifier {
  constructor(token, chatId) {
    this.name = 'telegram';
    this.token = token;
    this.chatId = chatId;
  }
  async send(text) {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text }),
      });
      if (!res.ok) {
        console.error(`[notify:telegram] HTTP ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      console.error(`[notify:telegram] gönderim hatası: ${err.message}`);
    }
  }
}

// Aktif kanalları topla ve hepsine paralel gönder.
function buildNotifier() {
  const channels = [new ConsoleNotifier()];
  if (config.telegramBotToken && config.telegramChatId) {
    channels.push(new TelegramNotifier(config.telegramBotToken, config.telegramChatId));
  } else {
    console.warn('[notify] Telegram yapılandırılmadı; yalnızca konsol bildirimi aktif.');
  }

  return {
    channels: channels.map((c) => c.name),
    async send(text) {
      await Promise.allSettled(channels.map((c) => c.send(text)));
    },
  };
}

module.exports = { buildNotifier };
