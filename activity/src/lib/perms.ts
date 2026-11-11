import { activityChannelId } from "./env";
import type { GuildState } from "./types";

export interface Perms {
  /** Сидить у тому ж войсі, що й бот, — може керувати плеєром. */
  canControl: boolean;
  /** Сидить у якомусь войсі — може вмикати треки (якщо бота нема поруч — разом із «покликати»). */
  canAdd: boolean;
  /** Бота нема у войсі користувача: кнопки «грати» стають «Покликати й грати» (summon: true). */
  needsSummon: boolean;
  /** Бот вільний (ні в якому войсі), а користувач у войсі — можна просто покликати. */
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
  if (!canAdd) hint = "Зайди в голосовий канал, щоб вмикати музику";
  else if (voice && !canControl) hint = `Бот зараз у «${voice.name}» — керувати можна звідти`;
  return {
    canControl,
    canAdd,
    needsSummon: canAdd && !canControl,
    canSummon: !!you?.can_summon,
    summonChannel: activityChannelId() ?? you?.voice_channel_id ?? null,
    hint,
  };
}

/** Підпис головної кнопки «грати» з урахуванням того, де бот. */
export function playLabel(p: Perms, base = "Грати"): string {
  return p.needsSummon ? "Покликати й грати" : base;
}
