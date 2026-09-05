-- 0901 — retira la escritura de last_seen_at de las 13 funciones de LECTURA.
-- VERSION GENERATIVA: toma la definicion VIVA de produccion (pg_get_functiondef),
-- le quita UNICAMENTE la sentencia del latido, y la reescribe. Cero transcripcion.
-- Preserva atributos (SECURITY DEFINER, search_path, volatilidad, coste) porque
-- vienen dentro de pg_get_functiondef; preserva GRANTs y owner por ser REPLACE.
-- Aplicada: 11/08/2026 por MCP, servicio cerrado, con las 3 tablets ya latiendo
-- por kds_heartbeat (bundle 113).

-- 0) Guarda previa
do $guard$
begin
  if not exists (select 1 from pg_proc
                 where pronamespace='public'::regnamespace and proname='kds_heartbeat') then
    raise exception '0901: falta kds_heartbeat — aplica antes la 0900';
  end if;
end;
$guard$;

-- 1) Backup del estado de HOY (red de reversion al punto actual)
drop table if exists public._backup_kds_fn_20260811_pre0901;
create table public._backup_kds_fn_20260811_pre0901 as
select p.oid::regprocedure::text as firma,
       pg_get_functiondef(p.oid)  as def_pre0901,
       now()                      as guardado_en
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosrc ~ 'update\s+(?:public\.)?kds_device\s+set\s+last_seen_at'
  and p.proname <> 'kds_heartbeat';

do $chk$
declare v_n int;
begin
  select count(*) into v_n from public._backup_kds_fn_20260811_pre0901;
  if v_n <> 13 then
    raise exception '0901: el backup previo guardo % filas, se esperaban 13 — parar', v_n;
  end if;
end;
$chk$;

-- 2) Retirar el latido de las 13, generando desde lo vivo
do $mig$
declare
  r      record;
  v_def  text;
  v_frag text;
  v_new  text;
  v_n    int := 0;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ 'update\s+(?:public\.)?kds_device\s+set\s+last_seen_at'
      and p.proname <> 'kds_heartbeat'
    order by p.proname
  loop
    v_def  := pg_get_functiondef(r.oid);
    v_frag := substring(v_def from 'update\s+(?:public\.)?kds_device\s+set\s+last_seen_at[^;]*;');

    if v_frag is null then
      raise exception '0901: no se localizo el latido en % — parar sin tocar nada', r.proname;
    end if;

    v_new := replace(v_def, v_frag, '');

    if length(v_new) <> length(v_def) - length(v_frag) then
      raise exception '0901: sustitucion multiple o inesperada en % — parar', r.proname;
    end if;
    if v_new ~ 'update\s+(?:public\.)?kds_device\s+set\s+last_seen_at' then
      raise exception '0901: queda una escritura de latido en % — parar', r.proname;
    end if;

    execute v_new;
    v_n := v_n + 1;
  end loop;

  if v_n <> 13 then
    raise exception '0901: se procesaron % funciones, se esperaban 13 — parar', v_n;
  end if;
end;
$mig$;

-- 3) Verificacion embebida: deben quedar exactamente 3 escritores
do $ver$
declare v_writers int; v_quienes text;
begin
  select count(*), string_agg(p.proname, ', ' order by p.proname)
    into v_writers, v_quienes
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ~* 'update\s+(?:public\.)?kds_device';

  if v_writers <> 3 then
    raise exception '0901: % funciones escriben kds_device (se esperaban 3): %', v_writers, v_quienes;
  end if;
end;
$ver$;

notify pgrst, 'reload schema';