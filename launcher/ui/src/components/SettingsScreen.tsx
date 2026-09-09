import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { buildRamOptions, clampSavedRam, loadSavedRam, saveRam } from "../ram";
import { User } from "../api";

interface Props {
  user: User;
  onBack: () => void;
}

/**
 * Кастомный слайдер: нативный input даёт рамку при фокусе и «телепорт»
 * thumb при клике по треку. Здесь thumb — обычный div с плавным
 * transition left (движение мягкое), фокус-рамки нет в принципе.
 */
function QuasarSlider({
  options,
  value,
  onChange,
}: {
  options: { value: number; label: string }[];
  value: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const maxIdx = Math.max(0, options.length - 1);
  const idx = Math.max(0, options.findIndex((o) => o.value >= value));
  const pct = maxIdx === 0 ? 0 : idx / maxIdx;

  const pickFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const p = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onChange(options[Math.round(p * maxIdx)].value);
  };

  return (
    <div
      role="slider"
      aria-valuemin={options[0]?.value}
      aria-valuemax={options[maxIdx]?.value}
      aria-valuenow={value}
      tabIndex={0}
      className="relative h-4 mx-[7px] cursor-pointer outline-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pickFromPointer(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) pickFromPointer(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" && idx < maxIdx) {
          e.preventDefault();
          onChange(options[idx + 1].value);
        }
        if (e.key === "ArrowLeft" && idx > 0) {
          e.preventDefault();
          onChange(options[idx - 1].value);
        }
      }}
    >
      {/* трек */}
      <div
        ref={trackRef}
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-quasar-border"
      />
      {/* thumb: left с transition -> плавное скольжение; hover через внутренний div */}
      <div
        className="absolute top-1/2 -mt-[7px] transition-[left] duration-150 ease-out"
        style={{ left: `${pct * 100}%` }}
      >
        <div className="w-3.5 h-3.5 rounded-full bg-quasar-accent shadow-glow-sm transition-transform duration-150 hover:scale-110" />
      </div>
    </div>
  );
}

/** Экран настроек: выделение оперативной памяти для игры (ползунок). */
export default function SettingsScreen({ user }: Props) {
  const [ram, setRam] = useState(loadSavedRam);
  const [options, setOptions] = useState(buildRamOptions(0)); // до загрузки — стандартные

  useEffect(() => {
    let mounted = true;
    api
      .systemRamMb()
      .then((mb) => {
        if (!mounted || !mb) return;
        const opts = buildRamOptions(mb);
        setOptions(opts);
        setRam((prev) => (opts.some((o) => o.value === prev) ? prev : clampSavedRam(opts)));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  function changeRam(value: number) {
    setRam(value);
    saveRam(value);
  }

  const currentGb = Math.round((ram / 1024) * 10) / 10;

  return (
    <div className="flex h-full flex-col relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.1),transparent_55%)] pointer-events-none" />

      <header className="flex items-center px-6 pt-5 pb-4 relative z-10">
        <h1 className="text-xl font-normal text-zinc-500">Настройки</h1>
      </header>

      <div className="flex-1 overflow-y-auto relative z-10">
        <div className="px-6 pb-6 max-w-2xl">
          {/* Оперативная память */}
          <section
            className="card p-6 bg-quasar-surface/80 backdrop-blur animate-fade-up"
            style={{ animationDelay: "0.05s" }}
          >
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <p className="text-sm text-zinc-300">Оперативная память</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Сколько ОЗУ выделить Minecraft. Для модов рекомендуются 4–6 GB.
                </p>
              </div>
              <span className="text-lg font-semibold text-violet-300 tabular-nums">
                {currentGb} GB
              </span>
            </div>

            <QuasarSlider options={options} value={ram} onChange={changeRam} />
          </section>
        </div>
      </div>
    </div>
  );
}
