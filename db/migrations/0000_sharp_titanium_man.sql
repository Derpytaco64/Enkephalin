CREATE TYPE "public"."color_axis" AS ENUM('class', 'schedule', 'tag', 'none');--> statement-breakpoint
CREATE TYPE "public"."drug_schedule" AS ENUM('CI', 'CII', 'CIII', 'CIV', 'CV');--> statement-breakpoint
CREATE TYPE "public"."field_data_type" AS ENUM('text', 'markdown', 'enum', 'list', 'number', 'bool');--> statement-breakpoint
CREATE TYPE "public"."study_direction" AS ENUM('drug_to_fields', 'fields_to_drug', 'field_to_field');--> statement-breakpoint
CREATE TYPE "public"."study_mode" AS ENUM('inclusive', 'exclusive');--> statement-breakpoint
CREATE TYPE "public"."tag_kind" AS ENUM('top_list', 'school_year', 'course', 'system', 'custom');--> statement-breakpoint
CREATE TYPE "public"."theme_pref" AS ENUM('light', 'dark', 'system');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'verified', 'flagged', 'not_applicable');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"diff" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_indications" (
	"brand_id" uuid NOT NULL,
	"indication_id" uuid NOT NULL,
	CONSTRAINT "brand_indications_brand_id_indication_id_pk" PRIMARY KEY("brand_id","indication_id")
);
--> statement-breakpoint
CREATE TABLE "drug_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drug_id" uuid NOT NULL,
	"name" text NOT NULL,
	"family" text NOT NULL,
	"route" text,
	"form" text,
	"dosing_override" text,
	"default_pairing_suspect" boolean DEFAULT false NOT NULL,
	"suspect_reason" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "drug_indications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drug_id" uuid NOT NULL,
	"text" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drug_tags" (
	"drug_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "drug_tags_drug_id_tag_id_pk" PRIMARY KEY("drug_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "drugs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"generic_name" text NOT NULL,
	"drug_class" text,
	"schedule" "drug_schedule",
	"schedule_note" text,
	"rxcui" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"needs_class_review" boolean DEFAULT false NOT NULL,
	"class_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"class_suggestion" text,
	"needs_pairing_review" boolean DEFAULT false NOT NULL,
	"source_page" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drugs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"group" text,
	"data_type" "field_data_type" DEFAULT 'markdown' NOT NULL,
	"enum_options" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"is_quizzable" boolean DEFAULT true NOT NULL,
	"default_visible" boolean DEFAULT true NOT NULL,
	"year_levels" text[] DEFAULT '{}' NOT NULL,
	"blank_means_none" boolean DEFAULT false NOT NULL,
	"prompt_template" text,
	"help_text" text,
	"lookup_mapping" jsonb,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "field_defs_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "invite_redemptions" (
	"invite_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_redemptions_invite_id_user_id_pk" PRIMARY KEY("invite_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"created_by" text,
	"note" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "lookup_cache" (
	"provider" text NOT NULL,
	"query_key" text NOT NULL,
	"response" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lookup_cache_provider_query_key_pk" PRIMARY KEY("provider","query_key")
);
--> statement-breakpoint
CREATE TABLE "quiz_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"field_key" text,
	"prompt" jsonb NOT NULL,
	"choices" jsonb NOT NULL,
	"acceptable" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen_index" integer,
	"correct_index" integer NOT NULL,
	"was_correct" boolean,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"site_name" text DEFAULT 'Enkephalin' NOT NULL,
	"registration_mode" text DEFAULT 'invite' NOT NULL,
	"default_theme" "theme_pref" DEFAULT 'system' NOT NULL,
	"default_palette" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"disclaimer_text" text DEFAULT 'Enkephalin is a study aid, not a clinical reference. Do not use it for patient care.' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"drug_id" uuid NOT NULL,
	"card_key" text NOT NULL,
	"mode" "study_mode" NOT NULL,
	"direction" "study_direction" NOT NULL,
	"field_keys" text[] NOT NULL,
	"ease" real DEFAULT 2.5 NOT NULL,
	"interval_days" real DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_result" boolean,
	"review_count" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "study_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"kind" "tag_kind" DEFAULT 'custom' NOT NULL,
	"default_color_token" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"theme" "theme_pref" DEFAULT 'system' NOT NULL,
	"color_axis" "color_axis" DEFAULT 'class' NOT NULL,
	"palette_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_visibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"study_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_indications" ADD CONSTRAINT "brand_indications_brand_id_drug_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."drug_brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_indications" ADD CONSTRAINT "brand_indications_indication_id_drug_indications_id_fk" FOREIGN KEY ("indication_id") REFERENCES "public"."drug_indications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_brands" ADD CONSTRAINT "drug_brands_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_indications" ADD CONSTRAINT "drug_indications_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_tags" ADD CONSTRAINT "drug_tags_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_tags" ADD CONSTRAINT "drug_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_presets" ADD CONSTRAINT "study_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "drug_brands_drug_idx" ON "drug_brands" USING btree ("drug_id");--> statement-breakpoint
CREATE INDEX "drug_brands_name_idx" ON "drug_brands" USING btree ("name");--> statement-breakpoint
CREATE INDEX "drug_indications_drug_idx" ON "drug_indications" USING btree ("drug_id");--> statement-breakpoint
CREATE INDEX "drugs_class_idx" ON "drugs" USING btree ("drug_class");--> statement-breakpoint
CREATE INDEX "drugs_schedule_idx" ON "drugs" USING btree ("schedule");--> statement-breakpoint
CREATE INDEX "quiz_answers_attempt_idx" ON "quiz_answers" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_user_idx" ON "quiz_attempts" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "study_cards_unique" ON "study_cards" USING btree ("user_id","drug_id","card_key");--> statement-breakpoint
CREATE INDEX "study_cards_due_idx" ON "study_cards" USING btree ("user_id","due_at");