-- Tighten RLS on client_events to be store-scoped

-- Drop the wide-open policies (if they exist)
DROP POLICY IF EXISTS "client_events_insert_authenticated" ON public.client_events;
DROP POLICY IF EXISTS "client_events_select_authenticated" ON public.client_events;

-- Insert: must be the current user
CREATE POLICY "client_events_insert_self"
  ON public.client_events
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

-- Select: must be same store_id as user's profile
CREATE POLICY "client_events_select_same_store"
  ON public.client_events
  FOR SELECT
  TO authenticated
  USING (
    store_id IS NOT NULL
    AND store_id = (
      SELECT p.store_id
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
  );
