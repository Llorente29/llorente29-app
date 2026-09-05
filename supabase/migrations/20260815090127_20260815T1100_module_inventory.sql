-- 20260815T1100_module_inventory.sql
-- Herramienta de RECON: foto GENERADA de un módulo, no documentación escrita.
--
-- POR QUÉ EXISTE: el fallo recurrente no es falta de documentación, es afirmar
-- "no existe" sin haber mirado. En una sola sesión (15/08/2026) se dio por
-- inexistente 7 veces algo que sí estaba construido: vacations, bolsa de horas,
-- Formación, portal del empleado, menu_item_override, set_menu_item_override
-- con location_id, y las locations de HubRise. Cinco de esas siete solo vivían
-- en la BBDD — ningún manual escrito las habría cazado.
--
-- USO:  select * from module_inventory('clock|employee|vacation|shift');
--       select * from module_inventory('hubrise|external_');
--
-- La salida se PEGA en la conversación y se TIRA. No se guarda: en cuanto se
-- guarda, miente. Lo que sí se escribe a mano es el *_estado.md del módulo,
-- con las decisiones vigentes — eso no está en el código.
--
-- SECURITY INVOKER a propósito: los conteos respetan la RLS del que llama.

create or replace function public.module_inventory(p_pattern text)
returns table (
  tipo        text,
  nombre      text,
  filas       bigint,
  ultimo_dato text,
  senal       text,
  detalle     text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  r   record;
  n   bigint;
  ts  timestamptz;
  col text;
begin
  if coalesce(btrim(p_pattern), '') = '' then
    raise exception 'module_inventory: hace falta un patrón (ej. ''clock|employee|vacation'')';
  end if;

  ---------------------------------------------------------------- TABLAS
  for r in
    select c.relname::text as relname,
           c.relrowsecurity,
           (select count(*) from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) as pols,
           exists (select 1 from information_schema.columns ic
                    where ic.table_schema = 'public' and ic.table_name = c.relname
                      and ic.column_name = 'account_id') as has_acc
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r' and c.relname ~* p_pattern
     order by c.relname
  loop
    execute format('select count(*) from public.%I', r.relname) into n;

    select ic.column_name into col
      from information_schema.columns ic
     where ic.table_schema = 'public' and ic.table_name = r.relname
       and ic.data_type in ('timestamp with time zone', 'timestamp without time zone')
     order by case ic.column_name
                when 'created_at' then 1 when 'updated_at' then 2
                when 'datetime'   then 3 when 'sold_at'    then 4 else 9 end
     limit 1;

    ts := null;
    if col is not null and n > 0 then
      execute format('select max(%I)::timestamptz from public.%I', col, r.relname) into ts;
    end if;

    tipo        := 'tabla';
    nombre      := r.relname;
    filas       := n;
    ultimo_dato := coalesce(to_char(ts, 'YYYY-MM-DD'), '—');
    senal       := case
                     when n = 0 then '🔴 VACÍA — estructura sin combustible'
                     when ts is not null and ts < now() - interval '60 days'
                       then '🟠 SIN DATO RECIENTE'
                     else '✅ con dato'
                   end;
    detalle     := (case when r.has_acc then 'account_id ✓' else 'account_id ✗ (tenencia por salto)' end)
                   || ' · RLS ' || (case when r.relrowsecurity then 'on' else 'OFF 🔴' end)
                   || ' · ' || r.pols || ' pol.'
                   || (case when r.relrowsecurity and r.pols = 0 then ' 🔴 SIN POLÍTICAS' else '' end);
    return next;
  end loop;

  -------------------------------------------------------------- FUNCIONES
  for r in
    select p.proname::text as proname,
           pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef,
           has_function_privilege('anon', p.oid, 'execute') as anon_exec
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prokind = 'f' and p.proname ~* p_pattern
       and p.proname !~ '^(st_|_st_|geom|box|postgis)'
     order by p.proname
  loop
    tipo        := 'funcion';
    nombre      := r.proname || '(' || left(coalesce(r.args, ''), 70) || ')';
    filas       := null;
    ultimo_dato := '—';
    senal       := case
                     when r.prosecdef and r.anon_exec then '🔴 DEFINER ejecutable por anon'
                     when r.prosecdef                 then '🟠 DEFINER'
                     else '✅ INVOKER'
                   end;
    detalle     := '';
    return next;
  end loop;
end
$fn$;

revoke execute on function public.module_inventory(text) from anon;

do $guard$
begin
  if to_regprocedure('public.module_inventory(text)') is null then
    raise exception 'GUARD: module_inventory(text) NO quedó creada';
  end if;
end
$guard$;

notify pgrst, 'reload schema';