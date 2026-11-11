import { Heart, Home, Library, ListMusic, Search, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { plural } from "../../lib/format";
import { useLibrary } from "../../lib/library";
import { type Route, router, useRouter } from "../../lib/router";
import { Logo } from "../Logo";

/** Лівий сайдбар (≥768px): меню, «Мої плейлисти» зі списком, внизу «Налаштування». */
export function Sidebar() {
  const { route } = useRouter();
  const lib = useLibrary();

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-side lg:w-[240px]">
      <div className="px-5 pt-6 pb-5">
        <button type="button" onClick={() => router.go({ name: "home" })} aria-label="На головну" className="rounded-lg">
          <Logo />
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col" aria-label="Навігація">
        <SideLabel>Меню</SideLabel>
        <NavItem icon={<Home />} active={route.name === "home"} onClick={() => router.go({ name: "home" })}>
          Головна
        </NavItem>
        <NavItem
          icon={<Search />}
          active={route.name === "search"}
          onClick={() => router.go({ name: "search", q: route.name === "search" ? route.q : undefined })}
        >
          Пошук
        </NavItem>
        <NavItem icon={<Heart />} active={route.name === "likes"} onClick={() => router.go({ name: "likes" })}>
          Улюблені
          {lib.ready && lib.liked.size > 0 && <Count>{lib.liked.size}</Count>}
        </NavItem>
        <NavItem icon={<Library />} active={route.name === "library"} onClick={() => router.go({ name: "library" })}>
          Мої плейлисти
        </NavItem>

        <div className="mx-5 my-4 border-t border-line" />

        <SideLabel>Плейлисти</SideLabel>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {!lib.me ? null : !lib.ready ? (
            <p className="px-5 text-xs leading-relaxed text-faint">Бібліотека зараз недоступна на сервері бота.</p>
          ) : lib.playlists.length === 0 ? (
            <p className="px-5 text-xs leading-relaxed text-faint">Тут з'являться твої плейлисти.</p>
          ) : (
            lib.playlists.map((playlist) => (
              <PlaylistItem
                key={playlist.id}
                name={playlist.name}
                count={playlist.track_count}
                active={route.name === "playlist" && route.id === playlist.id}
                onClick={() => router.go({ name: "playlist", id: playlist.id })}
              />
            ))
          )}
        </div>

        <div className="mx-5 border-t border-line" />
        <div className="py-3">
          <NavItem icon={<Settings />} active={route.name === "profile"} onClick={() => router.go({ name: "profile" })}>
            Налаштування
          </NavItem>
        </div>
      </nav>
    </aside>
  );
}

function SideLabel({ children }: { children: ReactNode }) {
  return <p className="px-5 pb-2 text-[11px] font-medium text-faint">{children}</p>;
}

function Count({ children }: { children: ReactNode }) {
  return <span className="ml-auto text-[11px] text-faint tabular-nums">{children}</span>;
}

/** Пункт меню: активний — фон #1a1a1a і вертикальна зелена смужка праворуч. */
function NavItem({ icon, active, onClick, children }: { icon: ReactNode; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-11 w-full items-center gap-3.5 px-5 text-left text-[13px] font-medium transition-colors [&>svg]:size-[18px] [&>svg]:shrink-0 ${
        active ? "bg-hover text-white" : "text-dim hover:text-white"
      }`}
    >
      {icon}
      {children}
      {active && <span className="absolute top-1/2 right-0 h-7 w-[3px] -translate-y-1/2 rounded-l-full bg-green" />}
    </button>
  );
}

function PlaylistItem({ name, count, active, onClick }: { name: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={`${name} · ${plural(count, "трек", "треки", "треків")}`}
      className={`relative flex h-10 w-full items-center gap-3 px-5 text-left text-[13px] transition-colors ${
        active ? "bg-hover text-white" : "text-dim hover:text-white"
      }`}
    >
      <ListMusic className="size-4 shrink-0" />
      <span className="truncate">{name}</span>
      {active && <span className="absolute top-1/2 right-0 h-6 w-[3px] -translate-y-1/2 rounded-l-full bg-green" />}
    </button>
  );
}

/** Нижня навігація на телефоні (<768px) замість сайдбару. */
export function BottomNav() {
  const { route } = useRouter();
  const items: Array<{ route: Route; label: string; icon: ReactNode; active: boolean }> = [
    { route: { name: "home" }, label: "Головна", icon: <Home />, active: route.name === "home" },
    { route: { name: "search", q: route.name === "search" ? route.q : undefined }, label: "Пошук", icon: <Search />, active: route.name === "search" },
    { route: { name: "likes" }, label: "Улюблені", icon: <Heart />, active: route.name === "likes" },
    {
      route: { name: "library" },
      label: "Плейлисти",
      icon: <Library />,
      active: route.name === "library" || route.name === "playlist",
    },
  ];
  return (
    <nav
      aria-label="Навігація"
      className="grid shrink-0 grid-cols-4 border-t border-line bg-side pb-[env(safe-area-inset-bottom)]"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => router.go(item.route)}
          aria-current={item.active ? "page" : undefined}
          className={`relative flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors [&>svg]:size-5 ${
            item.active ? "text-white" : "text-dim"
          }`}
        >
          {item.icon}
          {item.label}
          {item.active && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-green" />}
        </button>
      ))}
    </nav>
  );
}
