CREATE TABLE "workspaces" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"    text NOT NULL,
  "name"       text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "workspace_id" uuid;
--> statement-breakpoint
DELETE FROM "articles";
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "workspace_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "articles"
  ADD CONSTRAINT articles_workspace_id_fk
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "articles_workspace_id_idx" ON "articles" ("workspace_id");
