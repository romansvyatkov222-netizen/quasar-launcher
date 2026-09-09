import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, User } from "../api";
import Skin3DViewer from "./Skin3DViewer";

interface Props {
  user: User;
  onBack: () => void;
}

const MODELS = [
  { id: "classic", label: "Classic (Steve)" },
  { id: "slim", label: "Slim (Alex)" },
] as const;

export default function SkinUploadScreen({ user }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  // Текущий скин с сервера — стартовое содержимое 3D-вьювера
  const [currentSkinUrl, setCurrentSkinUrl] = useState<string | null>(null);
  const MODEL_KEY = "quasar.skinModel";
  const [model, setModel] = useState<"classic" | "slim">(() => {
    const saved = localStorage.getItem(MODEL_KEY);
    return saved === "slim" || saved === "classic" ? saved : "classic";
  });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .fetchSkin(user.userId)
      .then((dataUrl) => {
        if (mounted && dataUrl) setCurrentSkinUrl(dataUrl);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [user.userId]);

  function changeModel(m: "classic" | "slim") {
    setModel(m);
    localStorage.setItem(MODEL_KEY, m);
  }

  /** Единый сценарий: кнопка -> Проводник -> загрузка на сервер. */
  async function pickAndUpload() {
    const path = await open({
      filters: [{ name: "PNG скин", extensions: ["png"] }],
    });
    if (typeof path !== "string") return;

    setBusy(true);
    setStatus(null);
    try {
      // Сразу показываем выбранный файл в 3D-вьювере
      const dataUrl = await api.skinPreview(path);
      setPreview(dataUrl);
      // И загружаем на сервер с выбранной моделью
      const res = await api.uploadSkin(path, model);
      setStatus({
        ok: true,
        text: `Скин загружен (${res.resolution}x${res.resolution}, ${res.modelType})`,
      });
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col p-6 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.1),transparent_55%)] pointer-events-none" />

      <header className="flex items-center mb-6 relative z-10 animate-fade-up">
        <h1 className="text-xl font-normal text-zinc-500">Установить скин</h1>
      </header>

      <div className="flex-1 flex gap-6 items-stretch relative z-10 max-w-3xl w-full mx-auto">
        {/* 3D-вьювер: вращение мышью, зум колесом */}
        <div
          className={`flex-1 flex flex-col transition animate-fade-up min-h-[380px]
            ${preview ? "" : "border-2 border-dashed border-quasar-border rounded-xl"}`}
          style={{ animationDelay: "0.1s" }}
        >
          <Skin3DViewer skinUrl={preview ?? currentSkinUrl} model={model} />
          <div className="text-center p-4 bg-quasar-bg/40 rounded-b-xl">
            <button onClick={pickAndUpload} className="btn-primary" disabled={busy}>
              {busy ? "Загрузка..." : "Загрузить скин"}
            </button>
            <p className="text-xs text-zinc-600 mt-2">
              Выберите PNG: 64x64, 128x128, 256x256 (и legacy 64x32)
            </p>
          </div>
        </div>

        {/* Настройки модели */}
        <div className="w-64 flex flex-col gap-4 animate-fade-up" style={{ animationDelay: "0.18s" }}>
          <div>
            <p className="text-xs text-zinc-400 mb-2">Модель</p>
            <div className="space-y-2">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => changeModel(m.id)}
                  className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition ${
                    model === m.id
                      ? "bg-quasar-accent-soft border-quasar-accent text-violet-300"
                      : "border-quasar-border text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {status && (
            <p className={`text-xs ${status.ok ? "text-emerald-400" : "text-red-400"}`}>
              {status.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
