-- scripts/conta/produccion/cuentas/q10h-corregir-incidencias.sql
--
-- Q10 · respuesta 6 (2200) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Lo que tiene que cambiar: las cuotas revisadas (no está → está, con 190 filas) y las columnas de lo corregido (no
-- están → están). Lo demás, igual: lo mandado a Cegid y los clientes de Cegid leídos.
select clave, valor from (
  select 1 o, 'cuotas fijas revisadas' clave,
    -- quieta: la tabla nace con la 2200 y solo la escribe ella
    case when to_regclass('public.conta_cegid_cuota_revisada') is null then '-'
      else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_cegid_cuota_revisada', false, true, '')))[1]::text end valor
  union all
  select 2, 'columnas de lo corregido',
    -- quieta: solo las añade la 2200
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'conta_cegid_incidencia' and column_name in ('corregida_at', 'corregida_por'))::text
  union all
  select 3, 'quietos · incidencias mandadas de QBO',
    -- quieta: solo las escribe «Mandar a Cegid», que nadie pulsa durante el real
    (select count(*) || ' · ' || coalesce(md5(string_agg(id::text || '=' || estado, '|' order by id)), '-') from public.conta_cegid_incidencia where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4')
  union all
  select 4, 'quietos · clientes de Cegid de QBO con cuotas fijas',
    -- quieta: solo la escribe «Leer de Cegid», que nadie pulsa durante el real
    (select count(*) from public.conta_cegid_cliente where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and jsonb_array_length(coalesce(conceptos, '[]')) > 0)::text
) t order by o, clave;
