CREATE TABLE "vollos"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar(100) NOT NULL,
	"lead_id" uuid,
	"metadata" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vollos"."leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"source" varchar(50),
	"product_source" varchar(50) DEFAULT 'vollos' NOT NULL,
	"product_slug" varchar(100),
	"consent_given" boolean DEFAULT false NOT NULL,
	"company" varchar(255),
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"consent_given_at" timestamp with time zone,
	"consent_revoked_at" timestamp with time zone,
	"consent_version" varchar(50),
	"deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now(),
	"data_expires_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	CONSTRAINT "leads_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "vollos"."audit_logs" ADD CONSTRAINT "audit_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "vollos"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_lead_id_idx" ON "vollos"."audit_logs" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "vollos"."audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "vollos"."audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "vollos"."leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_deleted_at_idx" ON "vollos"."leads" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "leads_product_slug_idx" ON "vollos"."leads" USING btree ("product_slug");--> statement-breakpoint
CREATE INDEX "leads_source_idx" ON "vollos"."leads" USING btree ("source");--> statement-breakpoint
CREATE INDEX "leads_product_source_idx" ON "vollos"."leads" USING btree ("product_source");