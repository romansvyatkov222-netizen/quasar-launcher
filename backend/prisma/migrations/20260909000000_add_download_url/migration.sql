-- Прямая ссылка на скачивание (GitHub releases/raw не для всех модов:
-- Fabric API на maven.fabricmc.net, Sodium/ModMenu на CDN Modrinth)
ALTER TABLE "mod_manifest" ADD COLUMN "download_url" TEXT;
