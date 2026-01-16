


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."archive_sales_completed"("p_store_id" "uuid", "p_day" "date") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
  start_ts timestamptz := (p_day::timestamptz);
  end_ts   timestamptz := (p_day::timestamptz + interval '1 day');
  moved int := 0;
begin
  insert into public.sales_pickups_archive
  select *
  from public.sales_pickups
  where store_id = p_store_id
    and (status = 'COMPLETED' or status = 'CANCELLED')
    and coalesce(completed_at, cancelled_at) >= start_ts
    and coalesce(completed_at, cancelled_at) < end_ts;

  get diagnostics moved = row_count;

  delete from public.sales_pickups
  where store_id = p_store_id
    and (status = 'COMPLETED' or status = 'CANCELLED')
    and coalesce(completed_at, cancelled_at) >= start_ts
    and coalesce(completed_at, cancelled_at) < end_ts;

  return moved;
end $$;


ALTER FUNCTION "public"."archive_sales_completed"("p_store_id" "uuid", "p_day" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_service_completed"("p_store_id" "uuid", "p_day" "date") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
  start_ts timestamptz := (p_day::timestamptz);
  end_ts   timestamptz := (p_day::timestamptz + interval '1 day');
  moved int := 0;
begin
  insert into public.pickups_archive
  select *
  from public.pickups
  where store_id = p_store_id
    and status = 'COMPLETE'
    and completed_at >= start_ts
    and completed_at < end_ts;

  get diagnostics moved = row_count;

  delete from public.pickups
  where store_id = p_store_id
    and status = 'COMPLETE'
    and completed_at >= start_ts
    and completed_at < end_ts;

  return moved;
end $$;


ALTER FUNCTION "public"."archive_service_completed"("p_store_id" "uuid", "p_day" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.role
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1
$$;


ALTER FUNCTION "public"."current_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_store_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.store_id
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1
$$;


ALTER FUNCTION "public"."current_store_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_manager_or_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(public.current_role() in ('owner','manager'), false)
$$;


ALTER FUNCTION "public"."is_manager_or_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_sales_closeout"("p_store_id" "uuid", "p_day" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  start_ts timestamptz := (p_day::timestamptz);
  end_ts   timestamptz := (p_day::timestamptz + interval '1 day');
  rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(s) order by coalesce(s.completed_at, s.cancelled_at) asc), '[]'::jsonb)
    into rows
  from public.sales_pickups s
  where s.store_id = p_store_id
    and (s.status = 'COMPLETED' or s.status = 'CANCELLED')
    and coalesce(s.completed_at, s.cancelled_at) >= start_ts
    and coalesce(s.completed_at, s.cancelled_at) < end_ts;

  insert into public.daily_closeout_queue(store_id, closeout_type, closeout_day, payload)
  values (p_store_id, 'sales', p_day, jsonb_build_object(
    'store_id', p_store_id,
    'day', p_day,
    'count', jsonb_array_length(rows),
    'rows', rows
  ));
end $$;


ALTER FUNCTION "public"."queue_sales_closeout"("p_store_id" "uuid", "p_day" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_service_closeout"("p_store_id" "uuid", "p_day" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  start_ts timestamptz := (p_day::timestamptz);
  end_ts   timestamptz := (p_day::timestamptz + interval '1 day');
  rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(p) order by p.completed_at asc), '[]'::jsonb)
    into rows
  from public.pickups p
  where p.store_id = p_store_id
    and p.status = 'COMPLETE'
    and p.completed_at >= start_ts
    and p.completed_at < end_ts;

  insert into public.daily_closeout_queue(store_id, closeout_type, closeout_day, payload)
  values (p_store_id, 'service', p_day, jsonb_build_object(
    'store_id', p_store_id,
    'day', p_day,
    'count', jsonb_array_length(rows),
    'rows', rows
  ));
end $$;


