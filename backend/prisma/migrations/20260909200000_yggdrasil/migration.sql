-- CreateTable
CREATE TABLE "ygg_tokens" (
    "access_token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ygg_tokens_pkey" PRIMARY KEY ("access_token")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- Add texture hash for Yggdrasil texture URLs
ALTER TABLE "skins" ADD COLUMN "texture_hash" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "ygg_tokens_user_id_idx" ON "ygg_tokens"("user_id");

-- CreateIndex
CREATE INDEX "skins_texture_hash_idx" ON "skins"("texture_hash");

-- AddForeignKey
ALTER TABLE "ygg_tokens" ADD CONSTRAINT "ygg_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
