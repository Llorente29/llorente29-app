-- supabase/migrations/20261106T2213_dl1_adleta_liquidacion.sql
--
-- DL1 · Adleta (Lobbers): lo que no liquidó, del 16/05 al 10/07 (Julio, DL1·14
-- y su respuesta del 06/11). Llorente29 emite sus propias facturas a Adleta,
-- con el camino de la aplicación (conta_venta_guardar y conta_venta_emitir),
-- como si las emitiera Julio:
--   · fecha de expedición: el día en que se emiten (el del real), en la serie
--     de siempre de las facturas a cliente (F); la fecha de operación (el
--     periodo real) va en el concepto de la línea y en las notas, porque la
--     factura de Sumied no tiene un campo para ella;
--   · la base, con la fórmula de las autofacturas: ventas brutas ÷ 1,10 × 56 %
--     (25 % de comisión y 31 % de producto), sin descontar la tasa de marca; el
--     10 % de IVA encima. 705 «Prestaciones de servicios».
--
--   A · 12/06 – 10/07: 3.939,50 de ventas (Folvy, exacto: 193 ventas cerradas
--       de Lobbers sin la cancelada) → base 2.005,56 + IVA 200,56 = 2.206,12.
--   B · 16/05 – 11/06: 5.103,00 estimados (27 días × 189 €, el ritmo de junio
--       en Folvy; sin informe de ventas de Adleta) → base 2.597,89 + IVA 259,79
--       = 2.857,68.
--
-- Cada factura se emite «común» (el local va por factura, no por línea) y, en
-- la misma transacción, un asiento reparte su 705 por local: A con el local de
-- cada venta de Folvy, B con el peso de la LF-2026-004. Se valida como Julio.
--
-- Lo que tiene que dar: 43000006 de +1.759,18 a +6.822,98 (lo que debe Adleta,
-- para el concurso); el IVA de Adleta del 4T, de 1.008,23 a 1.468,58.
-- Verifactu está apagado para Foodint: emitir no manda nada fuera.
--
-- SIN VUELTA ATRÁS, a propósito: una factura emitida tiene su número y se
-- corrige con una rectificativa; un asiento validado, con un contraasiento.

create or replace function public._dl1_factura_emitir(p_company uuid, p_actor uuid, p_nombre text, p_datos jsonb, p_lineas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true);
  v_g jsonb; v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'DL1 factura: esa empresa no está.'; end if;
  if exists (select 1 from public.customer_invoice where company_id = p_company and account_id = v_acc and status <> 'anulada'
              and notes = p_datos->>'notas') then
    raise exception 'DL1 factura: ya hay una factura viva con las notas «%»: no se emite otra.', p_datos->>'notas';
  end if;
  -- Como si la emitiera la persona: su usuario y su cuenta activa, solo en esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_actor::text || ':' || v_acc::text, true);
  v_g := public.conta_venta_guardar(p_company, null, p_datos, p_lineas, p_nombre);
  v_r := public.conta_venta_emitir((v_g->>'id')::uuid, p_nombre);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return v_r;
