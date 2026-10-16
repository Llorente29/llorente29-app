-- supabase/migrations/20261118T0100_d01_compras_ficha.sql
--
-- D01 · Lo que Compras pregunta de la ficha de un proveedor (Julio, 16/10).
-- cambia: public.compras_mirar · prueba: supabase/staging/sql/20261118_d01_compras_ficha_prueba.sql
-- cambia: public.compras_ficha_le_falta · prueba: supabase/staging/sql/20261118_d01_compras_ficha_prueba.sql
--
-- 1 · Un proveedor de Foodint: su ficha ya dice cómo factura, pero Compras seguía con
--     «le falta cómo te factura». La pregunta «¿cómo factura?» de cada
--     recepción (goods_receipt_path.question = 'ficha_sin_forma') se guarda al
--     confirmarla. Al decir cómo factura, compras_forma_facturar vuelve a
--     decidir sus recepciones, pero se salta las ya usadas (su factura ya se
--     hizo desde el papel: consumed_at), y su pregunta se quedaba abierta para
--     siempre. Medido en producción el 16/10, solo leyendo: 4 así en Foodint,
--     de 2 proveedores, todas usadas y con la ficha ya
--     contestada; ninguna en otra cuenta. compras_mirar ya no las devuelve: la
--     pregunta está contestada y no queda nada por hacer. Si la ficha vuelve a
--     no decirlo, vuelven a salir; las no usadas siguen como estaban.
-- 2 · Otro proveedor de Foodint: sin tipo de gasto, pero sus facturas tienen
--     una cuenta suya (60000000). Son la misma pregunta —a qué cuenta van sus
--     facturas—: con el tipo de gasto o con su cuenta, ya no falta.
-- Los dos con la misma firma (y el mismo texto que la 0170 y la 0120 de
-- compras salvo esas líneas): las llamadas no cambian.
-- Vuelta atrás: supabase/vuelta-atras/20261118T0100_d01_compras_ficha.down.sql

create or replace function public.compras_mirar(p_cuenta uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_recepciones jsonb; v_sin_camino jsonb; v_fichas jsonb; v_desde date;
begin
  if not (select belongs_to_account(p_cuenta)) then raise exception 'Esa cuenta no es tuya.' using errcode = '42501'; end if;
  -- Desde el día siguiente al corte más tardío de las empresas de la cuenta.
  select coalesce(max(fy.imported_until) + 1, date '2000-01-01') into v_desde
    from fiscal_year fy join company c on c.id = fy.company_id where c.account_id = p_cuenta;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'recepcion', 'recepcion', g.id, 'codigo', g.code, 'fecha', g.receipt_date,
           'proveedor', g.supplier_id, 'proveedor_nombre', s.name, 'local', g.location_id, 'local_nombre', l.name,
           'base', public._compras_base_recepcion(g.id), 'papel', p.doc_type, 'a_nombre_de', p.bill_to_name,
           'camino', p.path, 'pregunta', p.question, 'detalle', p.question_detail, 'frase', p.reason, 'error', p.error,
           'factura', p.supplier_invoice_id, 'sesion', g.ai_session_id)
         order by g.receipt_date, g.code), '[]'::jsonb)
    into v_recepciones
    from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
    left join supplier s on s.id = g.supplier_id left join locations l on l.id = g.location_id
   where p.account_id = p_cuenta and p.question is not null and p.question is distinct from p.question_closed
     and g.status = 'confirmado'
     -- «¿Cómo factura?» ya está contestada si su ficha lo dice ahora, y no queda nada por hacer si
     -- ese papel ya se usó (su factura está hecha): volver a decidir no las toca (consumed_at).
     and not (p.question = 'ficha_sin_forma' and p.consumed_at is not null and s.invoicing_mode is not null);

  select coalesce(jsonb_agg(jsonb_build_object('tipo', 'sin_camino', 'recepcion', g.id, 'codigo', g.code, 'fecha', g.receipt_date,
           'proveedor_nombre', s.name, 'local_nombre', l.name) order by g.receipt_date), '[]'::jsonb)
    into v_sin_camino
    from goods_receipt g left join supplier s on s.id = g.supplier_id left join locations l on l.id = g.location_id
   where g.account_id = p_cuenta and g.status = 'confirmado' and g.receipt_date >= v_desde
     and not exists (select 1 from goods_receipt_path p where p.goods_receipt_id = g.id);

  -- Las fichas de los proveedores con compras abiertas (factura o pendiente) o que liquidan.
  select coalesce(jsonb_agg(jsonb_build_object('tipo', 'ficha', 'proveedor', x.id, 'proveedor_nombre', x.name, 'falta', x.falta) order by x.name), '[]'::jsonb)
    into v_fichas
    from (select s.id, s.name, public.compras_ficha_le_falta(s.id) falta from supplier s
           where s.account_id = p_cuenta and s.archived_at is null
             and (s.invoicing_mode = 'monthly_settlement'
                  or exists (select 1 from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
                              where g.supplier_id = s.id and p.path in ('factura', 'pendiente_factura', 'liquidacion')))) x
   where jsonb_array_length(x.falta) > 0;

  return jsonb_build_object('recepciones', v_recepciones, 'sin_camino', v_sin_camino, 'fichas', v_fichas);
end $$;
revoke all on function public.compras_mirar(uuid) from public, anon;
grant execute on function public.compras_mirar(uuid) to authenticated;

create or replace function public.compras_ficha_le_falta(p_proveedor uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s supplier; v jsonb := '[]'::jsonb; v_nif record; v_otros int; v_ultimo text;
begin
  select * into s from supplier where id = p_proveedor;
  if s.id is null or not (select belongs_to_account(s.account_id)) then
    raise exception 'Ese proveedor no es de tu cuenta.' using errcode = '42501';
  end if;
  if s.tax_id is null then
    select public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id') nif, count(*) veces into v_nif
      from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
     where g.account_id = s.account_id and g.supplier_id = s.id and g.status <> 'anulado'
       and public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id') is not null
     group by 1 order by 2 desc, 1 limit 1;
    select count(distinct public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id')) - 1 into v_otros
      from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
     where g.account_id = s.account_id and g.supplier_id = s.id and g.status <> 'anulado'
       and public.compras_nif_norm(a.parsed_result->'document'->>'supplier_tax_id') is not null;
    v := v || jsonb_build_object('falta', 'nif', 'ofrece', v_nif.nif, 'veces', v_nif.veces, 'otros_distintos', greatest(coalesce(v_otros, 0), 0));
  end if;
  -- El tipo de gasto y una cuenta solo suya para sus facturas contestan la misma pregunta:
  -- a qué cuenta van sus facturas. Con cualquiera de las dos, no falta.
  if s.expense_category_id is null
     and not exists (select 1 from company_account_link l where l.account_id = s.account_id and l.entity = 'supplier'
                      and l.entity_id = s.id::text and l.role = 'gasto') then
    v := v || jsonb_build_object('falta', 'tipo_gasto');
  end if;
  if s.invoicing_mode is null then
    select a.parsed_result->'document'->>'doc_type' into v_ultimo
      from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id
     where g.account_id = s.account_id and g.supplier_id = s.id and g.status <> 'anulado' and a.parsed_result->'document'->>'doc_type' is not null
     order by g.receipt_date desc, g.created_at desc limit 1;
    v := v || jsonb_build_object('falta', 'forma_facturar', 'ultimo_papel', v_ultimo);
  end if;
  return v;
end $$;
revoke all on function public.compras_ficha_le_falta(uuid) from public, anon;
grant execute on function public.compras_ficha_le_falta(uuid) to authenticated;
