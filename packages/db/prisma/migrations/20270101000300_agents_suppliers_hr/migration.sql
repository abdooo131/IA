-- Agents are suppliers (their settlement becomes a supplier bill) and couriers and hub staff
-- get HR files placed at their Shiply hub (docs/MERGE.md step 6).
-- AlterTable
ALTER TABLE "agent_settlements" ADD COLUMN     "bill_id" TEXT;

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "supplier_id" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "hub_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "agent_settlements_bill_id_key" ON "agent_settlements"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_supplier_id_key" ON "agents"("supplier_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_settlements" ADD CONSTRAINT "agent_settlements_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE INDEX "employees_hub_id_idx" ON "employees"("hub_id");
