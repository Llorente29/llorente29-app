-- scripts/conta/produccion/cuentas/b02-entrada.sql
--
-- B02 · LO QUE CUENTA LA TANDA DE «LO QUE ENTRA» (T1 0200 y T2 0201), antes y
-- después. SOLO LEE. Las columnas nuevas se leen por to_jsonb: así la consulta
-- vale con ellas y sin ellas (antes de la tanda y tras la vuelta atrás).
-- TABLA ENTERA, a propósito y dicho (regla 9).
select clave, valor from (
  select 1 o, 'columnas counterparty y movement_type' clave,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bank_movement'
            and column_name in ('counterparty', 'movement_type'))::text valor union all
  select 2, 'funciones bank_facturas_para_casar y _bank_contraparte_limpia',
         ((to_regprocedure('public.bank_facturas_para_casar(uuid)') is not null)::int + (to_regprocedure('public._bank_contraparte_limpia(text)') is not null)::int)::text union all
  select 3, 'huella de bank_casar', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)')) union all
  select 4, 'huella de bank_importar', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)')) union all
  select 5, 'movimientos (todas las cuentas)', (select count(*) from public.bank_movement)::text union all
  select 6, 'movimientos con tipo (todas las cuentas)', (select count(*) from public.bank_movement m where to_jsonb(m)->>'movement_type' is not null)::text union all
  select 7, 'movimientos con contraparte (todas las cuentas)', (select count(*) from public.bank_movement m where to_jsonb(m)->>'counterparty' is not null)::text union all
  select 8, 'casados vivos (todas las cuentas)', (select count(*) from public.bank_match where status = 'vivo')::text
) t order by o;
