-- supabase/migrations/20261028T0830_s01_propuestas_recibido.sql
--
-- S01 · PR 3 · Entrega 5 · ORIGEN 2 DE 5: LO RECIBIDO SIN FACTURA
-- (purchase_accrual). Al cerrar el mes se proponen los dos asientos de cada
-- proveedor y local: el del último día (gasto contra «facturas pendientes de
-- recibir», 4009) y su contrario el día 1 del mes siguiente (Julio, 28/10:
-- como hoy; el gasto lo pone la factura). Se deciden en Compras (SE_DECIDE_EN).
--
-- Solo AÑADE:
--   1. conta_propuestas_recibido(fila de purchase_accrual): la regla de
--      finDeMesCompras() del navegador (lib/asientosPropuestos.ts) en SQL puro,
--      que solo lee: {que, propuestas: [el del mes, su contrario]} con la forma
--      de aJson, o {que, sin_propuesta}.
--   2. conta_proponer_recibidos(empresa, desde, hasta, quién): los meses ya
--      acabados del rango, con su día abierto; calcula lo de cada mes
--      (_compras_fin_de_mes, la de siempre) y propone. Lo que no puede, a «Lo
--      que no he podido proponer» (dónde: Compras). No valida (como hoy).
--
-- Medido en producción el 28/10, solo lectura: purchase_accrual vacía (se
-- calcula al pedirla) y 0 asientos de lo recibido sin factura. La regla se
-- compara con la del navegador sobre lo que calcula _compras_fin_de_mes para
-- Foodint (su consulta, en línea y solo leyendo).

