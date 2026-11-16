-- scripts/conta/produccion/cuentas/b01r26-los-15-de-la-caida.sql
--
-- B01r26 · los 15 de la caída (0825) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0. Sin Foodint (staging), 0 antes y después.
--   1. Envíos de Foodint parados por la caída de la conexión (motivo «no está configurada» o «Conexión con Diez caída»): 15 → 0.
--   2. Fallos en el detalle del traspaso de octubre, menos 5: 15 → 0.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay)
select clave, valor from (
  -- quieta: el traspaso de octubre está parado («traspasando») y la conexión caída hasta que Julio la levante
  select 1 o, 'Envíos parados por la caída de la conexión' clave,
    (select case when not (select hay from f) then 0 else count(*) end from public.external_send x
      where x.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and x.status = 'pendiente'
        and (x.last_error = 'la conexión con Diez no está configurada para esta empresa' or x.last_error like '%Conexión con Diez caída%'))::text valor
  union all
  -- quieta: el traspaso de octubre está parado («traspasando») hasta que Julio pulse
  select 2, 'Fallos en el detalle del traspaso de octubre, menos 5',
    (select case when not (select hay from f) then 0 else coalesce(sum(jsonb_array_length(t.detalle)), 0) - 5 end from public.conta_diez_traspaso t
      where t.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and t.mes = date '2026-10-01')::text
) x order by o;
