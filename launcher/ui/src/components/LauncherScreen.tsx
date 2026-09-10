import { useEffect, useState } from "react";
import { api, LaunchResult, User, VerifyReport } from "../api";
import { loadSavedRam } from "../ram";
import SkinAvatar from "./SkinAvatar";
import GameRunningModal from "./GameRunningModal";
import nightBg from "../assets/night-bg.png";

interface Props {
  user: User;
  onLogout: () => void;
}

type Status = { kind: "idle" | "busy" | "ok" | "err"; text: string };

export default function LauncherScreen({ user, onLogout }: Props) {
  // RAM задаётся на экране «Настройки»; здесь только читаем сохранённый выбор
  const ram = loadSavedRam();
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [progress, setProgress] = useState<{ file: string; percent: number } | null>(null);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [dlErrors, setDlErrors] = useState<string[]>([]);
  const [gameModal, setGameModal] = useState(false);

  useEffect(() => {
    let mounted = true;
    const progressSub = import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ file: string; percent: number }>("download-progress", (ev) => {
        if (mounted) setProgress(ev.payload);
      }),
    );
    // Minecraft закрылся сам — убираем модалку
    const exitSub = import("@tauri-apps/api/event").then(({ listen }) =>
      listen("game-exited", () => {
        if (!mounted) return;
        setGameModal(false);
        setStatus({ kind: "idle", text: "" });
      }),
    );
    return () => {
      mounted = false;
      progressSub.then((f) => f());
      exitSub.then((f) => f());
    };
  }, []);

  async function play() {
    setStatus({ kind: "busy", text: "Подготовка..." });
    setReport(null);
    setDlErrors([]);
    try {
      const res: LaunchResult = await api.launch(ram);
      setReport(res.report);
      setDlErrors(res.downloadErrors ?? []);
      if (res.stage === "verify_failed") {
        setStatus({ kind: "err", text: "Целостность файлов не подтверждена" });
      } else {
        setStatus({ kind: "ok", text: "" });
        setGameModal(true);
      }
    } catch (e) {
      setStatus({ kind: "err", text: String(e) });
    } finally {
      setProgress(null);
    }
  }

  async function checkFiles() {
    setStatus({ kind: "busy", text: "Проверка целостности..." });
    try {
      const r = await api.cleanAndVerify();
      setReport(r);
      setStatus(
        r.ok
          ? { kind: "ok", text: "Все файлы в порядке" }
          : { kind: "err", text: "Найдены проблемы (см. отчёт ниже)" },
      );
    } catch (e) {
      setStatus({ kind: "err", text: String(e) });
    }
  }

  const busy = status.kind === "busy";

  return (
    <div className="flex h-full flex-col relative">
      {/* Ночной фон из игры (вшит в exe), затемнён для читаемости UI */}
      <div
        className="absolute inset-0 bg-cover bg-center [image-rendering:pixelated] pointer-events-none"
        style={{ backgroundImage: `linear-gradient(rgba(10,10,15,0.72), rgba(10,10,15,0.82)), url(${nightBg})` }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(139,92,246,0.12),transparent_55%)] pointer-events-none" />

      {/* Шапка: ник + аватар + иконка выхода (навигация — в боковом меню) */}
      <header className="flex items-center justify-end gap-3 px-6 pt-5 pb-1 relative z-10">
        <div className="flex items-center gap-2 px-3 py-1.5 card !rounded-lg">
          <SkinAvatar userId={user.userId} size={26} />
          <span className="text-sm text-zinc-300">{user.username}</span>
        </div>
        <button
          onClick={onLogout}
          className="grid place-items-center w-9 h-9 rounded-lg border border-transparent
            text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition"
          aria-label="Выйти"
        >          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </header>

      {/* Правый нижний угол: статус/отчёт + прогресс + кнопки */}
      <div className="absolute bottom-5 right-6 flex flex-col items-end gap-3 z-20 max-w-[26rem]">
        {status.text && (
          <p
            className={`text-xs text-right animate-fade-up ${
              status.kind === "err"
                ? "text-red-400"
                : status.kind === "ok"
                  ? "text-emerald-400"
                  : "text-zinc-400"
            }`}
          >
            {status.text}
          </p>
        )}

        {report && !report.ok && (
          <div className="w-full card p-3 text-xs space-y-1 bg-quasar-surface/80 backdrop-blur animate-fade-up">
            {report.corrupted.length > 0 && (
              <p className="text-red-300">Повреждено файлов: {report.corrupted.length}</p>
            )}
            {report.missing.length > 0 && (
              <p className="text-red-300">Отсутствует файлов: {report.missing.length}</p>
            )}
            {dlErrors.map((e, i) => (
              <p key={i} className="text-orange-300 break-all">{e}</p>
            ))}
          </div>
        )}

        {progress && busy && (
          <div className="w-full card p-3 animate-fade-up">
            <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
              <span className="truncate">{progress.file}</span>
              <span className="tabular-nums">{progress.percent}%</span>
            </div>
            <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-200"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={checkFiles}
            className="btn-ghost border border-quasar-border"
            disabled={busy}
          >
            Проверить файлы
          </button>
          <button onClick={play} className="btn-primary" disabled={busy}>
            {busy ? "..." : "ИГРАТЬ"}
          </button>
        </div>
      </div>

      {gameModal && (
        <GameRunningModal
          onClose={async () => {
            setGameModal(false);
            setStatus({ kind: "idle", text: "" });
          }}
        />
      )}
    </div>
  );
}