import { useEffect, useState } from "react";
import { api } from "../api";

interface Props {
  latest: string;
  current: string;
  notes: string;
  onClose: () => void;
}

/**
 * Модалка обновления: предложение новой версии -> прогресс скачивания ->
 * замена exe и перезапуск (cmd_finish_update). Закрыть можно только кнопкой.
 */
export default function UpdateModal({ latest, current, notes, onClose }: Props) {
  const [phase, setPhase] = useState<"offer" | "downloading">("offer");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "downloading") return;
    let mounted = true;
    const sub = import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ file: string; percent: number }>("download-progress", (ev) => {
        if (mounted) setPercent(ev.payload.percent);
      }),
    );
    return () => {
      mounted = false;
      sub.then((f) => f());
    };
  }, [phase]);

  const [percent, setPercent] = useState(0);

  async function applyUpdate() {
    setError(null);
    setPhase("downloading");
    setPercent(0);
    try {
      await api.applyUpdate();
      // exe заменён -> запускаем swap-скрипт и перезапускаемся
      await api.finishUpdate();
    } catch (e) {
      setError(String(e));
      setPhase("offer");
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70">
      <div className="card w-[380px] p-7 bg-quasar-surface shadow-glow-sm">
        <h3 className="text-base font-semibold text-zinc-100">
          Доступно обновление
        </h3>
        <p className="text-sm text-zinc-400 mt-2">
          Версия <span className="text-violet-300">{latest}</span>{" "}
          <span className="text-zinc-600">(у тебя {current})</span>
        </p>

        {notes.trim() && phase === "offer" && (
          <p className="text-xs text-zinc-500 mt-3 max-h-24 overflow-y-auto whitespace-pre-line">
            {notes}
          </p>
        )}

        {phase === "downloading" && (
          <div className="mt-5">
            <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
              <span>Скачивание обновления</span>
              <span className="tabular-nums">{percent}%</span>
            </div>
            <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-[11px] text-zinc-600 mt-2">
              Лаунчер перезапустится автоматически
            </p>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="flex gap-3 mt-6">
          {phase === "offer" && (
            <button onClick={onClose} className="btn-ghost flex-1">
              Позже
            </button>
          )}
          <button
            onClick={applyUpdate}
            className="btn-primary flex-1"
            disabled={phase === "downloading"}
          >
            {phase === "downloading" ? "..." : "Обновить"}
          </button>
        </div>
      </div>
    </div>
  );
}
