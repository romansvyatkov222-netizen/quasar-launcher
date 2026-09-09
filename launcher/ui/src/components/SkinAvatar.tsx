import { useEffect, useState } from "react";
import { api, skinFaceDataUrl } from "../api";
import steveFace from "../assets/steve-face.png";

interface Props {
  userId: string;
  size?: number; // px
}

/**
 * Голова скина рядом с ником: дефолт — Стив, после загрузки скина — лицо игрока.
 * Тянет скин с бэкенда и режет регион лица (8x8 @ 64x) через canvas.
 */
export default function SkinAvatar({ userId, size = 28 }: Props) {
  const [face, setFace] = useState<string>(steveFace);

  useEffect(() => {
    let alive = true;
    api
      .fetchSkin(userId)
      .then(async (dataUrl) => {
        if (!alive || !dataUrl) return;
        const faceUrl = await skinFaceDataUrl(dataUrl);
        if (alive) setFace(faceUrl);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <img
      src={face}
      alt="avatar"
      width={size}
      height={size}
      style={{ imageRendering: "pixelated" }}
      className="rounded-sm shadow-glow-sm border border-quasar-border"
    />
  );
}