ALTER FUNCTION "public"."queue_service_closeout"("p_store_id" "uuid", "p_day" "date") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."daily_closeout_queue" (
    "id" bigint NOT NULL,
    "store_id" "uuid" NOT NULL,
    "closeout_type" "text" NOT NULL,
    "closeout_day" "date" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone
);


ALTER TABLE "public"."daily_closeout_queue" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."daily_closeout_queue_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."daily_closeout_queue_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."daily_closeout_queue_id_seq" OWNED BY "public"."daily_closeout_queue"."id";



CREATE TABLE IF NOT EXISTS "public"."pickup_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pickup_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pickup_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pickups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid" NOT NULL,
    "tag_number" "text" NOT NULL,
    "customer_name" "text" NOT NULL,
    "status" "text" DEFAULT 'NEW'::"text" NOT NULL,
    "wash_status" "text" DEFAULT 'UNKNOWN'::"text" NOT NULL,
    "keys_holder" "text" DEFAULT 'UNKNOWN'::"text",
    "notes" "text",
    "notes_updated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "active_started_at" timestamp with time zone,
    "keys_at_machine_at" timestamp with time zone,
    "wash_status_at" timestamp with time zone,
    "keys_with_valet_at" timestamp with time zone,
    "waiting_client_at" timestamp with time zone,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."pickups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pickups_archive" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid" NOT NULL,
    "tag_number" "text" NOT NULL,
    "customer_name" "text" NOT NULL,
    "status" "text" DEFAULT 'NEW'::"text" NOT NULL,
    "wash_status" "text" DEFAULT 'UNKNOWN'::"text" NOT NULL,
    "keys_holder" "text" DEFAULT 'UNKNOWN'::"text",
    "notes" "text",
    "notes_updated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "active_started_at" timestamp with time zone,
    "keys_at_machine_at" timestamp with time zone,
    "wash_status_at" timestamp with time zone,
    "keys_with_valet_at" timestamp with time zone,
    "waiting_client_at" timestamp with time zone,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."pickups_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "display_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "operational_role" "text",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'manager'::"text", 'dispatcher'::"text", 'keymachine'::"text", 'carwash'::"text", 'wallboard'::"text", 'serviceadvisor'::"text", 'loancar'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_pickup_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sales_pickup_id" "uuid" NOT NULL,
    "store_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sales_pickup_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_pickups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid" NOT NULL,
    "stock_number" "text" NOT NULL,
    "salesperson_name" "text" NOT NULL,
    "status" "text" DEFAULT 'REQUESTED'::"text" NOT NULL,
    "driver_name" "text",
    "notes" "text",
    "notes_updated_at" timestamp with time zone,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "on_the_way_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancel_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_pickups_cancel_reason_check" CHECK (("cancel_reason" = ANY (ARRAY['SWITCHED_STOCK'::"text", 'WRONG_STOCK'::"text", 'AT_MARRIOTT'::"text", 'AT_ARMSTRONG'::"text", 'OTHER'::"text"]))),
    CONSTRAINT "sales_pickups_status_check" CHECK (("status" = ANY (ARRAY['REQUESTED'::"text", 'ON_THE_WAY'::"text", 'COMPLETE'::"text", 'CANCELLED'::"text"])))
);


ALTER TABLE "public"."sales_pickups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_pickups_archive" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid" NOT NULL,
    "stock_number" "text" NOT NULL,
    "salesperson_name" "text" NOT NULL,
    "status" "text" DEFAULT 'REQUESTED'::"text" NOT NULL,
    "driver_name" "text",
    "notes" "text",
    "notes_updated_at" timestamp with time zone,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "on_the_way_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancel_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_pickups_cancel_reason_check" CHECK (("cancel_reason" = ANY (ARRAY['SWITCHED_STOCK'::"text", 'WRONG_STOCK'::"text", 'AT_MARRIOTT'::"text", 'AT_ARMSTRONG'::"text", 'OTHER'::"text"]))),
    CONSTRAINT "sales_pickups_status_check" CHECK (("status" = ANY (ARRAY['REQUESTED'::"text", 'ON_THE_WAY'::"text", 'COMPLETE'::"text", 'CANCELLED'::"text"])))
);


