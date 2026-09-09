import { useEffect } from "react";

interface Props {
  title?: string;
  text: string;
  onClose: () => void;
}

/**
 * Мини-модалка: закрытие по ESC, крестику и клику по пустому месту.
 */
export default function Modal({ title, text, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card relative w-[340px] p-6 bg-quasar-surface/95 backdrop-blur shadow-glow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-2.5 right-3 text-zinc-500 hover:text-zinc-100 transition"
          aria-label="Закрыть"
        >
          ✕
        </button>
        {title && (
          <h3 className="text-sm font-semibold text-violet-300 mb-2 pr-6">{title}</h3>
        )}
        <p className="text-sm text-zinc-200 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
