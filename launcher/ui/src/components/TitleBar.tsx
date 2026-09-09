import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../api";

const appWindow = getCurrentWindow();

/**
 * Кастомный тайтлбар вместо системной рамки Windows:
 * логотип + версия слева (drag-зона), служебные кнопки справа в стиле темы.
 */
export default function TitleBar() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    api.appVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="h-10 flex items-center justify-between pl-4 bg-quasar-surface border-b border-quasar-border select-none shrink-0"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pointer-events-none">
        <span className="text-sm font-black tracking-widest bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
          QUASAR
        </span>
        <span className="text-[10px] text-zinc-600 uppercase tracking-[0.2em]">launcher</span>
        {version && (
          <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded border border-quasar-border tabular-nums">
            v{version}
          </span>
        )}
      </div>

      <div className="flex h-full">
        <button
          onClick={() => appWindow.minimize()}
          className="w-12 h-full grid place-items-center text-zinc-500 hover:text-zinc-100 hover:bg-white/5 transition"
          aria-label="Свернуть"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="w-12 h-full grid place-items-center text-zinc-500 hover:text-zinc-100 hover:bg-white/5 transition"
          aria-label="Развернуть"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-12 h-full grid place-items-center text-zinc-500 hover:text-white hover:bg-red-500/80 transition"
          aria-label="Закрыть"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}
