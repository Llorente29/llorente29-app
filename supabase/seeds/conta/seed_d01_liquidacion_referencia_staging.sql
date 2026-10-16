-- supabase/seeds/conta/seed_d01_liquidacion_referencia_staging.sql
--
-- D01 · Una liquidación DE REFERENCIA en staging-conta, para la e2e de Libros y
-- sus capturas (tests/e2e/conta/d01/referencia.spec.ts). SOLO STAGING. Todo
-- inventado; nada copiado de producción. Se puede volver a lanzar: la tienda y
-- la liquidación tienen clave fija, y lo que ya está no se toca.
--
-- Cuenta A (empresa 3b34403a…). Su corte es el día siguiente al último
-- importado: 01/01/2026 (no tiene fecha de corte en Bancos). La semana es la
-- última de antes (22–28/12/2025) y el depósito, del 02/01/2026: la fecha que
-- mira Libros cae en el periodo abierto, y la liquidación sale en «Lo que no he
-- propuesto, y por qué» con su motivo. Es el caso de verdad: la última semana
-- de septiembre de Foodint, pagada en octubre.
--
-- Entra por el mismo camino que un resumen que llega por correo
-- (conta_liquidacion_registrar, como la función de entrada: sin persona), así
-- que la decisión «de referencia, sin factura» la toma la base, no la semilla.
-- La tienda va ya asignada (la primera marca y el primer local de A), para que
-- el motivo sea solo el de referencia.
-- Después de 20261115T0100 (el corte).

do $$
declare
  a  constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_tienda constant text := 'Marca Referencia Inventada (Calle Inventada 5, Madrid, ES, 28001)';
  v_marca uuid; v_local uuid; v_canal uuid; r jsonb; v_cs public.channel_settlement;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'SEMILLA D01 referencia: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if public._conta_corte(ea) is distinct from date '2026-01-01' then
    raise exception 'SEMILLA D01 referencia: el corte de A es %, no el 01/01/2026; la semana de la semilla no sería de referencia.', public._conta_corte(ea);
  end if;
  select id into v_marca from public.brand where account_id = a order by created_at limit 1;
  select id into v_local from public.locations where account_id = a order by created_at limit 1;
  select id into v_canal from public.sales_channel where account_id = a and slug = 'uber';
  if v_marca is null or v_local is null or v_canal is null then
    raise exception 'SEMILLA D01 referencia: a la cuenta A le falta una marca, un local o el canal de Uber.';
  end if;

  insert into public.platform_store (account_id, company_id, provider, external_text, channel_id, brand_id, location_id, created_by_name)
  select a, ea, 'uber', v_tienda, v_canal, v_marca, v_local, 'Semilla D01 referencia'
   where not exists (select 1 from public.platform_store where account_id = a and company_id = ea and provider = 'uber' and lower(btrim(external_text)) = lower(v_tienda));

  perform set_config('request.jwt.claims', '', true);
  r := public.conta_liquidacion_registrar(ea, jsonb_build_object(
    'email_id', 'semilla-d01-referencia-1', 'proveedor', 'uber', 'tienda', v_tienda, 'marca', 'Marca Referencia Inventada',
    'desde', '2025-12-22', 'hasta', '2025-12-28', 'referencia', null, 'deposito_iniciado', '2026-01-02', 'pedidos', 4,
    'ventas', jsonb_build_object('base', 80, 'iva', 8, 'total', 88, 'pedidos', 4),
    'ganancias', jsonb_build_object('ventas', 88, 'pedidosVentas', 4, 'otras', 0, 'total', 88),
    'uber', jsonb_build_object('tasas', -8, 'otros', 0, 'total', -8),
    'marketing', jsonb_build_object('promociones', -15, 'otrosPromo', -2, 'anuncios', -10, 'total', -27),
    'modificaciones', jsonb_build_object('contracargo', 0, 'pedidosContracargo', 0, 'ajustes', 0, 'total', 0),
    'neto', 53, 'diario', '[]'::jsonb, 'contracargos', '[]'::jsonb, 'mensual', null, 'avisos', '[]'::jsonb,
    'factura', jsonb_build_object('comision', jsonb_build_object('total', 10, 'base', 8.27), 'publicidad', jsonb_build_object('total', 10, 'base', 8.26),
                                  'base', 16.53, 'iva', 3.47, 'total', 20, 'tipo_iva', 21, 'avisos', '[]'::jsonb)), 'Semilla D01 referencia');

  select * into v_cs from public.channel_settlement where id = (r->>'liquidacion_id')::uuid;
  if v_cs.is_reference is not true or v_cs.commission_invoice_id is not null or v_cs.settlement_date <> date '2026-01-02'
     or v_cs.review_note is distinct from 'De referencia: es de antes del cierre de la contabilidad; no lleva factura ni asiento, y su cobro sí se casa en Bancos.' then
    raise exception 'SEMILLA D01 referencia: la liquidación no ha quedado de referencia sin factura con su motivo: %', jsonb_build_object('r', r, 'nota', v_cs.review_note);
  end if;
  raise notice 'SEMILLA D01 referencia: 22–28/12/2025 (depósito 02/01/2026), de referencia y sin factura: %', coalesce(r->>'texto', 'ya estaba');
end $$;
