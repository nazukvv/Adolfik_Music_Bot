import { inDiscord } from "./env";

// Усередині Discord усі запити йдуть через проксі {client_id}.discordsays.com, а зовнішні домени
// блокує CSP. Для зображень у Developer Portal потрібні URL mappings (етап 3):
//   /ytimg -> i.ytimg.com            (обкладинки YouTube)
//   /dcdn  -> cdn.discordapp.com     (аватари Discord)
const MAPPINGS: Array<[from: string, to: string]> = [
  ["https://i.ytimg.com/", "/ytimg/"],
  ["https://cdn.discordapp.com/", "/dcdn/"],
];

/** URL зображення, що працює і в браузері, і всередині Discord. */
export function media(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!inDiscord) return url;
  for (const [from, to] of MAPPINGS) {
    if (url.startsWith(from)) return to + url.slice(from.length);
  }
  return url;
}
