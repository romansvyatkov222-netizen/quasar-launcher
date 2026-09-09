// Seed модов в mod_manifest. Запуск: node prisma/seed.mjs
// sha256_hash — реальный SHA-256 jar-файла. Обновляй после релиза новой версии мода.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const mods = [
  {
    modType: 'REQUIRED',
    name: 'Fabric API',
    description: 'Базовая библиотека, необходима для работы клиентских модов',
    githubUrl: 'https://github.com/FabricMC/fabric',
    downloadUrl:
      'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.141.6%2B1.21.11/fabric-api-0.141.6%2B1.21.11.jar',
    fileName: 'fabric-api-0.141.6+1.21.11.jar',
    sha256Hash: 'bdff7fd7e220085cfad2ff9b1f40dde6534ae0b96cf378f97a374bc54cb9ed0f',
  },
  {
    modType: 'REQUIRED',
    name: 'Quasar SkinFix',
    description: 'Поддержка HD-скинов (128/256) — vanilla их отбрасывает без этого фикса',
    githubUrl: 'https://github.com/quasar-dev/quasar-launcher',
    downloadUrl: 'http://139.100.234.146:3000/api/files/quasar-skinfix-0.1.0.jar',
    fileName: 'quasar-skinfix-0.1.0.jar',
    sha256Hash: '97519e592c5f38fba98aeedaefb7ce3fce40d64eac0664545625416714c2c16b',
  },
  // Quasar Mod (auth/skin каналы) удалён: авторизация и скины теперь на
  // Yggdrasil (authlib-injector), нужен только фикс HD-скинов выше.
  {
    modType: 'OPTIONAL',
    name: 'Sodium',
    description: 'Оптимизация рендера: больше FPS на слабых машинах',
    githubUrl: 'https://github.com/CaffeineMC/sodium',
    downloadUrl:
      'https://cdn.modrinth.com/data/AANobbMI/versions/rkdTcxoT/sodium-fabric-0.8.14%2Bmc1.21.11.jar',
    fileName: 'sodium-fabric-0.8.14+mc1.21.11.jar',
    sha256Hash: 'fd2619eff5da6b9ba6304b8b72ac3fe132c30e0bd5d675e4581eda417a272f5d',
  },
  {
    modType: 'OPTIONAL',
    name: 'Mod Menu',
    description: 'Меню установленных модов прямо в игре',
    githubUrl: 'https://github.com/TerraformersMC/ModMenu',
    downloadUrl:
      'https://cdn.modrinth.com/data/mOgUt4GM/versions/j2vTurvl/modmenu-17.0.1-beta.1.jar',
    fileName: 'modmenu-17.0.1-beta.1.jar',
    sha256Hash: '38e3843946307a61adb30f9d9f6497879012d32cb8a8b179bf03c773f06dbd44',
  },
];

// Seed — источник истины: старые записи выметаем
await prisma.modManifest.deleteMany({});
for (const m of mods) {
  await prisma.modManifest.create({ data: m });
}
console.log(`[seed] OK: ${mods.length} модов с реальными SHA-256`);
await prisma.$disconnect();
