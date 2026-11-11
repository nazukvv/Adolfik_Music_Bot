import { WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { control } from "../../lib/actions";
import { useMediaQuery } from "../../lib/hooks";
import { type Perms, perms as computePerms } from "../../lib/perms";
import { type Route, router, useRouter } from "../../lib/router";
import type { GuildState } from "../../lib/types";
import { Dialogs } from "../Dialogs";
import { HomePage } from "../pages/HomePage";
import { LibraryPage, LikesPage, PlaylistPage, ProfilePage } from "../pages/LibraryPages";
import { SearchPage } from "../pages/SearchPage";
import { Toasts } from "../Toasts";
import { MobilePlayer, PlayerBar } from "./Player";
import { NowPlayingSheet, type PanelTab, RightDrawer, RightPanel } from "./RightPanel";
import { BottomNav, Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * Каркас за референсом: сайдбар | центральна колонка (сторінка + плеєр унизу) | права панель.
 *   ≥1280px — усі три колонки, права панель ховається кнопкою;
 *   768–1279 — сайдбар + центр, права панель виїжджає поверх;
 *   <768 — нижня навігація, компактний плеєр над нею, «Зараз грає» на весь екран.
 */
export function AppShell({ state, online }: { state: GuildState; online: boolean }) {
  const perms = computePerms(state);
  const md = useMediaQuery("(min-width: 768px)");
  const xl = useMediaQuery("(min-width: 1280px)");
  const { route, index } = useRouter();
  const [pinned, setPinned] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [tab, setTab] = useState<PanelTab>("now");
  const [scrolled, setScrolled] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useShortcuts(perms.canControl && !!state.player?.current);

  // Нова сторінка — згори; «назад/вперед» — туди, де був.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = router.scrollTops.get(index) ?? 0;
    setOverlay(false);
  }, [index, route.name]);

  const panelOpen = xl ? pinned : overlay;
  const togglePanel = () => (xl ? setPinned((v) => !v) : setOverlay((v) => !v));
  const openPanel = (next: PanelTab) => {
    setTab(next);
    if (xl) setPinned(true);
    else setOverlay(true);
  };
  const panelProps = { state, perms, tab, onTab: setTab };

  return (
    <div className="flex h-full overflow-hidden bg-ink">
      {md && <Sidebar />}

      <div className="flex min-w-0 flex-1 flex-col bg-main">
        <OfflineBanner online={online} />
        <div
          ref={scroller}
          onScroll={(e) => {
            const top = e.currentTarget.scrollTop;
            router.scrollTops.set(index, top);
            setScrolled(top > 24);
          }}
          className="@container relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <TopBar state={state} perms={perms} online={online} scrolled={scrolled} mobile={!md} />
          <motion.div
            key={pageKey(route)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="-mt-16"
          >
            <Page route={route} state={state} perms={perms} onOpenQueue={() => openPanel("queue")} />
          </motion.div>
        </div>

        {md ? (
          <PlayerBar state={state} perms={perms} showTrack={!xl || !pinned} panelOpen={panelOpen} onTogglePanel={togglePanel} />
        ) : (
          <MobilePlayer state={state} perms={perms} onOpen={() => openPanel("now")} />
        )}
        {!md && <BottomNav />}
      </div>

      {xl && pinned && <RightPanel {...panelProps} onClose={() => setPinned(false)} />}
      {md && !xl && <RightDrawer {...panelProps} open={overlay} onClose={() => setOverlay(false)} />}
      {!md && <NowPlayingSheet {...panelProps} open={overlay} onClose={() => setOverlay(false)} />}

      <Toasts bottom={md ? 120 : state.player?.current ? 136 : 76} />
      <Dialogs />
    </div>
  );
}

function pageKey(route: Route): string {
  return route.name === "playlist" ? `playlist-${route.id}` : route.name;
}

function Page({ route, state, perms, onOpenQueue }: { route: Route; state: GuildState; perms: Perms; onOpenQueue: () => void }) {
  switch (route.name) {
    case "home":
      return <HomePage state={state} perms={perms} onOpenQueue={onOpenQueue} />;
    case "search":
      return <SearchPage state={state} perms={perms} initial={route.q ?? ""} />;
    case "likes":
      return <LikesPage state={state} perms={perms} />;
    case "library":
      return <LibraryPage perms={perms} />;
    case "playlist":
      return <PlaylistPage key={route.id} id={route.id} state={state} perms={perms} />;
    case "profile":
      return <ProfilePage state={state} />;
  }
}

function OfflineBanner({ online }: { online: boolean }) {
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="shrink-0 overflow-hidden"
        >
          <div className="flex items-center gap-2 border-b border-amber-400/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-100 sm:px-8">
            <WifiOff className="size-4 shrink-0 text-amber-300" />
            Зв'язок із ботом втрачено — перепідключаюсь… Стан на екрані може бути застарілим.
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Пробіл — пауза/відтворення, «/» — до пошуку (коли не друкуєш у полі). */
function useShortcuts(canToggle: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        router.go({ name: "search" });
        window.setTimeout(() => document.getElementById("search-input")?.focus(), 50);
      } else if (e.code === "Space" && !e.repeat && target?.tagName !== "BUTTON" && canToggle) {
        e.preventDefault();
        void control({ action: "toggle" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canToggle]);
}
