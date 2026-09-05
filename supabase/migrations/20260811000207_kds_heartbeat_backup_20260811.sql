create table if not exists public._backup_kds_fn_20260811 as
select p.oid::regprocedure::text as firma,
       pg_get_functiondef(p.oid) as def_original,
       now() as guardado_en
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prosrc like '%update kds_device set last_seen_at = now() where id = v_device.id;%';