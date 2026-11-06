-- scripts/conta/produccion/cuentas/g01-clientes-cuotas.sql
--
-- G01 · Asesoría QBO · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La
-- misma vara a los dos lados (regla 31). Medido antes el 06/11. Lo que tiene
-- que pasar con la tanda (y volver a como estaba con su vuelta atrás):
--   1. Tablas nuevas del G01 que existen: 0 → 15.
--   2. Las tres vistas de consulta: 0 → 3.
--   3. conta_pasarela_cuenta.proveedor: stripe y redsys → también gocardless.
--   4. party.source: sin crm → con crm.
--   5. conta_mandato.token obligatorio: sí → no (lo pide el CHECK en los de Sumied).
--   6. _s01_cuenta_pasarela: su huella cambia (admite gocardless).
--   7. La lectura de cada noche (cron «conta-gestoria-leer»): 0 → 1.
--   8. Clientes con origen crm, de todas las cuentas a propósito: 0 → 0 (la tanda no lee Bitrix24).
--   9. Cuentas de pasarela de todas las empresas (antes del 06/11 16:00 UTC): como antes.
select clave, valor from (
  select 1 o, 'Tablas nuevas del G01 que existen' clave,
    (select count(*)::text from unnest(array['public.conta_cobro_gocardless', 'public.conta_crm_bitrix', 'public.conta_gestoria_cliente',
       'public.conta_servicio', 'public.conta_tarifa', 'public.conta_solicitud', 'public.conta_linea', 'public.conta_gestoria_cambio',
       'public.conta_gc_cliente', 'public.conta_gc_mandato', 'public.conta_gc_suscripcion', 'public.conta_gc_cobro', 'public.conta_gc_importacion',
       'public.conta_gestoria_lectura', 'public.conta_gestoria_diferencia']) t where to_regclass(t) is not null) valor union all
  select 2, 'Vistas de consulta del asistente que existen',
    (select count(*)::text from unnest(array['public.conta_consulta_clientes', 'public.conta_consulta_lineas', 'public.conta_consulta_diferencias']) t
      where to_regclass(t) is not null) union all
  select 3, 'conta_pasarela_cuenta · proveedores que admite',
    (select pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c where c.conname = 'conta_pasarela_cuenta_proveedor_check') union all
  select 4, 'party · orígenes que admite',
    (select pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c where c.conname = 'party_source_check') union all
  select 5, 'conta_mandato · el enlace de firma es obligatorio',
    (select a.attnotnull::text from pg_catalog.pg_attribute a where a.attrelid = 'public.conta_mandato'::regclass and a.attname = 'token') union all
  select 6, '_s01_cuenta_pasarela · huella',
    (select md5(pg_get_functiondef('public._s01_cuenta_pasarela(uuid,text)'::regprocedure))) union all
  select 7, 'La lectura de cada noche',
    (select count(*)::text from cron.job j where j.jobname = 'conta-gestoria-leer') union all
  select 8, 'Clientes con origen crm, de Bitrix24 (todas las cuentas)',
    -- quieta: el origen crm lo trae esta tanda y solo lo usa conta-bitrix-leer, que la tanda no lanza
    (select count(*)::text from public.party p where p.source = 'crm') union all
  select 9, 'Cuentas de pasarela de las empresas (antes del 06/11 16:00 UTC)',
    (select count(*)::text from public.conta_pasarela_cuenta x where x.created_at < timestamptz '2026-11-06 16:00+00')
) q order by o;