ALTER TABLE "public"."sales_pickups_archive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."store_settings" (
    "store_id" "uuid" NOT NULL,
    "valet_names" "jsonb" DEFAULT '["Fernando", "Juan", "Miguel", "Maria", "Helper"]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "salespeople" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "drivers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "carwash_manager_phone" "text"
);


ALTER TABLE "public"."store_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stores" OWNER TO "postgres";


ALTER TABLE ONLY "public"."daily_closeout_queue" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."daily_closeout_queue_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."daily_closeout_queue"
    ADD CONSTRAINT "daily_closeout_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pickup_events"
    ADD CONSTRAINT "pickup_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pickups_archive"
    ADD CONSTRAINT "pickups_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pickups"
    ADD CONSTRAINT "pickups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."sales_pickup_events"
    ADD CONSTRAINT "sales_pickup_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_pickups_archive"
    ADD CONSTRAINT "sales_pickups_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_pickups"
    ADD CONSTRAINT "sales_pickups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."store_settings"
    ADD CONSTRAINT "store_settings_pkey" PRIMARY KEY ("store_id");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_pkey" PRIMARY KEY ("id");



CREATE INDEX "daily_closeout_queue_idx" ON "public"."daily_closeout_queue" USING "btree" ("store_id", "closeout_day", "closeout_type");



CREATE INDEX "idx_pickups_store_created" ON "public"."pickups" USING "btree" ("store_id", "created_at" DESC);



CREATE INDEX "idx_pickups_store_status" ON "public"."pickups" USING "btree" ("store_id", "status");



CREATE INDEX "pickup_events_pickup_id_idx" ON "public"."pickup_events" USING "btree" ("pickup_id", "created_at" DESC);



CREATE INDEX "pickup_events_store_id_idx" ON "public"."pickup_events" USING "btree" ("store_id", "created_at" DESC);



CREATE INDEX "pickups_archive_store_completed_idx" ON "public"."pickups_archive" USING "btree" ("store_id", "completed_at");



CREATE INDEX "pickups_archive_store_id_created_at_idx" ON "public"."pickups_archive" USING "btree" ("store_id", "created_at" DESC);



CREATE INDEX "pickups_archive_store_id_status_idx" ON "public"."pickups_archive" USING "btree" ("store_id", "status");



CREATE INDEX "sales_pickup_events_pickup_id_idx" ON "public"."sales_pickup_events" USING "btree" ("sales_pickup_id", "created_at" DESC);



CREATE INDEX "sales_pickup_events_store_id_idx" ON "public"."sales_pickup_events" USING "btree" ("store_id", "created_at" DESC);



CREATE INDEX "sales_pickups_archive_store_completed_idx" ON "public"."sales_pickups_archive" USING "btree" ("store_id", "completed_at");



CREATE INDEX "sales_pickups_archive_store_id_status_requested_at_idx" ON "public"."sales_pickups_archive" USING "btree" ("store_id", "status", "requested_at" DESC);



CREATE UNIQUE INDEX "sales_pickups_archive_store_id_stock_number_idx" ON "public"."sales_pickups_archive" USING "btree" ("store_id", "stock_number") WHERE ("status" = ANY (ARRAY['REQUESTED'::"text", 'ON_THE_WAY'::"text"]));



CREATE INDEX "sales_pickups_store_status_idx" ON "public"."sales_pickups" USING "btree" ("store_id", "status", "requested_at" DESC);



CREATE UNIQUE INDEX "sales_pickups_store_stock_active_uniq" ON "public"."sales_pickups" USING "btree" ("store_id", "stock_number") WHERE ("status" = ANY (ARRAY['REQUESTED'::"text", 'ON_THE_WAY'::"text"]));



