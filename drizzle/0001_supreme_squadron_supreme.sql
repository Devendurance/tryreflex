ALTER TABLE "trades" ALTER COLUMN "quantity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "entry_price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "opened_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_bitget_execution_required" CHECK (provider <> 'bitget' OR (quantity IS NOT NULL AND entry_price IS NOT NULL AND opened_at IS NOT NULL));