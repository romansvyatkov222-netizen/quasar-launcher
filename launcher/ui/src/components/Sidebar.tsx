import { useState } from "react";

export type Screen = "play" | "skins" | "settings";

interface Props {
  screen: Screen;
  onNavigate: (s: Screen) => void;
}

const ITEMS: { id: Screen; label: string; icon: JSX.Element }[] = [
  {
    id: "play",
    label: "Играть",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="6 3 20 12 6 21 6 3" />
      </svg>
    ),
  },
  {
    id: "skins",
    label: "Скины",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Настройки",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

/**
 * Выдвижное боковое меню (иконки + текст). В свёрнутом виде — только иконки.
 * Ник + аватар + «Выйти» остаются в шапке контентной части.
 */
export default function Sidebar({ screen, onNavigate }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className={`${expanded ? "w-44" : "w-14"} shrink-0 flex flex-col border-r border-quasar-border
        bg-quasar-bg/70 backdrop-blur transition-[width] duration-200 overflow-hidden`}
    >
      {/* Кнопка выдвижения */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-3 px-[15px] py-4 text-zinc-500 hover:text-zinc-300 transition shrink-0"
      >
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {expanded && (
          <span className="text-sm font-black tracking-widest bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            Меню
          </span>
        )}
      </button>

      <nav className="flex-1 py-2 space-y-1">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`group flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm whitespace-nowrap
              border transition-all duration-200 ease-out
              ${
                screen === item.id
                  ? "text-violet-300 border-transparent shadow-glow-sm"
                  : "text-zinc-500 border-transparent hover:text-zinc-200 hover:bg-white/5 hover:border-quasar-border hover:translate-x-1"
              }`}
          >
            <span className="shrink-0 transition-transform duration-200 ease-out group-hover:scale-110">
              {item.icon}
            </span>
            {expanded && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Нижний отступ — баланс */}
      <div className="p-3" />
    </aside>
  );
}
