import { invoke } from "@tauri-apps/api/core";

export interface User {
  userId: string;
  username: string;
  token: string;
  expiresAtMillis: number;
}

export interface ModEntry {
  id: string;
  modType: "required" | "optional";
  name: string;
  description: string;
  githubUrl: string;
  downloadUrl: string | null;
  fileName: string;
  sha256Hash: string;
}

export interface ModsResponse {
  required: ModEntry[];
  optional: ModEntry[];
}

export interface VerifyReport {
  wiped: string[];
  missing: string[];
  corrupted: string[];
  ok: boolean;
}

export interface LaunchResult {
  stage: "launched" | "verify_failed";
  report: VerifyReport;
  downloadErrors: string[];
}

export const API_BASE = "http://139.100.234.146:3000";

export const api = {
  register: (username: string, password: string) =>
    invoke<unknown>("cmd_register", { username, password }),

  login: (username: string, password: string) =>
    invoke<User>("cmd_login", { username, password }),

  currentUser: () => invoke<User | null>("cmd_current_user"),

  logout: () => invoke<void>("cmd_logout"),

  getMods: () => invoke<ModsResponse>("cmd_get_mods"),

  downloadMods: (optionalIds: string[]) =>
    invoke<string[]>("cmd_download_mods", { optionalIds }),

  skinPreview: (filePath: string) => invoke<string>("cmd_skin_preview", { filePath }),

  uploadSkin: (filePath: string, modelType: "slim" | "classic") =>
    invoke<{ resolution: number; modelType: string }>("cmd_upload_skin", {
      filePath,
      modelType,
    }),

  cleanAndVerify: () => invoke<VerifyReport>("cmd_clean_and_verify"),

  saveOptionalSelection: (optionalIds: string[]) =>
    invoke<void>("cmd_save_optional_selection", { optionalIds }),

  /** Сохранённый выбор опциональных модов (после перезапуска лаунчера). */
  loadOptionalSelection: () => invoke<string[]>("cmd_load_optional_selection"),

  /** Общий объём ОЗУ ПК в МБ (0 = определить не удалось). */
  systemRamMb: () => invoke<number>("cmd_system_ram_mb"),

  /** Версия лаунчера (Cargo.toml). */
  appVersion: () => invoke<string>("cmd_app_version"),

  /** Проверка обновлений: доступна ли новая версия. */
  checkUpdates: () =>
    invoke<{ available: boolean; current: string; latest: string; notes: string }>(
      "cmd_check_updates",
    ),

  /** Скачать новую версию в exe.new (прогресс через download-progress). */
  applyUpdate: () => invoke<void>("cmd_apply_update"),

  /** Заменить exe и перезапустить лаунчер. */
  finishUpdate: () => invoke<void>("cmd_finish_update"),

  launch: (ramMb: number) => invoke<LaunchResult>("cmd_launch", { ramMb }),

  /** base64 PNG скина с бэкенда (или null, если скина нет). */
  fetchSkin: (userId: string) => invoke<string | null>("cmd_fetch_skin", { userId }),

  gameRunning: () => invoke<boolean>("cmd_game_running"),

  closeGame: () => invoke<void>("cmd_close_game"),
};

/**
 * Режет лицо 8x8 из полного скина (base64 data-URL) в data-URL головы.
 * Работает для 64/128/256 (кратно 8). Использует canvas.
 */
export async function skinFaceDataUrl(skinDataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = img.width / 64; // масштаб (1, 2, 4)
      const canvas = document.createElement("canvas");
      canvas.width = 8 * s;
      canvas.height = 8 * s;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      // лицо: регион (8,8)-(16,16) в координатах 64x
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, 8 * s, 8 * s);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Не удалось прочитать PNG скина"));
    img.src = skinDataUrl;
  });
}
