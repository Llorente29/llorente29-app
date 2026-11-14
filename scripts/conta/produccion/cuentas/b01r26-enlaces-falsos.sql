-- scripts/conta/produccion/cuentas/b01r26-enlaces-falsos.sql
--
-- B01r26 · los enlaces falsos de octubre · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0. Sin Foodint (staging), 0 antes y después.
--   1. Envíos «enlazado» de Foodint, asiento, serie 4: 275 → 0.
--   2. Envíos «pendiente» de Foodint por enlace falso o porque ya no están en Diez, menos 330: −330 → 0.
--   3. Envíos «enviado» de Foodint, de tipo asiento: 55 → 0 (la factura FV-02931, «enviado», no se toca).
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay)
select clave, valor from (
  -- quieta: Foodint está en modo mensual y el traspaso de octubre está parado («con_fallos») hasta que Julio pulse
  select 1 o, 'Envíos enlazados de Foodint, asiento, serie 4' clave,
    (select case when not (select hay from f) then 0 else count(*) end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status = 'enlazado' and s.kind = 'asiento' and s.ext_series = '4')::text valor
  union all
  -- quieta: Foodint está en modo mensual y el traspaso de octubre está parado («con_fallos») hasta que Julio pulse
  select 2, 'Envíos pendientes de Foodint que vuelven al traspaso, menos 330',
    (select case when not (select hay from f) then 0 else count(*) - 330 end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status = 'pendiente'
        and (s.last_error like 'Enlace falso: Diez (C0008)%' or s.last_error like 'Ya no está en Diez: la C0008%'))::text
  union all
  -- quieta: Foodint está en modo mensual y el traspaso de octubre está parado («con_fallos») hasta que Julio pulse
  select 3, 'Envíos enviados de Foodint, de tipo asiento',
    (select case when not (select hay from f) then 0 else count(*) end from public.external_send s
      where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.status = 'enviado' and s.kind = 'asiento')::text
) x order by o;
