CREATE TABLE "rooms" (
	"code" text PRIMARY KEY,
	"is_playing" boolean DEFAULT true NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" serial PRIMARY KEY,
	"room_code" text NOT NULL,
	"youtube_id" text NOT NULL,
	"title" text NOT NULL,
	"singer" text DEFAULT '現場歌手' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_room_code_rooms_code_fkey" FOREIGN KEY ("room_code") REFERENCES "rooms"("code") ON DELETE CASCADE;