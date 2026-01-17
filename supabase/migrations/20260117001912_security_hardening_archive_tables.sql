--- Enable RLS on archive / queue tables ---
ALTER TABLE public.daily_closeout_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickups_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_pickups_archive ENABLE ROW LEVEL SECURITY;

--- Read-only policies (authenticated users only) ---
CREATE POLICY "read_daily_closeout_queue"
  ON public.daily_closeout_queue
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "read_pickups_archive"
  ON public.pickups_archive
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "read_sales_pickups_archive"
  ON public.sales_pickups_archive
  FOR SELECT
  TO authenticated
  USING (true);

--- Lock function search_path for security ---
ALTER FUNCTION public.queue_service_closeout SET search_path = public;
ALTER FUNCTION public.queue_sales_closeout SET search_path = public;
ALTER FUNCTION public.archive_service_completed SET search_path = public;
ALTER FUNCTION public.archive_sales_completed SET search_path = public;
