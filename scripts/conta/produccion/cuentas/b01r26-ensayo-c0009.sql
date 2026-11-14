-- scripts/conta/produccion/cuentas/b01r26-ensayo-c0009.sql
--
-- B01r26 · el ensayo en la C0009 (2005) y su limpieza · LO QUE CUENTA LA TANDA. SOLO LEE.
-- Con la vuelta atrás (la limpieza), todo tiene que volver a lo de antes, igual.
--   1. A qué base de Diez apunta Foodint (8 = C0008, 9 = C0009).
--   2. Envíos de Foodint en enviado o enlazado (215; durante el ensayo, 0).
--   3. Envíos pendientes de Foodint (27).
--   4. Traspasos de Foodint (0).
--   5. Meses de Foodint cerrados y sin reabrir (9: enero a septiembre).
--   6. La tabla del ensayo existe (0; durante el ensayo, 1).
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay)
select clave, valor from (
  -- quieta: la conexión solo la cambian esta tanda y su limpieza
  select 1 o, 'Base de Diez de Foodint (8 = C0008, 9 = C0009)' clave,
    (select case when not (select hay from f) then 0 else coalesce(max(right(c.external_account_id, 1)::int), 0) end
       from public.account_connector c where c.id = '860fcb61-9b95-46da-bc1a-ad73d665f19b')::text valor
  union all
  -- quieta: con Foodint en modo mensual y sin traspaso confirmado, nada escribe en external_send hasta que Julio confirme
  select 2, 'Envíos de Foodint en enviado o enlazado',
    (select case when not (select hay from f) then 0 else count(*) end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status in ('enviado', 'enlazado'))::text
  union all
  -- quieta: con Foodint en modo mensual y sin traspaso confirmado, nada escribe en external_send hasta que Julio confirme
  select 3, 'Envíos pendientes de Foodint',
    (select case when not (select hay from f) then 0 else count(*) end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status = 'pendiente')::text
  union all
  -- quieta: un traspaso solo lo confirma Julio en su pantalla
  select 4, 'Traspasos de Foodint', (select count(*) from public.conta_diez_traspaso where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9')::text
  union all
  -- quieta: un mes se cierra en Cierre del mes o en un traspaso, que pulsa Julio
  select 5, 'Meses de Foodint cerrados y sin reabrir',
    (select count(*) from public.fiscal_period_lock where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and reopened_at is null)::text
  union all
  -- quieta: el catálogo solo lo cambia esta tanda y su limpieza
  select 6, 'La tabla del ensayo existe', (case when to_regclass('public.conta_b01r26_ensayo') is null then 0 else 1 end)::text
) x order by o;
