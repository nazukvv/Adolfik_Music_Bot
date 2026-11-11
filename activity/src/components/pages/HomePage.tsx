import { Disc3, Headphones, History, ListMusic, Pause, Play, Radio, Search } from "lucide-react";
import { useState } from "react";
import { control, playLikes, playPlaylist, summon } from "../../lib/actions";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useLoad } from "../../lib/hooks";
import { useLibrary } from "../../lib/library";
import type { Perms } from "../../lib/perms";
import { router } from "../../lib/router";
import type { GuildState, HistoryTrack } from "../../lib/types";
import { Pill } from "../ui/Buttons";
import { Avatar } from "../ui/Bits";
import { Hero, SectionTitle, Tabs } from "../ui/Hero";
import { TableEmpty, TrackTable } from "../ui/TrackTable";
import { PlaylistGrid } from "./Cards";

type HomeTab = "server" | "mine";

/** Головна: що грає на сервері, мої плейлисти, нещодавні треки сервера і «продовжити слухати». */
export function HomePage({ state, perms, onOpenQueue }: { state: GuildState; perms: Perms; onOpenQueue: () => void }) {
  const lib = useLibrary();
  const [tab, setTab] = useState<HomeTab>("server");
  const currentKey = state.player?.current?.key ?? null;
  // Історію перечитуємо, коли змінюється трек (щойно зіграний з'являється згори).
  const history = useLoad((signal) => api.history(signal).then((r) => r.tracks), [currentKey, lib.ready]);
  const recent = useLoad((signal) => api.recent(signal).then((r) => r.tracks), [currentKey, lib.version, lib.ready]);

  const rows = tab === "server" ? history : recent;
  return (
    <>
      <HomeHero state={state} perms={perms} onOpenQueue={onOpenQueue} />

      {lib.ready && (
        <section className="mt-2 mb-8">
          <SectionTitle
            action={
              <button type="button" onClick={() => router.go({ name: "library" })} className="text-xs font-medium text-dim hover:text-white">
                Усі
              </button>
            }
          >
            Мої плейлисти
          </SectionTitle>
          <PlaylistGrid
            perms={perms}
            limit={5}
            onPlayLikes={() => void playLikes({ mode: "now" })}
            onPlayPlaylist={(id, name) => void playPlaylist(id, name, { mode: "now" })}
          />
        </section>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "server", label: "Нещодавно на сервері" },
          { value: "mine", label: "Продовжити слухати" },
        ]}
      />
      <div className="border-t border-line" />
      <div className="pb-8">
        <TrackTable<HistoryTrack>
          tracks={rows.data ?? []}
          state={state}
          perms={perms}
          loading={rows.loading}
          aside={(track) => <PlayedBy track={track} />}
          empty={
            <div className="pt-6">
              <TableEmpty
                icon={<History />}
                title={tab === "server" ? "Тут ще нічого не грало" : "Ти ще нічого не вмикав"}
                text={
                  tab === "server"
                    ? "Щойно на сервері заграє музика, треки з'являться тут."
                    : "Треки, які ти вмикаєш на цьому чи інших серверах, з'являться тут."
                }
                action={
                  <Pill variant="gray" size="sm" onClick={() => router.go({ name: "search" })}>
                    <Search className="size-3.5" /> Знайти трек
                  </Pill>
                }
              />
            </div>
          }
        />
      </div>
    </>
  );
}

function PlayedBy({ track }: { track: HistoryTrack }) {
  return (
    <span className="flex items-center gap-2">
      {track.requester && <Avatar src={track.requester.avatar} name={track.requester.name} className="size-5" />}
      <span className="truncate">{timeAgo(track.played_at)}</span>
    </span>
  );
}

/** Шапка головної: «Зараз грає на сервері» або головна дія — покликати бота. */
function HomeHero({ state, perms, onOpenQueue }: { state: GuildState; perms: Perms; onOpenQueue: () => void }) {
  const player = state.player;
  const current = player?.current ?? null;

  if (!state.voice_channel) {
    return (
      <Hero
        label={state.guild.name}
        labelIcon={<Headphones />}
        title="Що послухаємо?"
        subtitle={
          perms.canSummon
            ? "Поклич бота у свій голосовий канал — і музика заграє для всіх."
            : "Зайди в голосовий канал, щоб покликати бота."
        }
        actions={
          <>
            <Pill
              variant="green"
              disabled={!perms.canSummon || !perms.summonChannel}
              title={perms.canSummon ? undefined : (perms.hint ?? undefined)}
              onClick={() => perms.summonChannel && void summon(perms.summonChannel)}
            >
              <Headphones className="size-[18px]" /> Покликати бота
            </Pill>
            <Pill variant="gray" onClick={() => router.go({ name: "search" })}>
              <Search className="size-[18px]" /> Пошук
            </Pill>
          </>
        }
      />
    );
  }

  if (!current) {
    return (
      <Hero
        label={`Бот у «${state.voice_channel.name}»`}
        labelIcon={<Disc3 />}
        title="Що послухаємо?"
        subtitle="Тиша в ефірі — знайди трек або ввімкни свій плейлист."
        actions={
          <Pill variant="green" onClick={() => router.go({ name: "search" })}>
            <Search className="size-[18px]" /> Знайти трек
          </Pill>
        }
      />
    );
  }

  return (
    <Hero
      label="Зараз грає на сервері"
      labelIcon={current.is_live ? <Radio /> : <Disc3 />}
      title={current.title}
      subtitle={
        <>
          {current.channel ?? "—"}
          {current.requester?.name && <> · замовив {current.requester.name}</>}
        </>
      }
      actions={
        <>
          <Pill
            variant="green"
            disabled={!perms.canControl}
            title={perms.canControl ? undefined : (perms.hint ?? undefined)}
            onClick={() => void control({ action: "toggle" })}
          >
            {player?.paused ? <Play className="size-[18px] fill-current" /> : <Pause className="size-[18px] fill-current" />}
            {player?.paused ? "Грати" : "Пауза"}
          </Pill>
          <Pill variant="gray" onClick={onOpenQueue}>
            <ListMusic className="size-[18px]" /> Черга
          </Pill>
        </>
      }
    />
  );
}
