package dev.quasar.mod.mixin;

import net.minecraft.client.texture.NativeImage;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Vanilla 1.21.x отбрасывает HD-скины: PlayerSkinTextureDownloader.remapTexture
 * (intermediary: net.minecraft.class_10538.method_65863) принимает строго 64x64
 * (или legacy 64x32) и кидает IllegalStateException
 * «Discarding incorrectly sized (128x128) skin texture» для больших.
 *
 * Фикс: для квадратных скинов больше 64 (128/256 — UV кратны 64) возвращаем
 * изображение как есть. 64x64 и legacy обрабатывает ваниль.
 *
 * Имена в аннотациях — INTERMEDIARY (runtime-стабильные), refmap не нужен.
 */
@Mixin(targets = "net.minecraft.class_10538")
public abstract class PlayerSkinTextureDownloaderMixin {

    @Inject(method = "method_65863", at = @At("HEAD"), cancellable = true, require = 0)
    private static void quasar$allowHdSkins(NativeImage image, String url, CallbackInfoReturnable<NativeImage> cir) {
        if (image.getWidth() == image.getHeight() && image.getWidth() > 64 && image.getWidth() % 64 == 0) {
            cir.setReturnValue(image);
        }
    }
}
