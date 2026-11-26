-- scripts/conta/produccion/cuentas/q10c-mandar-a-cegid.sql
--
-- Q10 · Mandar a Cegid (2336) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Lo que tiene que cambiar: la tabla de lo mandado (no está → está, vacía). Lo demás, igual: lo leído de Cegid.
select clave, valor from (
  select 1 o, 'tabla de lo mandado a Cegid' clave,
    -- quieta: solo la crea esta tanda; la llena conta-cegid-mandar cuando Julio pulsa «Mandar», no el real
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'conta_cegid_incidencia')::text valor
  union all
  select 2, 'filas de lo mandado a Cegid',
    -- quieta: la tabla nace vacía; nada la escribe hasta que Julio pulse «Mandar»
    case when to_regclass('public.conta_cegid_incidencia') is null then '-'
      else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_cegid_incidencia', false, true, '')))[1]::text end
  union all
  select 3, 'quietos · clientes leídos de Cegid',
    -- quieta: solo lo cambia «Leer de Cegid», que nadie pulsa durante el real
    case when to_regclass('public.conta_cegid_cliente') is null then '-'
      else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_cegid_cliente', false, true, '')))[1]::text end
) t order by o, clave;
