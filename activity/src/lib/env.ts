// Звідки запущено застосунок і з яким контекстом.
//
// У Discord iframe завжди має query-параметр frame_id (його читає Embedded App SDK, етап 3).
// У браузері (DEV_MODE бекенду) guild і користувача можна задати в URL: ?guild=…&user=…

const params = new URLSearchParams(window.location.search);

export const inDiscord = params.has("frame_id");

/** DEV_MODE: від імені кого діяти (інакше бекенд візьме DEV_USER_ID з .env). */
export const devUser = params.get("user");

export const urlGuild = params.get("guild");
export const urlChannel = params.get("channel");

// Войс-канал, у якому запущено Activity (у Discord його дає SDK, етап 3; у браузері — ?channel=).
let channelId: string | null = urlChannel;

export function activityChannelId(): string | null {
  return channelId;
}

export function setActivityChannelId(id: string | null): void {
  channelId = id;
}
