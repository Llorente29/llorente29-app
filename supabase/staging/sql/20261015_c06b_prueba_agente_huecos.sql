-- supabase/staging/sql/20261015_c06b_prueba_agente_huecos.sql
--
-- SOLO STAGING. Los huecos del agente «Libro diario» (scripts/conta/agente-libro.sql)
-- se cuentan desde el siguiente al último TRAÍDO de cada empresa, ejercicio y
-- serie (C06b, Julio, 15/10).
--
-- Con los tramos REALES de C0008, medidos el 15/10 en producción y en Diez
-- (run 38749518651), serie 1 de 2026:
--   traídos de Diez: 1–431 (hasta el 30/06) y 998–1800 (desde el 01/07); Diez
--   salta ahí también: entre el 432 y el 997 no tiene ninguno;
--   de Folvy: desde el 1801, seguidos.
-- Con la regla de antes, el agente contaba 566 huecos (432–997), que no son de
-- Folvy. Dentro de una transacción que acaba en ROLLBACK, en la serie 1 de la
-- empresa A de la semilla del C04:
--   1. con esos tramos, 0 huecos (y la regla de antes habría dado 566);
--   2. si Folvy se salta dos números después del último traído, el agente los
--      ve, y solo esos dos.
-- El agente es el MISMO fichero que corre cada noche, ejecutado entero con \i
-- y leído como lo lee el workflow (sin alinear y sin cabeceras): lleva \gset y
-- \if, así que no se puede pegar dentro de un «create table as».

begin;
\pset format unaligned
\pset tuples_only on

-- Los traídos se escriben como los escribe el importador: validados, con su
-- programa de origen y fuera de la cadena de Folvy. Con los disparadores
-- apagados (no es lo que se prueba: lo que se prueba es la lectura).
alter table public.journal_entry disable trigger user;
do $$
declare
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_folvy public.journal_entry;
begin
  select * into v_folvy from public.journal_entry
   where company_id = ea and series = 1 and status = 'validado' and source_type <> 'migrated'
   order by number limit 1;
  if v_folvy.id is null then raise exception 'PRUEBA huecos · 0: la empresa A no tiene ningún asiento validado en la serie 1 (¿falta la semilla del C04?).'; end if;
  if (select count(*) from public.journal_entry where company_id = ea and fiscal_year_id = v_folvy.fiscal_year_id and series = 1 and status in ('validado', 'anulado')) <> 1 then
    raise exception 'PRUEBA huecos · 0: la serie 1 de la empresa A ya no es la de la semilla (un solo asiento validado).';
  end if;

  -- El de Folvy, al 1801: el primero después del último traído.
  update public.journal_entry set number = 1801 where id = v_folvy.id;

  -- Los traídos: 1–431 y 998–1800, como en C0008.
  insert into public.journal_entry
  select (jsonb_populate_record(null::public.journal_entry, to_jsonb(v_folvy) || jsonb_build_object(
            'id', gen_random_uuid(), 'number', g, 'source_type', 'migrated', 'source_id', null,
            'external_program', 'diez', 'external_year', '2026', 'external_series', '1', 'external_number', g::text,
            'chain_seq', 1000000 + g))).*
    from generate_series(1, 1800) g
   where g <= 431 or g >= 998;
end $$;

\o /tmp/agente_huecos_con_tramos.json
\i scripts/conta/agente-libro.sql
\o
\set salida `cat /tmp/agente_huecos_con_tramos.json`
create temp table con_tramos on commit drop as select :'salida'::json j;

do $$
declare
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  j json := (select * from con_tramos);
  n int; antes int;
begin
  select count(*) into n from json_array_elements(j->'huecos') h where (h->>'company_id')::uuid = ea;
  if n <> 0 then raise exception 'PRUEBA huecos · 1: con los tramos de C0008 el agente ve % huecos en la empresa A, y son 0: %', n, j->'huecos'; end if;
  -- La misma serie con la regla de antes (desde el 1): los 566 de C0008.
  select count(*) into antes
    from generate_series(1, 1801) g
   where not exists (select 1 from public.journal_entry x where x.company_id = ea and x.series = 1 and x.number = g and x.status in ('validado', 'anulado')
                       and x.fiscal_year_id = (select fiscal_year_id from public.journal_entry where company_id = ea and series = 1 and number = 1801));
  if antes <> 566 then raise exception 'PRUEBA huecos · 1: los tramos no son los de C0008: desde el 1 faltarían %, y son 566.', antes; end if;
  raise notice 'PRUEBA huecos · 1 en verde: traídos 1–431 y 998–1800, Folvy desde el 1801: 0 huecos (la regla de antes daba %).', antes;
end $$;

-- 2 · Folvy se salta el 1801 y el 1802.
update public.journal_entry set number = 1803
 where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and series = 1 and number = 1801;

\o /tmp/agente_huecos_con_salto.json
\i scripts/conta/agente-libro.sql
\o
\set salida `cat /tmp/agente_huecos_con_salto.json`
create temp table con_salto on commit drop as select :'salida'::json j;

do $$
declare
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  j json := (select * from con_salto);
  faltan int[];
begin
  select array_agg((h->>'falta')::int order by (h->>'falta')::int) into faltan
    from json_array_elements(j->'huecos') h where (h->>'company_id')::uuid = ea;
  if faltan is distinct from array[1801, 1802] then
    raise exception 'PRUEBA huecos · 2: Folvy se ha saltado el 1801 y el 1802 y el agente ve %.', coalesce(faltan::text, 'ninguno');
  end if;
  raise notice 'PRUEBA huecos · 2 en verde: Folvy salta del último traído (1800) al 1803 y el agente ve justo el 1801 y el 1802.';
end $$;

\echo '>>> Prueba de los huecos del agente «Libro diario» en verde. ROLLBACK: no queda nada.'
rollback;