create or replace function public.conta_propuestas_recibido(p_accrual uuid)
returns jsonb language sql stable set search_path = public as $$
  with a as (
    select pa.*, s.name as prov_nombre, s.expense_category_id,
           (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'])[extract(month from pa.month)::int] as nombre_mes,
           (date_trunc('month', pa.month) + interval '1 month - 1 day')::date as fin,
           (date_trunc('month', pa.month) + interval '1 month')::date as uno,
           to_char(pa.month, 'MM/YYYY') as mm_aaaa,
           (select l.name from public.locations l where l.id = pa.location_id) as nombre_local,
           (select pr.party_id from public.party_role pr where pr.account_id = pa.account_id and pr.role = 'supplier' and pr.supplier_id = pa.supplier_id
             order by pr.party_id limit 1) as tercero
      from public.purchase_accrual pa left join public.supplier s on s.id = pa.supplier_id
     where pa.id = p_accrual
  ), c as (
    select a.*,
      coalesce(
        (select ca.code from public.company_account_link k join public.company_account ca on ca.id = k.company_account_id
          where k.company_id = a.company_id and k.entity = 'supplier' and k.entity_id = a.supplier_id::text and k.role = 'gasto' limit 1),
        case when a.expense_category_id is not null then
          (select ca.code from public.company_account_link k join public.company_account ca on ca.id = k.company_account_id
            where k.company_id = a.company_id and k.entity = 'expense_category' and k.entity_id = a.expense_category_id::text and k.role = 'principal' limit 1) end) as gasto,
      (select ca.code from public.company_account ca where ca.company_id = a.company_id and ca.kind = 'template'
          and ca.status is distinct from 'cerrada' and ca.template_code = '4009' order by ca.code limit 1) as pendiente,
      round(a.base, 2) as base2,
      coalesce(a.prov_nombre, 'Proveedor') as proveedor,
      'Recibido sin factura · ' || coalesce(a.prov_nombre, 'proveedor') || ' · ' || to_char(a.month, 'MM/YYYY') as que,
      (select string_agg(coalesce(r->>'code', 'sin código') || ' (' || to_char((r->>'fecha')::date, 'DD/MM')
                         || case when r->>'base' is null then ', sin importe' else ', ' || public.conta_euros_exactos((r->>'base')::numeric) end || ')', ', ' order by o)
         from jsonb_array_elements(a.receipts) with ordinality x(r, o)) as de_donde,
      jsonb_array_length(coalesce(a.receipts, '[]'::jsonb)) as n_recepciones
      from a
  ), p as (
    select c.*,
      jsonb_build_array(
        jsonb_build_object('decision', n_recepciones || ' recepción(es) sin factura a ' || to_char(fin, 'DD/MM'), 'porque', de_donde),
        jsonb_build_object('decision', 'Gasto contra facturas pendientes de recibir',
                           'porque', 'el género ya es tuyo aunque la factura llegue después; el día 1 se da la vuelta y el gasto lo pone la factura'))
      || case when without_base > 0 then jsonb_build_array(jsonb_build_object('decision', 'Mira esto', 'porque', without_base || ' recepción(es) sin importe no están en la cifra.'))
              else '[]'::jsonb end as razones,
      case when without_base > 0 then 'duda' else 'seguro' end as confianza,
      case when nombre_local is not null then ' · ' || nombre_local else '' end as donde
      from c
  )
  select case
    when not exists (select 1 from a) then jsonb_build_object('que', 'Recibido sin factura', 'sin_propuesta', 'No existe.')
    when p.gasto is null then jsonb_build_object('que', p.que,
      'sin_propuesta', format('A %s le falta el tipo de gasto: ponlo en su ficha y lo recibido sin factura de %s se propone.', p.proveedor, p.nombre_mes))
    when p.pendiente is null then jsonb_build_object('que', p.que, 'sin_propuesta', 'Falta en tu plan la cuenta de facturas pendientes de recibir (4009).')
    when round(p.base * 100) <= 0 then jsonb_build_object('que', p.que,
      'sin_propuesta', format('Lo recibido sin factura de %s en %s no trae importe: no hay nada que apuntar.', p.proveedor, p.nombre_mes))
    else jsonb_build_object('que', p.que, 'propuestas', (
      select jsonb_agg(jsonb_build_object(
        'entrada', jsonb_build_object('series', 2, 'fecha', v.fecha, 'concepto', v.concepto, 'source_type', v.tipo, 'source_id', p.id,
                                      'confianza', p.confianza, 'porque', v.porque, 'razones', p.razones, 'party_id', p.tercero, 'documento', null),
        'lineas', jsonb_build_array(
          jsonb_build_object('cuenta', p.gasto, 'debe', case when v.al_reves then 0 else p.base2 end, 'haber', case when v.al_reves then p.base2 else 0 end,
                             'concepto', null, 'local_id', p.location_id, 'comun', p.location_id is null, 'marca_id', null, 'tercero_id', null,
                             'documento', null, 'iva', null, 'retencion', null),
          jsonb_build_object('cuenta', p.pendiente, 'debe', case when v.al_reves then p.base2 else 0 end, 'haber', case when v.al_reves then 0 else p.base2 end,
                             'concepto', null, 'local_id', p.location_id, 'comun', p.location_id is null, 'marca_id', null, 'tercero_id', p.tercero,
                             'documento', null, 'iva', null, 'retencion', null))) order by v.o)
        from (values
          (1, p.fin, 'purchase_accrual', 'Recibido sin factura · ' || p.proveedor || p.donde || ' · ' || p.nombre_mes, false,
              'Lo recibido de ' || p.proveedor || ' en ' || p.nombre_mes || ' sin factura todavía.'),
          (2, p.uno, 'purchase_accrual_reversal', 'Contrario del recibido sin factura · ' || p.proveedor || p.donde || ' · ' || p.nombre_mes, true,
              'Da la vuelta al del ' || to_char(p.fin, 'DD/MM') || ': el gasto lo pone su factura.')) v(o, fecha, tipo, concepto, al_reves, porque)))
    end
  from (select 1) uno left join p on true
$$;
comment on function public.conta_propuestas_recibido(uuid) is
  'S01 · PR 3: la regla de lo recibido sin factura (finDeMesCompras() del navegador), en SQL puro: {que, propuestas: [del mes, contrario]} como aJson, o {que, sin_propuesta}. Solo lee.';

create or replace function public.conta_proponer_recibidos(p_company uuid, p_desde date, p_hasta date, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_mes date; v_fin date; a record; x jsonb; q jsonb; v_res jsonb;
        v_prop int := 0; v_ya int := 0; v_desc int := 0; v_sin jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone asientos.' using errcode = '42501';
  end if;
  -- Los meses ya acabados (su último día, pasado) del rango, con ese día abierto.
  for v_mes in select d::date from generate_series(date_trunc('month', p_desde), p_hasta, interval '1 month') d loop
    v_fin := (v_mes + interval '1 month - 1 day')::date;
    continue when not (v_fin < public.conta_hoy() and v_fin <= p_hasta and public.conta_dia_abierto(p_company, v_fin));
    for a in select id from public._compras_fin_de_mes(p_company, v_mes) loop
      x := public.conta_propuestas_recibido(a.id);
      if x ? 'sin_propuesta' then
        perform public._conta_no_propuesta(p_company, 'purchase_accrual', a.id::text, x->>'que', x->>'sin_propuesta', 'Compras › Facturas recibidas');
        v_sin := v_sin || jsonb_build_array(jsonb_build_object('que', x->>'que', 'porque', x->>'sin_propuesta'));
        continue;
      end if;
      for q in select * from jsonb_array_elements(x->'propuestas') loop
        continue when not public.conta_dia_abierto(p_company, (q->'entrada'->>'fecha')::date);
        v_res := public._conta_proponer(p_company, q, p_quien);
        if (v_res->>'descartada')::boolean then v_desc := v_desc + 1;
        elsif (v_res->>'existente')::boolean then v_ya := v_ya + 1;
        else v_prop := v_prop + 1; end if;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('propuestas', v_prop, 'yaEstaban', v_ya, 'descartadas', v_desc, 'sinPropuesta', v_sin);
end $$;
revoke all on function public.conta_proponer_recibidos(uuid, date, date, text) from public, anon;
grant execute on function public.conta_proponer_recibidos(uuid, date, date, text) to authenticated, service_role;
comment on function public.conta_proponer_recibidos(uuid, date, date, text) is
  'S01 · PR 3: propone lo recibido sin factura de los meses acabados del rango (navegador y pasada de noche); lo que no puede, a conta_propuesta_pendiente (Compras). No valida.';
