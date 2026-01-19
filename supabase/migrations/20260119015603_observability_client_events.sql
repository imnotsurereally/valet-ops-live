-- Create centralized client event/error log table
create table if not exists public.client_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  store_id uuid null,
  actor_user_id uuid null,
  page text null,
  role text null,
  level text not null default 'info', -- info|warn|error
  event_type text not null,           -- page_load|js_error|unhandled_rejection|write_fail|custom
  message text null,
  stack text null,
  context jsonb not null default '{}'::jsonb
);

alter table public.client_events enable row level security;

-- Allow authenticated users to insert logs
create policy "client_events_insert_authenticated"
  on public.client_events
  for insert
  to authenticated
  with check (true);

-- Allow authenticated users to read logs (internal tool). If you want tighter later, we will restrict.
create policy "client_events_select_authenticated"
  on public.client_events
  for select
  to authenticated
  using (true);
