-- scripts/conta/produccion/cuentas/v01-liquidaciones.sql
--
-- V01 (24/10) · LO QUE CUENTA LA TANDA DE LAS LIQUIDACIONES, antes y después.
-- SOLO LEE. TABLA ENTERA, a propósito y dicho (regla 9): la 1650 no toca datos
-- de ninguna cuenta; se mide que las liquidaciones, el libro y los avisos del
-- C11b siguen igual. La 2031 sí: pone el local a las tiendas que no lo tienen,
-- por su dirección (medido el 24/10: 9 tiendas de Uber de Foodint sin local, 9
-- casan: 7 Alcalá y 2 Carabanchel).
--
-- Después del real: lo mismo que antes; lo resuelto, a cero (nadie ha resuelto
-- aún ninguna diferencia); las tiendas sin local, de 9 a 0, y la copia previa
-- con esas 9.
select clave, valor from (
  select 1 o, 'asientos' clave, (select count(*) from public.journal_entry)::text valor union all
  select 2, 'liquidaciones de plataforma', (select count(*) from public.channel_settlement)::text union all
  select 3, 'liquidaciones de socios', (select count(*) from public.licensed_settlement)::text union all
  select 4, 'descartes del libro', (select count(*) from public.journal_dismissal)::text union all
  select 5, 'diferencias resueltas', (case when to_regclass('public.conta_liquidacion_resolucion') is null then 'sin tabla'
                                   else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_liquidacion_resolucion', false, true, '')))[1]::text end) union all
  select 6, 'tiendas de plataforma', (select count(*) from public.platform_store)::text union all
  select 7, 'tiendas sin local', (select count(*) from public.platform_store where location_id is null)::text union all
  select 8, 'tiendas con local, por local', (select coalesce(string_agg(l.name || ': ' || n, ' · ' order by l.name), 'ninguna')
                                                 from (select location_id, count(*) n from public.platform_store where location_id is not null group by 1) x
                                                 join public.locations l on l.id = x.location_id) union all
  select 9, 'copia previa del local', (case when to_regclass('public.conta_tienda_local_antes') is null then 'sin tabla'
                                    else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_tienda_local_antes', false, true, '')))[1]::text end)
) x order by o;
