import { api } from "../api";

interface Props {
  onClose: () => void;
}

/**
 * Модалка после успешного запуска. Закрыть можно ТОЛЬКО кнопкой «Выйти» —
 * она убивает процесс Minecraft (защита от второго запуска).
 */
export default function GameRunningModal({ onClose }: Props) {
  async function exitGame() {
    try {
      await api.closeGame();
    } finally {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70">
      <div className="card w-[360px] p-7 bg-quasar-surface shadow-glow-sm text-center">
        <h3 className="text-base font-semibold text-zinc-100">Игра запущена</h3>
        <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
          Minecraft работает. Нажмите «Выйти», чтобы закрыть игру —
          это необходимо перед новым запуском.
        </p>
        <button onClick={exitGame} className="btn-primary w-full mt-6">
          Выйти
        </button>
      </div>
    </div>
  );
}
