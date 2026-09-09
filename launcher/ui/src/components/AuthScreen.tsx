import { FormEvent, useState } from "react";
import { api, User } from "../api";
import Modal from "./Modal";

/** Коды ошибок бэкенда/сети -> человеческий текст для модалки. */
function humanizeError(raw: string, mode: "login" | "register"): string {
  const codes: Record<string, string> = {
    INVALID_CREDENTIALS: "Такого игрока не существует или неверный пароль",
    USERNAME_TAKEN: "Этот ник уже занят",
    VALIDATION_ERROR: "Ник: 3-16 символов (a-z, 0-9, _). Пароль: минимум 8 символов",
    CLIENT_MISMATCH: "Запуск разрешён только из официального лаунчера",
    RATE_LIMITED: "Слишком много попыток. Подождите 15 минут",
    SERVER_ERROR: "Ошибка сервера. Попробуйте позже",
  };
  for (const [code, text] of Object.entries(codes)) {
    if (raw.includes(code)) return text;
  }
  if (
    raw.includes("Сервер недоступен") ||
    raw.includes("Ошибка сети") ||
    raw.includes("не отвечает") ||
    raw.includes("некорректный ответ")
  ) {
    return raw;
  }
  return mode === "login"
    ? "Не удалось войти. Проверьте данные и попробуйте позже"
    : "Не удалось зарегистрироваться. Попробуйте позже";
}

export default function AuthScreen({ onAuth }: { onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await api.register(username.trim(), password);
      }
      const user = await api.login(username.trim(), password);
      onAuth(user);
    } catch (e) {
      setError(humanizeError(String(e), mode));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center relative">
      {/* фиолетовое свечение фона */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.15),transparent_60%)]" />

      <form
        onSubmit={submit}
        className="relative card w-[380px] p-8 shadow-glow-sm bg-quasar-surface/80 backdrop-blur"
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black tracking-widest bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            QUASAR
          </h1>
          <p className="text-zinc-500 text-xs mt-1 uppercase tracking-[0.2em]">
            Minecraft Launcher
          </p>
        </div>

        <div className="flex mb-6 bg-black/40 rounded-lg p-1 border border-quasar-border">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); }}
              className={`flex-1 py-2 text-sm rounded-md transition ${
                mode === m
                  ? "bg-quasar-accent text-white font-medium shadow-glow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m === "login" ? "Вход" : "Регистрация"}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 block mb-1.5">Никнейм</label>
            <input
              className="w-full"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3-16 символов, a-z0-9_"
              maxLength={16}
              required
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1.5">Пароль</label>
            <input
              className="w-full"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="минимум 8 символов"
              required
            />
          </div>
        </div>

        <button type="submit" className="btn-primary w-full mt-6" disabled={busy}>
          {busy ? "Подождите..." : mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>

        <p className="text-center text-[11px] text-zinc-600 mt-5">
          Регистрация доступна только через лаунчер
        </p>
      </form>

      {error && (
        <Modal
          title={mode === "login" ? "Ошибка входа" : "Ошибка регистрации"}
          text={error}
          onClose={() => setError(null)}
        />
      )}
    </div>
  );
}
