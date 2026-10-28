-- supabase/migrations/20261028T0929_s01_propuestas_plataforma.sql
--
-- S01 · PR 3 · Entrega 5 · ORIGEN 5 DE 5: LA LIQUIDACIÓN DE PLATAFORMA
-- (channel_settlement). Se propone sola al leerse (correo o CSV: al entrar, o
-- cuando llega su factura de comisión o su cobro) y en la pasada de noche.
-- Como hoy, no se valida. Lo que no se puede proponer se dice en Ventas ›
-- Liquidaciones, donde se decide (SE_DECIDE_EN, V01 · Entrega 3).
--
-- cambia: public.channel_settlement · prueba: supabase/staging/sql/20261028_s01_propuestas_plataforma_prueba.sql
--
-- La regla del navegador, en SQL, una sola copia, en tres piezas:
--   1. _conta_plataforma_regla(entrada, cuentas): liquidacionPlataforma() y
--      liquidacionConFacturaAparte(), puras: lo mismo que recibían, lo mismo que
--      daban (las razones y los avisos aparte, para aprender antes de juntarlos).
--   2. _conta_plataforma_entrada(empresa, liquidación): lo que hacía el servicio
--      antes de la regla (las cuentas de la plataforma, la de referencia, la
--      que está por aclarar, la que espera su factura de comisión, los cargos,
--      lo cobrado en Bancos, los pedidos del periodo sin resumen del día, el
--      banco del local, el socio de la marca cedida y la serie de tesorería).
--   3. conta_propuestas_plataforma(empresa, liquidación): las dos, con lo
--      aprendido (regla 11), con la forma de aJson. Solo lee.
-- Y quien propone (conta_proponer_plataformas, de un rango, y
-- _conta_proponer_plataforma, una) y el disparador de channel_settlement.
--
-- Medido en producción el 28/10, solo lectura: 268 liquidaciones en Foodint
-- (Glovo, Just Eat y Uber por CSV, Uber por correo, y las de marcas cedidas),
-- 0 con asiento. La regla se compara con la del navegador sobre las 268, con
-- la misma entrada a los dos lados (regla 31, en el parte).

