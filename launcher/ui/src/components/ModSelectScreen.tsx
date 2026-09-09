import { useEffect, useState } from "react";
import { api, ModEntry } from "../api";

interface Props {
  onContinue: () => void;
  onLogout: () => void;
}

type Progress = { file: string; percent: number } | null;

/** modrinth CDN-ссылка -> id проекта для API картинок */
function modrinthProjectId(downloadUrl: string): string | null {
  const m = downloadUrl.match(/modrinth\.com\/data\/([A-Za-z0-9]+)\//);
  return m ? m[1] : null;
}

export default function ModSelectScreen({ onContinue, onLogout }: Props) {
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);

  useEffect(() => {
    api
      .getMods()
      .then(async (r) => {
        setMods([...r.required, ...r.optional]);
        // Восстановить сохранённый выбор после перезапуска лаунчера
        try {
          const saved = await api.loadOptionalSelection();
          setSelected(new Set(saved));
        } catch {
          /* первый запуск — выбора ещё нет */
        }
        // Картинки опциональных модов с Modrinth API
        r.optional.forEach((m) => {
          const pid = modrinthProjectId(m.downloadUrl ?? "");
          if (!pid) return;
          fetch(`https://api.modrinth.com/v2/project/${pid}`)
            .then((res) => res.json())
            .then((j) => {
              if (j.icon_url) setIcons((prev) => ({ ...prev, [m.id]: j.icon_url }));
            })
            .catch(() => {});
        });
      })
      .catch((e) => setError(String(e)));

    const unlisten = import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ file: string; percent: number }>("download-progress", (ev) =>
        setProgress(ev.payload),
      ),
    );
    return () => { unlisten.then((f) => f()); };
  }, []);

  const optional = mods.filter((m) => m.modType === "optional");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await api.saveOptionalSelection([...selected]);
      await api.downloadMods([...selected]);
      onContinue();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex h-full flex-col p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-normal text-zinc-500">Выбор модов</h1>
        <button
          onClick={onLogout}
          className="grid place-items-center w-9 h-9 rounded-lg border border-transparent
            text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition"
          aria-label="Выйти"
        >
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
          Опциональные моды
        </p>
        {optional.length === 0 && !error && (
          <p className="text-zinc-600 text-sm">Список пуст или загружается...</p>
        )}
        {optional.map((m) => (
          <div
            key={m.id}
            onClick={() => toggle(m.id)}
            className={`card flex items-center gap-4 p-4 cursor-pointer transition
              ${selected.has(m.id) ? "border-quasar-accent shadow-glow-sm" : "hover:border-zinc-600"}`}
          >
            {icons[m.id] ? (
              <img
                src={icons[m.id]}
                alt={m.name}
                className="w-12 h-12 rounded-lg object-cover shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-black/40 border border-quasar-border grid place-items-center shrink-0">
                <span className="text-zinc-600 text-lg">◆</span>
              </div>
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-100">{m.name}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{m.description}</p>
            </div>
            <a
              href={m.githubUrl}
              onClick={(e) => e.preventDefault()}
              className="text-[11px] text-quasar-accent hover:underline"
              title={m.githubUrl}
            >
              GitHub
            </a>
          </div>
        ))}
      </div>

      {progress && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-zinc-400 mb-1">
            <span>{progress.file}</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-2 bg-black/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <button
        onClick={download}
        className="btn-primary w-full mt-4"
        disabled={busy || optional.length === 0}
      >
        {busy ? "Скачивание..." : "Продолжить"}
      </button>
    </div>
  );
}
