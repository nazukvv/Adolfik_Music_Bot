import { api, setSession } from "./api";
import { setActivityChannelId } from "./env";

// Запуск усередині Discord (Embedded App SDK):
//   ready() → authorize (OAuth2-код, scope identify) → POST /api/token (бекенд обмінює код на access_token
//   через DISCORD_CLIENT_SECRET і видає свою сесію) → authenticate(access_token).
// guild_id і channel_id беремо з SDK: Activity завжди запущена в конкретному голосовому каналі.

const READY_TIMEOUT = 15_000;

export interface DiscordContext {
  guildId: string;
  channelId: string | null;
  user: { id: string; name: string; avatar: string | null };
}

/** Помилка, яку варто показати користувачу як є. */
export class DiscordStartError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new DiscordStartError(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function connectDiscord(onStep: (text: string) => void): Promise<DiscordContext> {
  onStep("Підключаюсь до Discord…");
  const config = await api.config();
  if (!config.client_id) throw new DiscordStartError("Сервер бота не повідомив client_id застосунку.");

  // Динамічний імпорт: у браузерному DEV-режимі SDK не потрібен і не вантажиться.
  const { DiscordSDK } = await import("@discord/embedded-app-sdk");
  let sdk: InstanceType<typeof DiscordSDK>;
  try {
    sdk = new DiscordSDK(config.client_id);
  } catch (err) {
    throw new DiscordStartError(`Discord SDK не запустився: ${err instanceof Error ? err.message : String(err)}`);
  }
  await withTimeout(sdk.ready(), READY_TIMEOUT, "Discord не відповідає. Закрий Activity і відкрий її ще раз.");

  if (!sdk.guildId) {
    throw new DiscordStartError("Activity працює лише на сервері — запусти її з голосового каналу.");
  }

  onStep("Чекаю дозволу Discord…");
  let code: string;
  try {
    ({ code } = await sdk.commands.authorize({
      client_id: config.client_id,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify"],
    }));
  } catch {
    throw new DiscordStartError("Потрібен дозвіл Discord (лише твоє ім'я та аватар), щоб керувати музикою.");
  }

  onStep("Входжу…");
  const token = await api.token(code);
  const auth = await sdk.commands.authenticate({ access_token: token.access_token });
  if (!auth) throw new DiscordStartError("Discord не підтвердив вхід. Спробуй ще раз.");

  setSession(token.session);
  setActivityChannelId(sdk.channelId);
  return { guildId: sdk.guildId, channelId: sdk.channelId, user: token.user };
}