-- ── 1 · La regla, pura ──────────────────────────────────────────────────────
create or replace function public._conta_plataforma_regla(e jsonb, c jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  -- El local, tal cual llega (un uuid; o nada: común).
  loc jsonb := coalesce(e->'localId', 'null'::jsonb); comun boolean := coalesce(jsonb_typeof(e->'localId'), 'null') = 'null';
  v_plat text := e->>'plataforma'; v_cabeza text; v_serie int := coalesce((c->>'serieTesoreria')::int, 3);
  v_cobrado jsonb := case when jsonb_typeof(e->'cobrado') = 'object' then e->'cobrado' end;
  v_banco text := c->>'banco'; v_fa jsonb := case when jsonb_typeof(e->'facturaAparte') = 'object' then e->'facturaAparte' end;
  lin jsonb := '[]'::jsonb; raz jsonb := '[]'::jsonb; avi jsonb := '[]'::jsonb; v_duda boolean := false;
  v_cargos jsonb; v_base numeric; v_iva numeric; v_total numeric; v_neto numeric := nullif(e->>'neto', '')::numeric;
  v_ventas numeric := coalesce((e->>'ventas')::numeric, 0); v_dev numeric := coalesce((e->>'devoluciones')::numeric, 0);
  v_ped_total int := coalesce((e->'pedidos'->>'total')::int, 0); v_ped_asent int := coalesce((e->'pedidos'->>'asentados')::int, 0);
  v_apart jsonb; v_fecha text;
begin
  v_cabeza := 'Liquidación ' || v_plat || coalesce(' · ' || nullif(e->>'ref', ''), '');
  v_fecha := coalesce(v_cobrado->>'fecha', e->>'fecha');

  -- Marca cedida: el dinero de sus ventas es del socio; entra al banco y se le debe.
  if e->>'flujo' = 'licensed' then
    if v_cobrado is null or v_banco is null or (c->>'pendienteSocio') is null then
      return jsonb_build_object('sin_propuesta', case when v_cobrado is null then 'Liquidación de una marca cedida aún sin cobrar: se asienta cuando llegue al banco.'
                                                       else 'Falta la cuenta pendiente con el socio o el banco del local.' end);
    end if;
    return jsonb_build_object('avisos', '[]'::jsonb, 'propuesta', jsonb_build_object(
      'entrada', jsonb_build_object('series', v_serie, 'fecha', v_cobrado->>'fecha', 'concepto', v_cabeza || ' (marca cedida)', 'source_type', 'channel_settlement',
        'source_id', e->>'id', 'confianza', 'probable',
        'porque', 'Lo cobrado por las ventas de una marca cedida es del socio: queda pendiente hasta su liquidación mensual.',
        'razones', jsonb_build_array(jsonb_build_object('decision', 'No es ingreso tuyo', 'porque', 'son ventas del socio cobradas por cuenta de él', 'cita', 'PGC de Pymes, NRV 16.ª')),
        'party_id', null, 'documento', null),
      'lineas', jsonb_build_array(
        jsonb_build_object('cuenta', v_banco, 'debe', (v_cobrado->>'importe')::numeric, 'haber', 0, 'concepto', null, 'local_id', loc, 'comun', comun,
          'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null),
        jsonb_build_object('cuenta', c->>'pendienteSocio', 'debe', 0, 'haber', (v_cobrado->>'importe')::numeric, 'concepto', 'Ventas del socio cobradas por ti',
          'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null))));
  end if;

  -- D01 · Su factura de comisión va aparte (serie 2): aquí solo se compensa, y el cobro.
  if v_fa is not null then
    raz := jsonb_build_array(jsonb_build_object('decision', 'Comisión en su factura',
             'porque', 'la comisión, los cargos y su IVA van en la factura de ' || v_plat || coalesce(' ' || nullif(v_fa->>'numero', ''), '') || ' (serie 2): aquí solo se compensa'));
    if round(coalesce((v_fa->>'total')::numeric, 0) * 100) <> 0 then
      lin := lin || jsonb_build_array(
        jsonb_build_object('cuenta', c->>'proveedor410', 'debe', (v_fa->>'total')::numeric, 'haber', 0,
          'concepto', 'Factura de ' || v_plat || coalesce(' ' || nullif(v_fa->>'numero', ''), '') || ', compensada',
          'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null),
        jsonb_build_object('cuenta', c->>'cliente430', 'debe', 0, 'haber', (v_fa->>'total')::numeric, 'concepto', 'Compensada con su factura',
          'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null));
    end if;
    if nullif(v_fa->>'numero', '') is null then
      avi := avi || to_jsonb('Su factura de comisión aún no tiene número: la compensación lo llevará cuando llegue.'::text); v_duda := true;
    end if;
    if v_cobrado is not null and v_banco is not null then
      lin := lin || jsonb_build_array(
        jsonb_build_object('cuenta', v_banco, 'debe', (v_cobrado->>'importe')::numeric, 'haber', 0, 'concepto', 'Cobro al banco',
          'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null),
        jsonb_build_object('cuenta', c->>'cliente430', 'debe', 0, 'haber', (v_cobrado->>'importe')::numeric, 'concepto', 'Cobro de la liquidación',
          'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null));
    else
      raz := raz || jsonb_build_array(case
        when coalesce((e->>'cobroEnBancos')::boolean, false) then jsonb_build_object('decision', 'Cobro en Bancos', 'porque', 'el movimiento del banco ya está casado con esta liquidación y lleva su propio asiento')
        when v_neto is not null and round(v_neto * 100) <= 0 then jsonb_build_object('decision', 'Sin cobro', 'porque', 'el neto no es positivo: no hay transferencia y pasa a la siguiente liquidación')
        else jsonb_build_object('decision', 'Cobro aún no', 'porque', 'cuando llegue al banco se casa con esta liquidación (Bancos)') end);
    end if;
    select jsonb_agg(x order by o) into v_apart from jsonb_array_elements(coalesce(e->'apartado', '[]'::jsonb)) with ordinality a(x, o)
     where round(coalesce((x->>'importe')::numeric, 0) * 100) <> 0;
    if v_apart is not null then
      avi := avi || to_jsonb('Queda en su 430 sin apuntar, hasta decidir cómo: '
               || (select string_agg((x->>'concepto') || ' ' || public.conta_euros_exactos((x->>'importe')::numeric), ' · ' order by o) from jsonb_array_elements(v_apart) with ordinality a(x, o)) || '.');
      v_duda := true;
    end if;
    if jsonb_array_length(lin) < 2 then return jsonb_build_object('sin_propuesta', 'La liquidación no trae factura que compensar ni cobro: no hay nada que asentar.'); end if;
    return jsonb_build_object('avisos', avi, 'propuesta', jsonb_build_object(
      'entrada', jsonb_build_object('series', v_serie, 'fecha', v_fecha, 'concepto', v_cabeza, 'source_type', 'channel_settlement', 'source_id', e->>'id',
        'confianza', case when v_duda then 'duda' else 'probable' end,
        'porque', 'Su factura de comisión, compensada con lo que te debe' || case when v_cobrado is not null then ', y el cobro al banco' else '' end || '; las ventas ya están en sus días.',
        'razones', raz, 'party_id', null, 'documento', null),
      'lineas', lin));
  end if;

  -- Comisión y cargos con su IVA, compensados con lo que te debe; y el cobro.
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_cargos from jsonb_array_elements(coalesce(e->'cargos', '[]'::jsonb)) with ordinality a(x, o)
   where round(abs(coalesce((x->>'importe')::numeric, 0)) * 100) <> 0;
  v_base := round(coalesce((e->>'comision')::numeric, 0) + coalesce((select sum((x->>'importe')::numeric) from jsonb_array_elements(v_cargos) x), 0), 2);
  v_iva := sign(v_base) * round(abs(v_base * 100 * 21) / 100) / 100;
  v_total := round(v_base + v_iva, 2);
  if round(coalesce((e->>'comision')::numeric, 0) * 100) <> 0 then
    lin := lin || jsonb_build_array(jsonb_build_object('cuenta', c->>'comision', 'debe', (e->>'comision')::numeric, 'haber', 0, 'concepto', 'Comisión ' || v_plat,
             'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null));
  end if;
  lin := lin || coalesce((select jsonb_agg(jsonb_build_object('cuenta', c->>'otrosCargos', 'debe', (x->>'importe')::numeric, 'haber', 0, 'concepto', x->>'concepto',
             'local_id', loc, 'comun', comun, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null) order by o)
             from jsonb_array_elements(v_cargos) with ordinality a(x, o)), '[]'::jsonb);
  if round(v_base * 100) <> 0 then
    lin := lin || jsonb_build_array(
      jsonb_build_object('cuenta', c->'iva21'->>'cuenta', 'debe', v_iva, 'haber', 0, 'concepto', 'IVA soportado 21 %', 'local_id', loc, 'comun', comun,
        'marca_id', null, 'tercero_id', null, 'documento', null,
        'iva', jsonb_build_object('tipo_id', c->'iva21'->>'tipoId', 'base', v_base, 'libro', 'received', 'deducible', 'yes', 'facturas', 1), 'retencion', null),
      jsonb_build_object('cuenta', c->>'proveedor410', 'debe', 0, 'haber', v_total, 'concepto', 'Factura de ' || v_plat, 'local_id', loc, 'comun', comun,
        'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null),
      jsonb_build_object('cuenta', c->>'proveedor410', 'debe', v_total, 'haber', 0, 'concepto', 'Compensada con tus ventas', 'local_id', loc, 'comun', comun,
        'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null),
      jsonb_build_object('cuenta', c->>'cliente430', 'debe', 0, 'haber', v_total, 'concepto', 'Compensada con su factura', 'local_id', loc, 'comun', comun,
        'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null));
    raz := raz || jsonb_build_array(jsonb_build_object('decision', 'Comisión y cargos: ' || public.conta_euros_exactos(v_base) || ' + IVA 21 %',
             'porque', 'la plataforma te factura su servicio; los cargos (espera del repartidor y demás) son gasto con IVA dentro de su factura y nunca tocan la venta'));
    if jsonb_array_length(v_cargos) > 0 then
      raz := raz || jsonb_build_array(jsonb_build_object('decision', jsonb_array_length(v_cargos) || ' cargo' || case when jsonb_array_length(v_cargos) = 1 then '' else 's' end || ' aparte de la comisión',
               'porque', (select string_agg((x->>'concepto') || ' ' || public.conta_euros_exactos((x->>'importe')::numeric), ' · ' order by o) from jsonb_array_elements(v_cargos) with ordinality a(x, o))));
    end if;
  end if;
  if v_cobrado is not null and v_banco is not null then
    lin := lin || jsonb_build_array(
      jsonb_build_object('cuenta', v_banco, 'debe', (v_cobrado->>'importe')::numeric, 'haber', 0, 'concepto', 'Cobro al banco', 'local_id', loc, 'comun', comun,
        'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null),
      jsonb_build_object('cuenta', c->>'cliente430', 'debe', 0, 'haber', (v_cobrado->>'importe')::numeric, 'concepto', 'Cobro de la liquidación', 'local_id', loc, 'comun', comun,
        'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null));
  else
    raz := raz || jsonb_build_array(case when coalesce((e->>'cobroEnBancos')::boolean, false)
      then jsonb_build_object('decision', 'Cobro en Bancos', 'porque', 'el movimiento del banco ya está casado con esta liquidación y lleva su propio asiento')
      else jsonb_build_object('decision', 'Cobro aún no', 'porque', 'cuando llegue al banco se casa con esta liquidación (Bancos)') end);
  end if;
  -- Regla 7: las ventas ya van por los resúmenes del día; aquí nunca.
  if v_ped_asent < v_ped_total then
    avi := avi || to_jsonb((v_ped_total - v_ped_asent) || ' de ' || v_ped_total || ' pedidos del periodo aún no están en un resumen del día: esta liquidación no los asienta (irían dos veces); revisa los días que faltan.');
    v_duda := true;
  else
    raz := raz || jsonb_build_array(jsonb_build_object('decision', 'Sin ventas',
             'porque', case when v_ped_total <> 0 then 'los ' || v_ped_total || ' pedidos del periodo ya están' else 'las ventas del periodo van' end
                       || ' en sus resúmenes del día: aquí solo la comisión, los cargos y el cobro'));
  end if;
  if round(v_dev * 100) <> 0 then
    raz := raz || jsonb_build_array(jsonb_build_object('decision', 'Devoluciones (' || public.conta_euros_exactos(v_dev) || ') fuera',
             'porque', 'van al resumen del día en que se producen, con su pedido', 'cita', 'Ley 37/1992, art. 80.Dos'));
  end if;
  -- 1 céntimo es el redondeo del IVA (Glovo lo calcula pedido a pedido).
  if v_neto is not null and abs(round((v_ventas - v_dev - v_total) * 100) - round(v_neto * 100)) > 1 then
    avi := avi || to_jsonb('Ventas − devoluciones − factura = ' || public.conta_euros_exactos(round(v_ventas - v_dev - v_total, 2)) || ', y la plataforma dice neto '
             || public.conta_euros_exactos(v_neto) || ': la comisión puede venir con el IVA dentro o falta un cargo.');
    v_duda := true;
  end if;
  if v_cobrado is not null and v_neto is not null and round((v_cobrado->>'importe')::numeric * 100) <> round(v_neto * 100) then
    avi := avi || to_jsonb('Al banco llegaron ' || public.conta_euros_exactos((v_cobrado->>'importe')::numeric) || ' y el neto es ' || public.conta_euros_exactos(v_neto) || '.');
    v_duda := true;
  end if;
  if v_banco is null and v_cobrado is not null then
    avi := avi || to_jsonb('El local no tiene su cuenta del banco: ponla en Tablas › Bancos.'::text); v_duda := true;
  end if;
  if jsonb_array_length(lin) < 2 then return jsonb_build_object('sin_propuesta', 'La liquidación no trae comisión, cargos ni cobro: no hay nada que asentar.'); end if;
  return jsonb_build_object('avisos', avi, 'propuesta', jsonb_build_object(
    'entrada', jsonb_build_object('series', v_serie, 'fecha', v_fecha, 'concepto', v_cabeza, 'source_type', 'channel_settlement', 'source_id', e->>'id',
      'confianza', case when v_duda then 'duda' else 'seguro' end,
      'porque', 'Comisión y cargos con su IVA, compensados con lo que te debe' || case when v_cobrado is not null then ', y el cobro al banco' else '' end || '; las ventas ya están en sus días.',
      'razones', raz, 'party_id', null, 'documento', null),
    'lineas', lin));
end $$;
comment on function public._conta_plataforma_regla(jsonb, jsonb) is
  'S01 · PR 3: liquidacionPlataforma() y liquidacionConFacturaAparte() del navegador, puras: {propuesta, avisos} (razones sin los avisos) o {sin_propuesta}.';

-- ── 2 · Lo que hacía el servicio antes de la regla ─────────────────────────
create or replace function public._conta_plataforma_entrada(p_company uuid, p_liq uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with l as (
    select cs.* from public.channel_settlement cs join public.company co on co.id = p_company and co.account_id = cs.account_id where cs.id = p_liq
  ), k as (
    select l.*, ch.name as canal_n,
           (select pr.party_id from public.party_role pr where pr.account_id = l.account_id and pr.role = 'platform' and pr.channel_id = l.channel_id
             order by pr.party_id limit 1) as party,
           (select r.id from public.tax_rate r where r.code = 'iva_general' and r.tax_system = 'iva' and r.valid_to is null and (r.is_system or r.account_id = l.account_id)
             order by r.is_system, r.id limit 1) as t21,
           l.source = 'import_csv_glovo' as glovo, coalesce(l.source, '') like 'correo\_%' as correo,
           coalesce(l.collected_on, l.settlement_date) as fecha
      from l left join public.sales_channel ch on ch.id = l.channel_id and ch.account_id = l.account_id
  ), m as (
    select k.*,
           (select pr.supplier_id from public.party_role pr where pr.account_id = k.account_id and pr.role = 'supplier' and pr.party_id = k.party and pr.supplier_id is not null
             order by pr.supplier_id limit 1) as sup,
           'Liquidación ' || coalesce(k.canal_n, 'de plataforma') || coalesce(' · ' || nullif(k.settlement_ref, ''), '') as que,
           exists (select 1 from public.bank_match_item bi join public.bank_match bm on bm.id = bi.match_id
                    where bi.account_id = k.account_id and bi.channel_settlement_id = k.id and bm.status = 'vivo') as en_bancos,
           (select jsonb_build_object('total', si.grand_total, 'numero', si.invoice_number) from public.supplier_invoice si
             where si.id = k.commission_invoice_id and si.account_id = k.account_id) as factura,
           coalesce(case when jsonb_typeof(k.raw->'factura'->'total') = 'number' then (k.raw->'factura'->>'total')::numeric
                         when (k.raw->'factura'->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$' then (k.raw->'factura'->>'total')::numeric end, 0) as su_parte
      from k
  ), n as (
    select m.*,
           case when m.party is not null then public._conta_enlace(p_company, 'customer', m.party::text, 'principal') end as c430,
           case when m.sup is not null then public._conta_enlace(p_company, 'supplier', m.sup::text, 'principal') end as c410,
           case when m.t21 is not null then public._conta_enlace(p_company, 'tax_rate', m.t21::text, 'soportado') end as c472,
           case when m.factura is null then null
                else m.factura || jsonb_build_object('total', case when m.su_parte > 0 then m.su_parte else (m.factura->>'total')::numeric end) end as fa
      from m
  )
  select case
    when not exists (select 1 from n) then jsonb_build_object('que', 'Liquidación de plataforma', 'sin_propuesta', 'No existe.')
    when n.is_reference is true then jsonb_build_object('que', n.que, 'fecha', n.fecha,
      'sin_propuesta', coalesce(nullif(n.review_note, ''), 'De referencia: es de antes del cierre de la contabilidad; no lleva factura ni asiento.'))
    when n.c430 is null or n.c410 is null or n.c472 is null or n.t21 is null then jsonb_build_object('que', n.que, 'fecha', n.fecha,
      'sin_propuesta', 'Falta su 430, su 410 o la 472 del 21 %: revisa su ficha (Plataformas).')
    when n.correo and n.needs_review is true then jsonb_build_object('que', n.que, 'fecha', n.fecha,
      'sin_propuesta', coalesce(nullif(n.review_note, ''), 'Por aclarar: revisa la liquidación antes de asentarla.'))
    when n.correo and n.fa is null and (round(coalesce(n.commission, 0) * 100) <> 0 or round(coalesce(n.other_cost, 0) * 100) <> 0
                                        or round(coalesce(n.promo_charges, 0) * 100) <> 0 or round(coalesce(n.ads_spend, 0) * 100) <> 0) then
      jsonb_build_object('que', n.que, 'fecha', n.fecha,
        'sin_propuesta', 'Falta su factura de comisión (la liquidación la propone al leerse): sin ella, la comisión no se asienta aquí.')
    else jsonb_build_object('que', n.que, 'fecha', n.fecha, 'clave', 'channel_settlement:' || coalesce(n.channel_id::text, 'null'),
      'e', jsonb_build_object(
        'id', n.id, 'fecha', n.settlement_date, 'ref', nullif(n.settlement_ref, ''), 'plataforma', coalesce(n.canal_n, 'la plataforma'),
        'flujo', case when n.flow_type = 'licensed' then 'licensed' else 'own' end,
        'ventas', coalesce(n.gross_sales, 0), 'comision', abs(coalesce(n.commission, 0)),
        'cargos', case when n.glovo then '[]'::jsonb else coalesce((
            select jsonb_agg(jsonb_build_object('concepto', x.concepto, 'importe', abs(x.v)) order by x.o)
              from (values (1, 'Transporte', n.delivery_transport), (2, 'Promociones a tu cargo', n.promo_product), (3, 'Promoción flash', n.promo_flash),
                           (4, 'Cuota de acceso', n.access_fee), (5, 'Cuota prime', n.prime_fee), (6, 'Cuota recurrente', n.recurring_fee),
                           (7, 'Incidencias (espera del repartidor y otras)', n.incidents_cost), (8, 'Pedido mínimo', n.min_order_fee), (9, 'Otros cargos', n.other_cost)) x(o, concepto, v)
             where coalesce(x.v, 0) <> 0), '[]'::jsonb) end,
        'devoluciones', case when n.glovo then 0 else abs(coalesce(n.incidents_refund, 0)) end,
        'neto', case when n.net_payout is null then null when n.glovo then n.net_payout - coalesce(n.accumulated_debt, 0) else n.net_payout end,
        'cobrado', case when n.collected_on is not null and not n.en_bancos then jsonb_build_object('fecha', n.collected_on, 'importe', coalesce(n.collected_amount, 0)) end,
        'cobroEnBancos', n.en_bancos,
        'pedidos', jsonb_build_object('total', (select coalesce(sum(d.pedidos), 0) from public.conta_dias_por_asentar(p_company, coalesce(n.period_from, n.fecha), coalesce(n.period_to, n.fecha)) d
                                                 where n.location_id is null or d.location_id = n.location_id), 'asentados', 0),
        'localId', n.location_id, 'facturaAparte', n.fa,
        'apartado', case when n.correo then jsonb_build_array(
            jsonb_build_object('concepto', 'Promociones en artículos', 'importe', abs(coalesce(n.item_promotions, 0))),
            jsonb_build_object('concepto', 'Contracargos', 'importe', abs(coalesce(n.chargebacks, 0))),
            jsonb_build_object('concepto', 'Otras ganancias', 'importe', abs(coalesce(n.other_earnings, 0))),
            jsonb_build_object('concepto', 'Ajustes', 'importe', abs(coalesce(n.adjustments, 0)))) else '[]'::jsonb end),
      'c', jsonb_build_object(
        'cliente430', n.c430, 'proveedor410', n.c410,
        'comision', coalesce(public._conta_hoja(p_company, '623'), '62300000'), 'otrosCargos', coalesce(public._conta_hoja(p_company, '629'), '62900000'),
        'iva21', jsonb_build_object('cuenta', n.c472, 'tipoId', n.t21),
        'banco', (select public._conta_enlace(p_company, 'bank_account', t.id::text, 'principal') from public.treasury_account t
                   where t.account_id = n.account_id and t.company_id = p_company and t.kind = 'bank' and t.is_active is not false
                     and (t.location_id is not distinct from n.location_id or t.location_id is null)
                   order by (t.location_id is not distinct from n.location_id) desc, (t.location_id is null) desc, t.id limit 1),
        'pendienteSocio', case when n.brand_id is not null then (
            select public._conta_enlace(p_company, 'customer', a.party_id::text, 'liquidacion') from public.brand_licensing_agreement a
             where a.account_id = n.account_id and a.brand_id = n.brand_id and a.party_id is not null order by a.party_id limit 1) end,
        'serieTesoreria', case when (select b.treasury_series from public.bank_settings b where b.company_id = p_company and b.account_id = n.account_id limit 1) = 4 then 4 else 3 end))
    end
  from (select 1) uno left join n on true
$$;
comment on function public._conta_plataforma_entrada(uuid, uuid) is
  'S01 · PR 3: lo que el servicio del navegador preparaba para liquidacionPlataforma(): {que, fecha, clave, e, c} o {que, fecha, sin_propuesta}. Solo lee.';

-- ── 3 · Las dos, con lo aprendido ──────────────────────────────────────────
create or replace function public.conta_propuestas_plataforma(p_company uuid, p_liq uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g jsonb; r jsonb; ap jsonb;
begin
  g := public._conta_plataforma_entrada(p_company, p_liq);
  if g ? 'sin_propuesta' then return g; end if;
  r := public._conta_plataforma_regla(g->'e', g->'c');
  if r ? 'sin_propuesta' then return jsonb_build_object('que', g->>'que', 'fecha', g->>'fecha', 'sin_propuesta', r->>'sin_propuesta'); end if;
  ap := public._conta_aprendizaje(p_company, g->>'clave', r->'propuesta'->'lineas', r->'propuesta'->'entrada'->'razones');
  return jsonb_build_object('que', g->>'que', 'fecha', g->>'fecha', 'propuesta', jsonb_build_object(
    'entrada', (r->'propuesta'->'entrada') || jsonb_build_object('razones', (ap->'razones')
               || coalesce((select jsonb_agg(jsonb_build_object('decision', 'Mira esto', 'porque', a #>> '{}') order by o)
                              from jsonb_array_elements(r->'avisos') with ordinality z(a, o)), '[]'::jsonb)),
    'lineas', ap->'lineas'));
end $$;
comment on function public.conta_propuestas_plataforma(uuid, uuid) is
  'S01 · PR 3: la propuesta de una liquidación de plataforma, con lo aprendido: {que, fecha, propuesta} como aJson, o {que, fecha, sin_propuesta}. Solo lee.';
revoke all on function public._conta_plataforma_regla(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._conta_plataforma_entrada(uuid, uuid) from public, anon, authenticated;
revoke all on function public.conta_propuestas_plataforma(uuid, uuid) from public, anon, authenticated;

-- ── 4 · Proponerlas ─────────────────────────────────────────────────────────
-- Una: sin asiento vivo y con su día abierto (el del cobro, o el de la liquidación).
create or replace function public._conta_proponer_plataforma(p_company uuid, p_liq uuid, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; v_res jsonb; v_fecha date;
begin
  if exists (select 1 from public.journal_entry e where e.company_id = p_company and e.source_type = 'channel_settlement' and e.source_id = p_liq
               and e.status in ('propuesto', 'borrador', 'validado')) then
    return jsonb_build_object('propuestas', 0, 'yaEstaban', 1, 'descartadas', 0, 'sinPropuesta', '[]'::jsonb);
  end if;
  select coalesce(collected_on, settlement_date) into v_fecha from public.channel_settlement where id = p_liq;
  if v_fecha is null or not public.conta_dia_abierto(p_company, v_fecha) then
    return jsonb_build_object('propuestas', 0, 'yaEstaban', 0, 'descartadas', 0, 'sinPropuesta', '[]'::jsonb);
  end if;
  x := public.conta_propuestas_plataforma(p_company, p_liq);
  if x ? 'sin_propuesta' then
    perform public._conta_no_propuesta(p_company, 'channel_settlement', p_liq::text, x->>'que', x->>'sin_propuesta', 'Ventas › Liquidaciones');
    return jsonb_build_object('propuestas', 0, 'yaEstaban', 0, 'descartadas', 0, 'sinPropuesta', jsonb_build_array(jsonb_build_object('que', x->>'que', 'porque', x->>'sin_propuesta')));
  end if;
  v_res := public._conta_proponer(p_company, x->'propuesta', p_quien);
  return jsonb_build_object('propuestas', case when (v_res->>'descartada')::boolean or (v_res->>'existente')::boolean then 0 else 1 end,
    'yaEstaban', case when (v_res->>'existente')::boolean then 1 else 0 end, 'descartadas', case when (v_res->>'descartada')::boolean then 1 else 0 end, 'sinPropuesta', '[]'::jsonb);
end $$;
revoke all on function public._conta_proponer_plataforma(uuid, uuid, text) from public, anon, authenticated;

-- Las de un rango (por la fecha de la liquidación), como el navegador.
create or replace function public.conta_proponer_plataformas(p_company uuid, p_desde date, p_hasta date, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; r record; x jsonb; v_prop int := 0; v_ya int := 0; v_desc int := 0; v_sin jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  -- Una persona, solo si administra o encarga la cuenta; desde un disparador propone Sumied.
  if auth.uid() is not null and pg_trigger_depth() = 0 and not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone asientos.' using errcode = '42501';
  end if;
  for r in select cs.id from public.channel_settlement cs
            where cs.account_id = v_cuenta and cs.settlement_date >= p_desde and cs.settlement_date <= p_hasta order by cs.settlement_date desc loop
    x := public._conta_proponer_plataforma(p_company, r.id, p_quien);
    v_prop := v_prop + (x->>'propuestas')::int; v_ya := v_ya + (x->>'yaEstaban')::int; v_desc := v_desc + (x->>'descartadas')::int; v_sin := v_sin || (x->'sinPropuesta');
  end loop;
  return jsonb_build_object('propuestas', v_prop, 'yaEstaban', v_ya, 'descartadas', v_desc, 'sinPropuesta', v_sin);
end $$;
revoke all on function public.conta_proponer_plataformas(uuid, date, date, text) from public, anon;
grant execute on function public.conta_proponer_plataformas(uuid, date, date, text) to authenticated, service_role;
comment on function public.conta_proponer_plataformas(uuid, date, date, text) is
  'S01 · PR 3: propone las liquidaciones de plataforma de un rango (navegador, pasada de noche); lo que no puede, a conta_propuesta_pendiente (Ventas › Liquidaciones). No valida.';

-- ── 5 · Al leerse (al entrar, o al llegar su factura de comisión o su cobro) ──
create or replace function public.tg_conta_plataforma_proponer()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  for c in select co.id from public.company co where co.is_active and co.account_id = new.account_id loop
    begin
      perform public._conta_proponer_plataforma(c.id, new.id, 'Sumied (al leer la liquidación)');
    exception when others then
      perform public._conta_no_propuesta(c.id, 'channel_settlement', new.id::text, 'Liquidación de plataforma',
        'No he podido proponerla al leerla: ' || sqlerrm, 'Ventas › Liquidaciones');
    end;
  end loop;
  return null;
end $$;
revoke all on function public.tg_conta_plataforma_proponer() from public, anon, authenticated;
drop trigger if exists conta_plataforma_proponer on public.channel_settlement;
create trigger conta_plataforma_proponer
  after insert or update of commission_invoice_id, collected_on, collected_amount, needs_review, is_reference, net_payout on public.channel_settlement
  for each row execute function public.tg_conta_plataforma_proponer();

-- ── 6 · Lo aprendido, para las facturas recibidas del navegador ────────────
-- Regla 11, una sola copia: la de SQL (_conta_aprendizaje, de la 0905). Las
-- facturas recibidas, que siguen proponiéndose en el navegador, le preguntan
-- aquí con las cuentas de su propuesta: devuelve las cuentas (corregidas si
-- toca) y la razón que lo dice, o ninguna.
create or replace function public.conta_aprendizaje(p_company uuid, p_clave text, p_cuentas text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; r jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then
    raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501';
  end if;
  r := public._conta_aprendizaje(p_company, p_clave,
         coalesce((select jsonb_agg(jsonb_build_object('cuenta', x) order by o) from unnest(p_cuentas) with ordinality u(x, o)), '[]'::jsonb), '[]'::jsonb);
  return jsonb_build_object('cuentas', coalesce((select jsonb_agg(l->'cuenta' order by o) from jsonb_array_elements(r->'lineas') with ordinality z(l, o)), '[]'::jsonb),
                            'razon', r->'razones'->0);
end $$;
revoke all on function public.conta_aprendizaje(uuid, text, text[]) from public, anon;
grant execute on function public.conta_aprendizaje(uuid, text, text[]) to authenticated, service_role;
comment on function public.conta_aprendizaje(uuid, text, text[]) is
  'S01 · PR 3: regla 11 para las facturas recibidas del navegador: {cuentas, razon} con lo aprendido del origen (la de SQL, _conta_aprendizaje). Solo lee.';