ALTER TABLE ONLY "public"."pickup_events"
    ADD CONSTRAINT "pickup_events_pickup_id_fkey" FOREIGN KEY ("pickup_id") REFERENCES "public"."pickups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pickup_events"
    ADD CONSTRAINT "pickup_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pickups"
    ADD CONSTRAINT "pickups_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_pickup_events"
    ADD CONSTRAINT "sales_pickup_events_sales_pickup_id_fkey" FOREIGN KEY ("sales_pickup_id") REFERENCES "public"."sales_pickups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_pickup_events"
    ADD CONSTRAINT "sales_pickup_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_pickups"
    ADD CONSTRAINT "sales_pickups_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."store_settings"
    ADD CONSTRAINT "store_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE "public"."pickup_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pickup_events_insert_demo" ON "public"."pickup_events" FOR INSERT TO "authenticated" WITH CHECK (("store_id" = "public"."current_store_id"()));



CREATE POLICY "pickup_events_insert_store" ON "public"."pickup_events" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "pickup_events"."store_id")))));



CREATE POLICY "pickup_events_select_store" ON "public"."pickup_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "pickup_events"."store_id")))));



ALTER TABLE "public"."pickups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pickups_delete_manager" ON "public"."pickups" FOR DELETE TO "authenticated" USING ((("store_id" = "public"."current_store_id"()) AND "public"."is_manager_or_owner"()));



CREATE POLICY "pickups_insert_store" ON "public"."pickups" FOR INSERT TO "authenticated" WITH CHECK (("store_id" = "public"."current_store_id"()));



CREATE POLICY "pickups_select_store" ON "public"."pickups" FOR SELECT TO "authenticated" USING (("store_id" = "public"."current_store_id"()));



CREATE POLICY "pickups_update_by_store" ON "public"."pickups" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "pickups"."store_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "pickups"."store_id")))));



CREATE POLICY "pickups_update_demo" ON "public"."pickups" FOR UPDATE TO "authenticated" USING (("store_id" = "public"."current_store_id"())) WITH CHECK (("store_id" = "public"."current_store_id"()));



CREATE POLICY "pickups_update_store" ON "public"."pickups" FOR UPDATE TO "authenticated" USING (("store_id" = "public"."current_store_id"())) WITH CHECK (("store_id" = "public"."current_store_id"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_self" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "profiles_update_self" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."sales_pickup_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_pickup_events_insert_demo" ON "public"."sales_pickup_events" FOR INSERT TO "authenticated" WITH CHECK (("store_id" = "public"."current_store_id"()));



CREATE POLICY "sales_pickup_events_insert_store" ON "public"."sales_pickup_events" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "sales_pickup_events"."store_id") AND ("p"."role" = ANY (ARRAY['owner'::"text", 'gm'::"text", 'sales_manager'::"text", 'driver'::"text"]))))));



CREATE POLICY "sales_pickup_events_select_store" ON "public"."sales_pickup_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "sales_pickup_events"."store_id") AND ("p"."role" = ANY (ARRAY['owner'::"text", 'gm'::"text", 'sales_manager'::"text", 'driver'::"text"]))))));



ALTER TABLE "public"."sales_pickups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_pickups_insert_store" ON "public"."sales_pickups" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "sales_pickups"."store_id") AND ("p"."role" = ANY (ARRAY['owner'::"text", 'gm'::"text", 'sales_manager'::"text"]))))));



CREATE POLICY "sales_pickups_select_store" ON "public"."sales_pickups" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "sales_pickups"."store_id") AND ("p"."role" = ANY (ARRAY['owner'::"text", 'gm'::"text", 'sales_manager'::"text", 'driver'::"text"]))))));



CREATE POLICY "sales_pickups_update_demo" ON "public"."sales_pickups" FOR UPDATE TO "authenticated" USING (("store_id" = "public"."current_store_id"())) WITH CHECK (("store_id" = "public"."current_store_id"()));



