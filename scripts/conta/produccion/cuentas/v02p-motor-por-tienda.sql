-- scripts/conta/produccion/cuentas/v02p-motor-por-tienda.sql
--
-- V02 · Pantallas (26/10) · LO QUE CUENTA LA TANDA DEL MOTOR POR TIENDA, antes
-- y después. SOLO LEE. Lo de Foodint, con su account_id (regla 9); lo que es de
-- la base entera (columnas, firmas, huellas), se dice.
--
-- Lo que tiene que cambiar:
--   · la marca de una diferencia resuelta, de «no existe» a 0 (columna nueva, vacía);
--   · los resolutores: el de antes (conta_liquidacion_resolver, 11 argumentos,
--     sin tocar: su huella, igual) y el nuevo por tienda (…_tienda, 12);
--   · la huella de conta_liquidaciones (el motor).
-- Lo demás, IGUAL: la tanda no toca ninguna liquidación, tienda, diferencia,
-- cobro ni asiento, ni el registrar del #332 (su huella, igual).
--
-- Medido en producción el 26/10 a las 00:55 UTC, antes (la 1 puede crecer sola:
-- siguen llegando los correos de Uber):
--   267 · 0 · no existe · 1 (11) · 57774b89 · 7e8996c5 · 9 / 9 · 15218
select clave, valor from (
  select 1 o, 'liquidaciones de Foodint' clave,
    (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text valor union all
  select 2, 'diferencias resueltas (base entera)',
    (select count(*) from public.conta_liquidacion_resolucion)::text union all
  select 3, 'diferencias resueltas con su marca (base entera)',
    case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_liquidacion_resolucion' and column_name = 'brand_id') then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_liquidacion_resolucion where brand_id is not null', false, true, '')))[1]::text end union all
  select 4, 'resolutores (el de antes: huella · el de la tienda: argumentos)',
    (select coalesce((select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_liquidacion_resolver'), 'no existe') || ' · ' ||
            coalesce((select p.pronargs::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_liquidacion_resolver_tienda'), 'no existe')) union all
  select 5, 'huella de conta_liquidaciones (el motor)',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_liquidaciones') union all
  select 6, 'huella de conta_liquidacion_registrar (no se toca)',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_liquidacion_registrar') union all
  select 7, 'tiendas de Foodint (todas / con su tramo)',
    (select count(*) || ' / ' || count(*) filter (where exists (select 1 from public.platform_store_tramo t where t.store_id = ps.id))
       from public.platform_store ps where ps.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 8, 'asientos (base entera)', (select count(*) from public.journal_entry)::text
) x order by o;
