// Дзеркало JSON із webapi/state.py.

export type LoopMode = "off" | "track" | "queue";

export interface UserRef {
  id: string;
  name: string | null;
  avatar: string | null;
}

export interface Track {
  id: string;
  /** Унікальний ключ елемента черги (той самий трек може стояти двічі). У результатах пошуку теж є. */
  key: string;
  title: string;
  channel: string | null;
  duration: number | null;
  is_live: boolean;
  url: string;
  thumbnail: string;
  thumbnail_small: string;
  requester: UserRef | null;
}

export interface PlayerState {
  current: Track | null;
  /** Трек вибрано, але звук ще не пішов (витягуємо стрім / YouTube тримає «передрол»). */
  preparing: boolean;
  paused: boolean;
  position: number;
  volume: number;
  loop: LoopMode;
  queue: Track[];
  queue_total: number;
  queue_duration: number;
  color: string;
  last_action: string | null;
  can_seek: boolean;
}

export interface You {
  id: string;
  name: string;
  avatar: string | null;
  voice_channel_id: string | null;
  can_control: boolean;
  can_summon: boolean;
}

export interface GuildState {
  type: "state";
  server_time: number;
  guild: { id: string; name: string; icon: string | null };
  voice_channel: { id: string; name: string; listeners: number } | null;
  player: PlayerState | null;
  you: You;
}

export interface PositionMessage {
  type: "position";
  track_id: string;
  position: number;
  paused: boolean;
  server_time: number;
}

export interface ErrorMessage {
  type: "error";
  status: number;
  error: string;
}

export type ServerMessage = GuildState | PositionMessage | ErrorMessage | { type: "pong" };

export interface DevGuild {
  id: string;
  name: string;
  icon: string | null;
  member_count: number | null;
  voice_channel: string | null;
  you_are_member: boolean;
}

export type PlayMode = "queue" | "next" | "now";