CREATE POLICY "sales_pickups_update_store" ON "public"."sales_pickups" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "sales_pickups"."store_id") AND ("p"."role" = ANY (ARRAY['owner'::"text", 'gm'::"text", 'sales_manager'::"text", 'driver'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "sales_pickups"."store_id") AND ("p"."role" = ANY (ARRAY['owner'::"text", 'gm'::"text", 'sales_manager'::"text", 'driver'::"text"]))))));



ALTER TABLE "public"."store_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "store_settings insert (mgr/owner)" ON "public"."store_settings" FOR INSERT WITH CHECK (("public"."is_manager_or_owner"() AND ("store_id" = "public"."current_store_id"())));



CREATE POLICY "store_settings read" ON "public"."store_settings" FOR SELECT USING (("store_id" = "public"."current_store_id"()));



CREATE POLICY "store_settings update (mgr/owner)" ON "public"."store_settings" FOR UPDATE USING (("public"."is_manager_or_owner"() AND ("store_id" = "public"."current_store_id"()))) WITH CHECK (("public"."is_manager_or_owner"() AND ("store_id" = "public"."current_store_id"())));



CREATE POLICY "store_settings_select_by_store" ON "public"."store_settings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."user_id" = "auth"."uid"()) AND ("p"."store_id" = "store_settings"."store_id")))));



ALTER TABLE "public"."stores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stores read" ON "public"."stores" FOR SELECT USING (("id" = "public"."current_store_id"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."pickups";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."archive_sales_completed"("p_store_id" "uuid", "p_day" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."archive_sales_completed"("p_store_id" "uuid", "p_day" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_sales_completed"("p_store_id" "uuid", "p_day" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."archive_service_completed"("p_store_id" "uuid", "p_day" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."archive_service_completed"("p_store_id" "uuid", "p_day" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_service_completed"("p_store_id" "uuid", "p_day" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_store_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_store_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_store_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_manager_or_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_manager_or_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_manager_or_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_sales_closeout"("p_store_id" "uuid", "p_day" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_sales_closeout"("p_store_id" "uuid", "p_day" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_sales_closeout"("p_store_id" "uuid", "p_day" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_service_closeout"("p_store_id" "uuid", "p_day" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."queue_service_closeout"("p_store_id" "uuid", "p_day" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."queue_service_closeout"("p_store_id" "uuid", "p_day" "date") TO "service_role";


















GRANT ALL ON TABLE "public"."daily_closeout_queue" TO "anon";
GRANT ALL ON TABLE "public"."daily_closeout_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_closeout_queue" TO "service_role";



GRANT ALL ON SEQUENCE "public"."daily_closeout_queue_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."daily_closeout_queue_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."daily_closeout_queue_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pickup_events" TO "anon";
GRANT ALL ON TABLE "public"."pickup_events" TO "authenticated";
GRANT ALL ON TABLE "public"."pickup_events" TO "service_role";



GRANT ALL ON TABLE "public"."pickups" TO "anon";
GRANT ALL ON TABLE "public"."pickups" TO "authenticated";
GRANT ALL ON TABLE "public"."pickups" TO "service_role";



GRANT ALL ON TABLE "public"."pickups_archive" TO "anon";
GRANT ALL ON TABLE "public"."pickups_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."pickups_archive" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."sales_pickup_events" TO "anon";
GRANT ALL ON TABLE "public"."sales_pickup_events" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_pickup_events" TO "service_role";



GRANT ALL ON TABLE "public"."sales_pickups" TO "anon";
GRANT ALL ON TABLE "public"."sales_pickups" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_pickups" TO "service_role";



GRANT ALL ON TABLE "public"."sales_pickups_archive" TO "anon";
GRANT ALL ON TABLE "public"."sales_pickups_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_pickups_archive" TO "service_role";



GRANT ALL ON TABLE "public"."store_settings" TO "anon";
GRANT ALL ON TABLE "public"."store_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."store_settings" TO "service_role";



GRANT ALL ON TABLE "public"."stores" TO "anon";
GRANT ALL ON TABLE "public"."stores" TO "authenticated";
GRANT ALL ON TABLE "public"."stores" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


