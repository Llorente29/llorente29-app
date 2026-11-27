-- scripts/conta/produccion/cuentas/q10i-banco-a-cegid.sql
--
-- Q10 · respuesta 7 (0730) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Lo que tiene que cambiar: las columnas del origen de cada incidencia (0 → 3) y la tabla de decisiones (no está →
-- está, con las 2 de la 0731). Lo demás, igual: lo mandado a Cegid y los cobros del banco de QBO.
select clave, valor from (
  select 1 o, 'columnas del origen de cada incidencia' clave,
    -- quieta: solo las añade la 0730
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name in ('movement_id', 'origen_clave', 'parte'))::text valor
  union all
  select 2, 'decisiones de los cobros del banco',
    -- quieta: la tabla nace con la 0730 y solo la escribe conta_banco_decidir, que nadie pulsa durante el real
    case when to_regclass('public.conta_banco_decision') is null then '-'
      else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_banco_decision', false, true, '')))[1]::text end
  union all
  select 3, 'quietos · incidencias mandadas de QBO',
    -- quieta: solo las escribe «Mandar a Cegid», que nadie pulsa durante el real
    (select count(*) || ' · ' || coalesce(md5(string_agg(id::text || '=' || estado, '|' order by id)), '-') from public.conta_cegid_incidencia where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4')
  union all
  select 4, 'quietos · cobros del banco de QBO de noviembre',
    -- quieta: la tanda no los toca; los escribe el casado del banco, que no corre durante el real
    (select count(*) || ' · ' || coalesce(sum(importe), 0)::text from public.conta_banco_cobro where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and mes = date '2026-11-01')
) t order by o, clave;
