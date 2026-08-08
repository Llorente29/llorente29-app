-- Aplicada: 2026-08-08 por MCP.
-- El default nuevo creo una sobrecarga ambigua (4 args vs 5). Se elimina la de 4.
DROP FUNCTION IF EXISTS public.generate_week_schedule(uuid, uuid, date, text);

DO $g$ BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname='generate_week_schedule') <> 1 THEN
    RAISE EXCEPTION 'debe quedar exactamente 1 generate_week_schedule';
  END IF;
END $g$;

NOTIFY pgrst, 'reload schema';
