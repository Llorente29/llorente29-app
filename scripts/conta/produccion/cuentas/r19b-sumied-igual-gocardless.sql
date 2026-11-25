-- scripts/conta/produccion/cuentas/r19b-sumied-igual-gocardless.sql
--
-- R19 · paso 1 · Sumied igual a GoCardless · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta (regla 9: los ids cortados a 8): las líneas de Sumied que salieron de una suscripción de GoCardless (la
-- tanda no las toca: las iguala después la lectura), lo igualado (antes de la tanda, la tabla no existe: 0; después, 0
-- hasta la primera lectura) y los «Pendiente de revisar» de los tres tipos nuevos (0 y 0: los escribe la lectura).
-- Corte fijo: lo creado antes del 26/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'cuenta ' || left(l.account_id::text, 8) || ' · líneas de GoCardless' clave, count(*)::text valor
    from public.conta_linea l where l.suscripcion_gc_id is not null and l.created_at < timestamptz '2026-11-26 00:00:00+01' group by l.account_id
  union all
  select 2, 'tabla entera · lo igualado a GoCardless',
         case when to_regclass('public.conta_gc_igualado') is null then '0'
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.conta_gc_igualado where hecho_at < timestamptz ''2026-11-26 00:00:00+01''', false, true, '')))[1]::text end
  union all
  select 3, 'tabla entera · pendientes de los tipos nuevos', count(*)::text
    from public.conta_gestoria_diferencia d where d.tipo in ('linea_sin_atar', 'linea_en_otra_ficha', 'gc_sin_atar') and d.created_at < timestamptz '2026-11-26 00:00:00+01'
) t order by o, clave;
