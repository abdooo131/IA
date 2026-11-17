-- Forecast (Accounting > Planning): named scenarios of the next 12 Cairo months, their
-- drivers per month and the profit and loss lines set by hand.

-- CreateEnum
CREATE TYPE "ForecastStatus" AS ENUM ('draft', 'approved');

-- CreateTable
CREATE TABLE "forecasts" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ForecastStatus" NOT NULL DEFAULT 'draft',
    "start_month" TEXT NOT NULL,
    "based_on_from" TEXT,
    "based_on_to" TEXT,
    "opening" JSONB NOT NULL,
    "copied_from_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_drivers" (
    "id" TEXT NOT NULL,
    "forecast_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_overrides" (
    "id" TEXT NOT NULL,
    "forecast_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "line_key" TEXT NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "note" TEXT,
    "updated_by_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forecasts_number_key" ON "forecasts"("number");

-- CreateIndex
CREATE UNIQUE INDEX "forecast_drivers_forecast_id_month_key_key" ON "forecast_drivers"("forecast_id", "month", "key");

-- CreateIndex
CREATE UNIQUE INDEX "forecast_overrides_forecast_id_month_line_key_key" ON "forecast_overrides"("forecast_id", "month", "line_key");

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_copied_from_id_fkey" FOREIGN KEY ("copied_from_id") REFERENCES "forecasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_drivers" ADD CONSTRAINT "forecast_drivers_forecast_id_fkey" FOREIGN KEY ("forecast_id") REFERENCES "forecasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_drivers" ADD CONSTRAINT "forecast_drivers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_forecast_id_fkey" FOREIGN KEY ("forecast_id") REFERENCES "forecasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_overrides" ADD CONSTRAINT "forecast_overrides_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

