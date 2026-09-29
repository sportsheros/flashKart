import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1790660013456 implements MigrationInterface {
    name = 'InitSchema1790660013456'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TYPE "public"."cart_status" AS ENUM('ACTIVE', 'CHECKED_OUT', 'EXPIRED')`);
        await queryRunner.query(`CREATE TABLE "carts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "status" "public"."cart_status" NOT NULL DEFAULT 'ACTIVE', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b5f695a59f5ebb50af3c8160816" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_carts_one_active_per_user" ON "carts" ("user_id") WHERE "status" = 'ACTIVE'`);
        await queryRunner.query(`CREATE INDEX "IDX_carts_user_status" ON "carts" ("user_id", "status") `);
        await queryRunner.query(`CREATE TYPE "public"."cart_item_status" AS ENUM('RESERVED', 'RELEASED', 'CONVERTED')`);
        await queryRunner.query(`CREATE TABLE "cart_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "cart_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" integer NOT NULL, "price_at_reservation" numeric(12,2) NOT NULL, "reservation_id" uuid NOT NULL, "reserved_until" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."cart_item_status" NOT NULL DEFAULT 'RESERVED', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_cart_items_reservation_id" UNIQUE ("reservation_id"), CONSTRAINT "CHK_cart_items_quantity_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_6fccf5ec03c172d27a28a82928b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cart_items_reserved_until" ON "cart_items" ("reserved_until") `);
        await queryRunner.query(`CREATE INDEX "IDX_cart_items_product_status" ON "cart_items" ("product_id", "status") `);
        await queryRunner.query(`CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "product_id" uuid NOT NULL, "reservation_id" uuid NOT NULL, "idempotency_key" character varying(128) NOT NULL, "quantity" integer NOT NULL, "unit_price" numeric(12,2) NOT NULL, "total_amount" numeric(12,2) NOT NULL, "status" "public"."order_status" NOT NULL DEFAULT 'PENDING', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_orders_reservation_id" UNIQUE ("reservation_id"), CONSTRAINT "UQ_orders_idempotency_key" UNIQUE ("idempotency_key"), CONSTRAINT "CHK_orders_quantity_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_orders_user_created" ON "orders" ("user_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sku" character varying(64) NOT NULL, "name" character varying(200) NOT NULL, "description" text NOT NULL DEFAULT '', "image_url" character varying(500), "price" numeric(12,2) NOT NULL, "stock" integer NOT NULL, "max_per_user" integer NOT NULL DEFAULT '1', "sale_starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "sale_ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "version" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_products_sku" UNIQUE ("sku"), CONSTRAINT "CHK_products_sale_window" CHECK ("sale_ends_at" > "sale_starts_at"), CONSTRAINT "CHK_products_stock_non_negative" CHECK ("stock" >= 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_products_sale_window" ON "products" ("sale_starts_at", "sale_ends_at") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "name" character varying(120) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_users_email" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "carts" ADD CONSTRAINT "FK_2ec1c94a977b940d85a4f498aea" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cart_items" ADD CONSTRAINT "FK_6385a745d9e12a89b859bb25623" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cart_items" ADD CONSTRAINT "FK_30e89257a105eab7648a35c7fce" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_a922b820eeef29ac1c6800e826a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_ac832121b6c331b084ecc4121fd" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_ac832121b6c331b084ecc4121fd"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_a922b820eeef29ac1c6800e826a"`);
        await queryRunner.query(`ALTER TABLE "cart_items" DROP CONSTRAINT "FK_30e89257a105eab7648a35c7fce"`);
        await queryRunner.query(`ALTER TABLE "cart_items" DROP CONSTRAINT "FK_6385a745d9e12a89b859bb25623"`);
        await queryRunner.query(`ALTER TABLE "carts" DROP CONSTRAINT "FK_2ec1c94a977b940d85a4f498aea"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_products_sale_window"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_orders_user_created"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TYPE "public"."order_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cart_items_product_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cart_items_reserved_until"`);
        await queryRunner.query(`DROP TABLE "cart_items"`);
        await queryRunner.query(`DROP TYPE "public"."cart_item_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_carts_user_status"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_carts_one_active_per_user"`);
        await queryRunner.query(`DROP TABLE "carts"`);
        await queryRunner.query(`DROP TYPE "public"."cart_status"`);
    }

}
