import { useEffect, useRef, useState } from "react";
import * as skinview3d from "skinview3d";

import steveFull from "../assets/steve-full.png";

interface Props {
  /** data-URL выбранного PNG или null (показываем дефолтного Стива) */
  skinUrl: string | null;
  model: "classic" | "slim";
}

/**
 * 3D-вьювер персонажа (skinview3d). Вращение мышью, зум колесом.
 * Анти-лаг: постоянный рендер-луп выключен (renderPaused), кадры рисуются
 * только при вращении/зуме/ресайзе — в простое 0% CPU.
 */
export default function Skin3DViewer({ skinUrl, model }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<skinview3d.SkinViewer | null>(null);
  const [failed, setFailed] = useState(false);

  // Создание вьювера — один раз
  useEffect(() => {
    const el = containerRef.current;
    if (!el || viewerRef.current) return;

    // canvas создаём сами: SkinViewer принимает строго HTMLCanvasElement
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    el.appendChild(canvas);
    canvasRef.current = canvas;

    let viewer: skinview3d.SkinViewer;
    try {
      viewer = new skinview3d.SkinViewer({
        canvas,
        width: el.clientWidth,
        height: el.clientHeight,
        renderPaused: true, // без рендер-лупа: кадры только по событиям
        fov: 50,
        zoom: 0.85,
      });
    } catch {
      setFailed(true); // WebGL недоступен
      return;
    }

    viewerRef.current = viewer;
    viewer.camera.position.set(0, 0.2, 70); // фронт, чуть выше глаз
    viewer.controls.enablePan = false; // панорама не нужна, только вращение+зум
    viewer.controls.enableDamping = false; // кадры строго по событию change
    viewer.animation = null; // статичная модель (ходьба не нужна)

    // Перерисовка только при взаимодействии и ресайзе
    const repaint = () => viewer.render();
    viewer.controls.addEventListener("change", repaint);
    const ro = new ResizeObserver(() => {
      viewer.width = el.clientWidth;
      viewer.height = el.clientHeight;
      repaint();
    });
    ro.observe(el);
    repaint(); // первый кадр

    return () => {
      ro.disconnect();
      viewer.controls.removeEventListener("change", repaint);
      viewer.dispose();
      viewerRef.current = null;
      canvas.remove();
      canvasRef.current = null;
    };
  }, []);

  // Смена текстуры/модели без пересоздания вьювера
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const url = skinUrl ?? steveFull;
    viewer
      .loadSkin(url, { model: model === "slim" ? "slim" : "default" })
      .then(() => viewer.render())
      .catch(() => viewer.render());
  }, [skinUrl, model]);

  if (failed) {
    return (
      <div className="flex-1 card grid place-items-center text-zinc-600 text-sm border-dashed">
        3D-просмотр недоступен
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 card overflow-hidden cursor-grab active:cursor-grabbing min-h-[320px]"
    />
  );
}
