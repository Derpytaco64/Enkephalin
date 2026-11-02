CREATE TABLE "dosing_regimens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drug_id" uuid NOT NULL,
	"variant_route" text DEFAULT 'standard' NOT NULL,
	"population" text DEFAULT 'adult' NOT NULL,
	"alternative" integer DEFAULT 0 NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"label" text,
	"source_text" text NOT NULL,
	"amounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"routes" text[] DEFAULT '{}' NOT NULL,
	"site" jsonb,
	"frequency" jsonb NOT NULL,
	"modifiers" text[] DEFAULT '{}' NOT NULL,
	"duration" jsonb,
	"ceiling" jsonb,
	"qualifiers" text[] DEFAULT '{}' NOT NULL,
	"status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_notes" text[] DEFAULT '{}' NOT NULL,
	"source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dosing_regimens" ADD CONSTRAINT "dosing_regimens_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dosing_regimens_drug_idx" ON "dosing_regimens" USING btree ("drug_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dosing_regimens_unique" ON "dosing_regimens" USING btree ("drug_id","variant_route","population","alternative","step");