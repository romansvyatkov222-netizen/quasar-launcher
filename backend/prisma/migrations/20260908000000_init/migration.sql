-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ModelType" AS ENUM ('SLIM', 'CLASSIC');

-- CreateEnum
CREATE TYPE "ModType" AS ENUM ('REQUIRED', 'OPTIONAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(16) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "client_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "image_data" BYTEA NOT NULL,
    "resolution" INTEGER NOT NULL,
    "model_type" "ModelType" NOT NULL DEFAULT 'CLASSIC',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mod_manifest" (
    "id" UUID NOT NULL,
    "mod_type" "ModType" NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(512) NOT NULL,
    "github_url" TEXT NOT NULL,
    "file_name" VARCHAR(128) NOT NULL,
    "sha256_hash" VARCHAR(64) NOT NULL,

    CONSTRAINT "mod_manifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_user_id_key" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "skins_user_id_key" ON "skins"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mod_manifest_file_name_key" ON "mod_manifest"("file_name");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skins" ADD CONSTRAINT "skins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