end $$;
revoke all on function public._dl1_factura_emitir(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;
comment on function public._dl1_factura_emitir(uuid, uuid, text, jsonb, jsonb) is
  'DL1. Guarda y emite una factura de venta con el camino de la aplicación (conta_venta_guardar y conta_venta_emitir), como una persona de la cuenta; para si ya hay una viva con las mismas notas. Solo una tanda.';

-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_adleta constant uuid := '11fee0f6-b5ab-4cb8-8611-ce6b4ce6b121';  -- ADLETA CONSULTING S.L., en Contactos, enlazada a la 43000006
  v_alc constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  v_car constant uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';
  v_pca constant uuid := '629f9154-b888-48ed-9b8c-ffae77620615';
  v_iva10 constant uuid := '79d77d54-606c-4395-b968-02a99eb64dc3';  -- IVA reducido, 10 %
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_705 uuid; r record; v_f jsonb; v_id uuid; v_ids jsonb := '[]'::jsonb; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Adleta liquidación: sin la cuenta de Foodint, no hay nada que emitir.';
    return;
  end if;
  select id into v_705 from public.company_account where company_id = v_e and account_id = v_acc and code = '70500000';
  if v_705 is null then raise exception 'DL1 Adleta liquidación: falta la 70500000 en el plan.'; end if;
  if not exists (select 1 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
                  where k.company_id = v_e and k.entity = 'customer' and k.entity_id = v_adleta::text and k.role = 'principal' and a.code = '43000006') then
    raise exception 'DL1 Adleta liquidación: Adleta no está enlazada a la 43000006: la factura abriría otra 430.';
  end if;

  for r in select * from (values
      ('A', 'Lobbers 12/06/2026 – 10/07/2026', 2005.56, 1181.56, 594.69, 229.31,
       'Liquidación Lobbers · fecha de operación 12/06/2026 – 10/07/2026 · ventas brutas 3.939,50 € (Folvy) ÷ 1,10 × 56 % (25 % comisión, 31 % producto)'),
      ('B', 'Lobbers 16/05/2026 – 11/06/2026', 2597.89, 1366.40, 513.03, 718.46,
       'Liquidación estimada Lobbers 16/05–11/06: sin informe de ventas de Adleta · fecha de operación 16/05/2026 – 11/06/2026 · ventas brutas estimadas 5.103,00 € (27 días × 189 €, ritmo de junio en Folvy) ÷ 1,10 × 56 %')
    ) x(k, periodo, base, alc, car, pca, concepto) loop
    if r.alc + r.car + r.pca <> r.base then raise exception 'DL1 Adleta liquidación: el reparto por local de % no suma su base.', r.k; end if;
    v_f := public._dl1_factura_emitir(v_e, v_julio, 'Julio',
      jsonb_build_object('cliente_id', v_adleta, 'fecha', v_hoy, 'serie', 'F',
                         'notas', 'DL1 · ' || r.periodo || ' · fecha de operación del periodo; sin descontar la tasa de marca.'),
      jsonb_build_array(jsonb_build_object('concepto', r.concepto, 'cantidad', 1, 'precio', r.base, 'tipo_id', v_iva10, 'cuenta_id', v_705)));
    if (v_f->>'total')::numeric <> round(r.base * 1.10, 2) then
      raise exception 'DL1 Adleta liquidación: la factura % sale por % y se esperaba %.', r.k, v_f->>'total', round(r.base * 1.10, 2);
    end if;
    -- La 705 de la factura, repartida por local (la factura va «común»).
    v_id := public._dl1_venta_proponer(v_e, v_hoy, 4,
      'Reparto por local de la factura ' || (v_f->>'numero') || ' a Adleta (' || r.periodo || ')',
      'DL1: la factura de venta lleva un solo local; su 705 se reparte por local con el local de cada venta (A) o con el peso de la LF-2026-004 (B).',
      jsonb_build_array(
        jsonb_build_object('cuenta', '70500000', 'debe', r.base, 'documento', v_f->>'numero'),
        jsonb_build_object('cuenta', '70500000', 'haber', r.alc, 'local', v_alc, 'documento', v_f->>'numero'),
        jsonb_build_object('cuenta', '70500000', 'haber', r.car, 'local', v_car, 'documento', v_f->>'numero'),
        jsonb_build_object('cuenta', '70500000', 'haber', r.pca, 'local', v_pca, 'documento', v_f->>'numero')));
    v_ids := v_ids || jsonb_build_object('id', v_id, 'importe', r.base);
    raise notice 'DL1 Adleta liquidación: emitida la % por % (asiento nº %).', v_f->>'numero', v_f->>'total', v_f->>'numero_asiento';
  end loop;
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', v_ids);
  raise notice 'DL1 Adleta liquidación: % repartos por local validados.', v_n;
end $$;
