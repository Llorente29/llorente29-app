-- scripts/conta/produccion/cuentas/g01d-cola.sql
--
-- G01d · La clave única de la cola de avisos · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE. La misma vara a los dos lados (regla 31). Todas las
-- cuentas a propósito (la tanda es de la tabla entera). Los avisos, con un
-- corte fijo (recibidos antes del 09/11 a las 00:00 UTC).
-- Medido antes el 08/11 a las 23:39 UTC (solo lectura). Lo que tiene que pasar:
--   1. La clave de la cola es parcial («where clave is not null»): sí → no.
--   2. La clave de la cola es única sobre (account_id, clave): sí → sí.
--   3. Avisos en la cola (todas las cuentas): 0 → 0.
--   4. Conexiones con «Al instante» encendido, CRM / GoCardless: 0 / 0 → 0 / 0.
select clave, valor from (
  select 1 o, 'La clave de la cola es parcial' clave,
    (select (i.indpred is not null)::text from pg_catalog.pg_index i where i.indexrelid = to_regclass('public.conta_aviso_clave_idx')) valor union all
  select 2, 'La clave de la cola es única sobre (account_id, clave)',
    (select (i.indisunique and pg_catalog.pg_get_indexdef(i.indexrelid) like '%(account_id, clave)%')::text from pg_catalog.pg_index i where i.indexrelid = to_regclass('public.conta_aviso_clave_idx')) union all
  select 3, 'Avisos en la cola (todas las cuentas)',
    (select count(*)::text from public.conta_aviso where recibido_at < timestamptz '2026-11-09 00:00:00+00') union all
  select 4, 'Conexiones con «Al instante» encendido: CRM / GoCardless (todas las cuentas)',
    concat_ws(' / ',
      (select count(*) from public.conta_crm where created_at < timestamptz '2026-11-09 00:00:00+00' and aviso_encendido),
      -- quieta: una conexión de GoCardless nueva entra apagada; la medida cuenta solo las encendidas, y la tanda no enciende ninguna
      (select count(*) from public.conta_cobro_gocardless where aviso_encendido))
) q order by o;
