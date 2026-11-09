import { activityChannelId } from "./env";
import type { GuildState } from "./types";

export interface Perms {
  /** Сидить у тому ж войсі, що й бот, — може керувати. */
  canControl: boolean;
  /** Сидить у якомусь войсі — може додавати треки (бот прийде або вже там). */
  canAdd: boolean;
  /** Бот не у войсі, а користувач у войсі — може покликати. */
  canSummon: boolean;
  /** Куди кликати бота: канал, де запущено Activity, або той, де зараз користувач. */
  summonChannel: string | null;
  /** Підказка, чому кнопки неактивні. */
  hint: string | null;
}

export function perms(state: GuildState | null): Perms {
  const you = state?.you;
  const voice = state?.voice_channel;
  const canControl = !!you?.can_control;
  const canAdd = !!you?.voice_channel_id;
  let hint: string | null = null;
  if (!canAdd) hint = "Зайди в голосовий канал, щоб керувати музикою";
  else if (voice && !canControl) hint = `Керувати можна з каналу «${voice.name}», де зараз бот`;
  return {
    canControl,
    canAdd,
    canSummon: !!you?.can_summon,
    summonChannel: activityChannelId() ?? you?.voice_channel_id ?? null,
    hint,
  };
}
