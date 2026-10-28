-- scripts/conta/produccion/cuentas/s02-modelo-190.sql
--
-- S02 · LO QUE CUENTA LA TANDA DEL 190, antes y después. SOLO LEE. Recuentos
-- de Foodint (regla 9), sin nombres, NIF, CSV ni importes.
--
-- Lo que tiene que pasar: las funciones conta_impuesto_* suben 4 (de N a
-- N+4); las claves del CHECK de lo comprobado, de 14 a 17; las declaraciones
-- de Foodint de antes del corte, igual (la tanda no calcula nada); ningún 190.
-- Lo comprobado (tax_return_check) no se cuenta: no tiene fecha y se rehace
-- entero en cada cálculo de cualquier declaración, así que crece solo (#241).
select clave, valor from (
  select 1 o, 'funciones conta_impuesto_*' clave,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'conta\_impuesto\_%')::text valor union all
  select 2, 'las cuatro del 190 (calcular / anual / fuera / fichero)',
    concat_ws(' / ', (to_regprocedure('public.conta_impuesto_190_calcular(uuid,int)') is not null)::text,
                     (to_regprocedure('public.conta_impuesto_anual(uuid,int)') is not null)::text,
                     (to_regprocedure('public.conta_impuesto_informativa_fuera(uuid,text,int,text,date,text)') is not null)::text,
                     (to_regprocedure('public.conta_impuesto_190_fichero(uuid,uuid)') is not null)::text) union all
  select 3, 'claves del CHECK de tax_return_check',
    (select (length(d) - length(replace(d, '''::text', ''))) / length('''::text') from (select pg_get_constraintdef(oid) d from pg_constraint where conname = 'tax_return_check_check_key_check') x)::text union all
  select 4, 'declaraciones de Foodint (todas / 190)',
    (select count(*) || ' / ' || count(*) filter (where form_code = '190') from public.tax_return
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-28 19:00:00+00')
) q order by o;
