const RAM_STORAGE_KEY = "quasar.ramMb";
const DEFAULT_RAM = 4096;

/**
 * Динамические опции: чётные значения от 2 ГБ до объёма машины (−2 ГБ на ОС).
 * 8 ГБ ПК  -> 2, 4, 6
 * 16 ГБ ПК -> 2, 4, 6, 8, 10, 12, 14
 * 32 ГБ ПК -> 2, 4, ..., 28, 30
 * Максимум всегда кратен 2, поэтому последние значения и DEFAULT_RAM (4 ГБ)
 * гарантированно попадают в список.
 */
export function buildRamOptions(totalRamMb: number): { label: string; value: number }[] {
  // Объём не определился — разумный дефолт (пока Rust-команда отвечает)
  if (!totalRamMb || totalRamMb < 2 * 1024) {
    return [2, 4, 6, 8].map((gb) => ({ label: `${gb} GB`, value: gb * 1024 }));
  }
  const maxGb = Math.max(2, Math.floor((totalRamMb - 2 * 1024) / 1024 / 2) * 2);
  const options: { label: string; value: number }[] = [];
  for (let gb = 2; gb <= maxGb; gb += 2) {
    options.push({ label: `${gb} GB`, value: gb * 1024 });
  }
  return options;
}

export function loadSavedRam(): number {
  const saved = Number(localStorage.getItem(RAM_STORAGE_KEY));
  return Number.isFinite(saved) && saved >= 1024 ? saved : DEFAULT_RAM;
}

/** Проверяет сохранённый выбор по актуальным опциям (например, уменьшили ОЗУ). */
export function clampSavedRam(options: { value: number }[]): number {
  const saved = loadSavedRam();
  return options.some((o) => o.value === saved)
    ? saved
    : (options.find((o) => o.value === DEFAULT_RAM)?.value ?? options[0]?.value ?? DEFAULT_RAM);
}

export function saveRam(value: number): void {
  localStorage.setItem(RAM_STORAGE_KEY, String(value));
}
