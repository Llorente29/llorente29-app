-- supabase/migrations/20261026T0642_pc01_sin_delete_sin_where.sql
--
-- PC01 · arreglo urgente (respuesta 6 de Julio, 26/10). Por la API, el rol
-- authenticator carga safeupdate (session_preload_libraries = supautils,
-- safeupdate), y safeupdate para todo DELETE o UPDATE sin WHERE, también dentro
-- de una función security definer. Tres funciones vaciaban sus tablas
-- temporales así, y cualquier llamada que llega desde la app fallaba entera:
--
--   1. _conta_liquidacion_cobros (del #330): la llaman los disparadores
--      pc01_liquidacion_cobrada (channel_settlement), pc01_factura_cierre_nace
--      (customer_invoice) y pc01_tienda_cambiada (platform_store). Casar en
--      Bancos el ingreso de una liquidación fallaba con «bank_casar: DELETE
--      requires a WHERE clause» (e2e b01, 6 pruebas).
--   2. _compras_fin_de_mes: la llama compras_fin_de_mes (rpc de Compras, fin
--      de mes).
--   3. recost_sales_for_product: rpc del almacén (warehouseReliabilityService),
--      «recalcular el consumo de un producto».
--
-- Las tres, con la misma firma (create or replace, sin sobrecargas) y el mismo
-- texto que hay en producción, salvo una cosa: «delete from <temporal>;» pasa
-- a «delete from <temporal> where true;». Nada más.
--
-- Por qué «where true» y no «truncate»: hace exactamente lo mismo que hoy (el
-- mismo borrado, fila a fila, en la misma transacción), y es lo que el propio
-- safeupdate acepta. TRUNCATE cambiaría el comportamiento: (a) para con «cannot
-- TRUNCATE … because it is being used by active queries» si se llama mientras
-- otra consulta de la misma sesión recorre la tabla, y la de los cobros va
-- dentro de disparadores por fila; (b) cada TRUNCATE de una temporal le da un
-- fichero nuevo, y el disparador por fila lo haría una vez por fila en una
-- actualización masiva. Las tablas tienen unas pocas filas: borrarlas no cuesta.
--
-- No toca datos. La comprobación nueva (scripts/conta/sql-sin-where.mjs, en
-- antes-de-subir.sh y en pr-a-main.yml) para cualquier migración que vuelva a
-- traer un DELETE o un UPDATE sin WHERE.
--
-- cambia: public._conta_liquidacion_cobros · prueba: supabase/staging/sql/20261026_pc01_sin_delete_sin_where_prueba.sql
-- cambia: public._compras_fin_de_mes · prueba: supabase/staging/sql/20261026_pc01_sin_delete_sin_where_prueba.sql
-- cambia: public.recost_sales_for_product · prueba: supabase/staging/sql/20261026_pc01_sin_delete_sin_where_prueba.sql

create or replace function public._conta_liquidacion_cobros(p_settlement uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cs public.channel_settlement; v_n int; v_esperados int; v_sin_cierre int; v_sin_factura int; v_mal_total text;
        v_pasa text; v_motivo text; v_facturas int := 0; v_total numeric := 0; f record; v_plat text; v_via text; v_res jsonb; v_porque text;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement for update;
  if v_cs.id is null then return jsonb_build_object('liquidacion', p_settlement, 'estado', 'no_existe'); end if;
  select coalesce(name, slug) into v_plat from public.sales_channel where id = v_cs.channel_id;
  if to_regclass('pg_temp._pc01_pedidos') is null then
    create temp table _pc01_pedidos (sale_id uuid, company_id uuid, location_id uuid, sales_day date, summary_id uuid, invoice_id uuid, importe numeric, via text) on commit drop;
    create temp table _pc01_antes (invoice_id uuid, importe numeric) on commit drop;
    create temp table _pc01_ahora (invoice_id uuid, importe numeric, n int) on commit drop;
  end if;
  delete from _pc01_pedidos where true; delete from _pc01_antes where true; delete from _pc01_ahora where true;
  -- Lo que esta liquidación tenía cobrado: se quita siempre, y al final se dice lo que ha cambiado.
  insert into _pc01_antes select invoice_id, sum(amount) from public.customer_invoice_payment where settlement_id = v_cs.id group by invoice_id;
  delete from public.customer_invoice_payment where settlement_id = v_cs.id;

  if v_cs.collected_on is null then
    v_res := jsonb_build_object('liquidacion', v_cs.id, 'estado', 'sin_cobrar');
    v_porque := 'la liquidación ya no está cobrada';
    update public.channel_settlement set invoice_match_status = null, invoice_match_note = null where id = v_cs.id
       and (invoice_match_status is not null or invoice_match_note is not null);
  elsif coalesce(v_cs.flow_type, '') = 'licensed' then
    -- Una liquidación de una marca cedida no cobra facturas tuyas: su dinero es del socio.
    v_res := jsonb_build_object('liquidacion', v_cs.id, 'estado', 'cedida');
    v_porque := 'es de una marca cedida';
    update public.channel_settlement set invoice_match_status = null, invoice_match_note = 'Es de una marca cedida: su dinero es del socio, no cobra facturas tuyas.' where id = v_cs.id;
  else
    insert into _pc01_pedidos select * from public.conta_liquidacion_pedidos(v_cs.id);
    select count(*), count(*) filter (where summary_id is null), count(*) filter (where summary_id is not null and invoice_id is null), max(via)
      into v_n, v_sin_cierre, v_sin_factura, v_via from _pc01_pedidos;
    -- Cuántos tenía que haber: los que dice la liquidación.
    if v_via = 'pedidos' then
      select count(*) into v_esperados from public.channel_settlement_order where settlement_id = v_cs.id and account_id = v_cs.account_id;
    else
      v_esperados := v_cs.orders_count;
    end if;
    if v_n = 0 and v_cs.brand_id is null and v_cs.store_id is not null
       and not exists (select 1 from public.platform_store where id = v_cs.store_id and brand_id is not null) then
      v_motivo := 'su tienda no tiene marca: dísela en Ventas › Liquidaciones y se cobran sus facturas';
    elsif v_n = 0 then
      v_motivo := 'no encuentro sus pedidos en Folvy';
    elsif v_esperados is null then
      v_motivo := format('no dice cuántos pedidos trae, y en Folvy hay %s: no lo doy por bueno a ciegas', v_n);
    elsif v_esperados <> v_n then
      v_motivo := format('trae %s pedidos y en Folvy hay %s', v_esperados, v_n);
    elsif v_sin_cierre > 0 then
      v_motivo := format('%s de sus %s pedidos no están en ningún cierre del día', v_sin_cierre, v_n);
    elsif v_sin_factura > 0 then
      v_motivo := format('%s de sus %s pedidos están en un cierre que aún no tiene factura (sin validar)', v_sin_factura, v_n);
    end if;
    -- Cada factura: lo que suma su cierre por pedido tiene que ser su total (si
    -- no, el reparto no sería el de su cierre), y no se cobra de más.
    if v_motivo is null then
      select string_agg(x.number_text, ', ') into v_mal_total from (
        select ci.number_text from (select distinct p.invoice_id, p.summary_id from _pc01_pedidos p) u
          join public.customer_invoice ci on ci.id = u.invoice_id
          join public.sales_day_summary sm on sm.id = u.summary_id
         where abs(ci.total - coalesce((select sum(d2.total) from public.conta_pedidos_del_dia(sm.company_id, sm.location_id, sm.sales_day) d2 where d2.id = any(sm.sale_ids)), 0)) >= 0.005
      ) x;
      if v_mal_total is not null then v_motivo := format('el cierre de %s no cuenta sus pedidos por su total', v_mal_total); end if;
    end if;
    if v_motivo is null then
      select string_agg(x.number_text, ', ') into v_pasa from (
        select ci.number_text from (select p.invoice_id, sum(p.importe) imp from _pc01_pedidos p group by p.invoice_id) u
          join public.customer_invoice ci on ci.id = u.invoice_id
         where coalesce((select sum(amount) from public.customer_invoice_payment c where c.invoice_id = ci.id), 0) + u.imp > ci.total + 0.005
      ) x;
      if v_pasa is not null then v_motivo := format('cobraría de más %s (ya tiene otros cobros por esos pedidos)', v_pasa); end if;
    end if;

    if v_motivo is not null then
      v_porque := 'la liquidación está a revisar: ' || v_motivo;
      update public.channel_settlement set invoice_match_status = 'a_revisar',
             invoice_match_note = 'A revisar: ' || v_motivo || '. No he cobrado ninguna factura.' where id = v_cs.id;
      v_res := jsonb_build_object('liquidacion', v_cs.id, 'estado', 'a_revisar', 'motivo', v_motivo, 'pedidos', v_n, 'esperados', v_esperados);
    else
      insert into _pc01_ahora select p.invoice_id, round(sum(p.importe), 2), count(*) from _pc01_pedidos p group by p.invoice_id;
      for f in select * from _pc01_ahora loop
        insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, settlement_id, created_by, created_by_name)
        select ci.account_id, ci.company_id, ci.id, v_cs.collected_on, f.importe, 'plataforma',
               format('%s pedido%s de la liquidación de %s del %s al %s', f.n, case when f.n = 1 then '' else 's' end, coalesce(v_plat, 'la plataforma'),
                      to_char(v_cs.period_from, 'DD/MM'), to_char(v_cs.period_to, 'DD/MM/YYYY')),
               v_cs.id, v_cs.collected_by, coalesce(v_cs.collected_by_name, 'Sumied · liquidación')
          from public.customer_invoice ci where ci.id = f.invoice_id;
        -- El historial, solo si cambia (volver a mirar una liquidación no lo repite).
        if not exists (select 1 from _pc01_antes a where a.invoice_id = f.invoice_id and a.importe = f.importe) then
          perform public._conta_venta_evento(f.invoice_id, 'cobro',
            format('Cobrados %s de %s pedido%s por la liquidación de %s del %s al %s.', public.conta_euros_exactos(f.importe), f.n, case when f.n = 1 then '' else 's' end,
                   coalesce(v_plat, 'la plataforma'), to_char(v_cs.period_from, 'DD/MM'), to_char(v_cs.period_to, 'DD/MM/YYYY')),
            jsonb_build_object('liquidacion', v_cs.id), coalesce(v_cs.collected_by_name, 'Sumied · liquidación'));
        end if;
        v_facturas := v_facturas + 1; v_total := v_total + f.importe;
      end loop;
      update public.channel_settlement set invoice_match_status = 'cobradas',
             invoice_match_note = format('Cobradas %s factura%s por %s (%s pedido%s).', v_facturas, case when v_facturas = 1 then '' else 's' end,
                                         public.conta_euros_exactos(v_total), v_n, case when v_n = 1 then '' else 's' end) where id = v_cs.id;
      v_res := jsonb_build_object('liquidacion', v_cs.id, 'estado', 'cobradas', 'facturas', v_facturas, 'importe', v_total, 'pedidos', v_n);
    end if;
  end if;

  -- Lo que tenía cobrado y ya no: se dice en su factura.
  for f in select a.* from _pc01_antes a where not exists (select 1 from _pc01_ahora n where n.invoice_id = a.invoice_id) loop
    perform public._conta_venta_evento(f.invoice_id, 'cobro_deshecho',
      format('Quitado el cobro de %s de la liquidación de %s del %s al %s: %s.', public.conta_euros_exactos(f.importe), coalesce(v_plat, 'la plataforma'),
             to_char(v_cs.period_from, 'DD/MM'), to_char(v_cs.period_to, 'DD/MM/YYYY'), coalesce(v_porque, 'ha cambiado')),
      jsonb_build_object('liquidacion', v_cs.id), coalesce(v_cs.collected_by_name, 'Sumied · liquidación'));
  end loop;
  return v_res;
end $$;

create or replace function public._compras_fin_de_mes(p_empresa uuid, p_mes date)
returns setof public.purchase_accrual language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_ini date := date_trunc('month', p_mes)::date; v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_corte date; v_unica boolean;
begin
  select account_id into v_cuenta from company where id = p_empresa;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  select max(imported_until) into v_corte from fiscal_year where company_id = p_empresa;
  v_unica := (select count(*) = 1 from company where account_id = v_cuenta and is_active);

  create temp table if not exists _fin_de_mes (supplier_id uuid, location_id uuid, receipts jsonb, base numeric, sin_base int) on commit drop;
  delete from _fin_de_mes where true;
  insert into _fin_de_mes
  select g.supplier_id, g.location_id,
         jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'fecha', g.receipt_date, 'base', public._compras_base_recepcion(g.id)) order by g.receipt_date, g.code),
         coalesce(sum(public._compras_base_recepcion(g.id)), 0), count(*) filter (where public._compras_base_recepcion(g.id) is null)::int
    from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
    left join supplier_invoice si on si.id = p.supplier_invoice_id
   where p.account_id = v_cuenta and p.path = 'pendiente_factura' and g.status = 'confirmado'
     and (p.company_id = p_empresa or (p.company_id is null and v_unica))
     and g.receipt_date <= v_fin and (v_corte is null or g.receipt_date > v_corte)
     and (p.supplier_invoice_id is null or si.status = 'anulada' or si.invoice_date > v_fin)
   group by g.supplier_id, g.location_id;

  -- Lo que ya no está (se facturó dentro del mes) y no tiene asiento: fuera.
  delete from purchase_accrual a
   where a.company_id = p_empresa and a.month = v_ini
     and not exists (select 1 from _fin_de_mes x where x.supplier_id = a.supplier_id and x.location_id is not distinct from a.location_id)
     and not exists (select 1 from journal_entry e where e.company_id = p_empresa and e.source_type in ('purchase_accrual', 'purchase_accrual_reversal')
                      and e.source_id = a.id and e.status in ('propuesto', 'borrador', 'validado'));
  insert into purchase_accrual (account_id, company_id, supplier_id, location_id, month, base, receipts, without_base, computed_at)
  select v_cuenta, p_empresa, x.supplier_id, x.location_id, v_ini, x.base, x.receipts, x.sin_base, now() from _fin_de_mes x
  on conflict (company_id, supplier_id, location_id, month) do update set
    base = excluded.base, receipts = excluded.receipts, without_base = excluded.without_base, computed_at = now()
  where not exists (select 1 from journal_entry e where e.company_id = p_empresa and e.source_type = 'purchase_accrual'
                     and e.source_id = purchase_accrual.id and e.status = 'validado');
  return query select * from purchase_accrual where company_id = p_empresa and month = v_ini order by base desc;
end $$;

create or replace function public.recost_sales_for_product(
  p_account_id   uuid,
  p_product_name text,
  p_days         integer default 30,
  p_dry_run      boolean default true
)
returns table(ventas_afectadas integer, lineas_afectadas integer, movimientos integer, aplicado boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_norm    text;
  v_sale    record;
  v_ventas  integer := 0;
  v_lineas  integer := 0;
  v_movs    integer := 0;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'recost_sales_for_product: sin acceso a la cuenta %', p_account_id;
  end if;

  v_norm := public.sales_product_norm(p_product_name);

  create temp table if not exists _recost_sales (sale_id uuid primary key) on commit drop;
  delete from _recost_sales where true;

  insert into _recost_sales (sale_id)
  select distinct s.id
    from sale_line sl
    join sale s on s.id = sl.sale_id
   where sl.account_id = p_account_id
     and s.is_active
     and s.sold_at >= now() - make_interval(days => greatest(p_days, 1))
     and coalesce(sl.line_type,'product') = 'product'
     and sl.ignored_at is null
     and public.sales_product_norm(sl.product_name) = v_norm;

  select count(*) into v_ventas from _recost_sales;

  select count(*) into v_lineas
    from sale_line sl
   where sl.account_id = p_account_id
     and sl.sale_id in (select sale_id from _recost_sales)
     and public.sales_product_norm(sl.product_name) = v_norm;

  if p_dry_run then
    return query select v_ventas, v_lineas, 0, false;
    return;
  end if;

  -- Casar las líneas viejas con el menu_item sellado de su matrícula, igual que
  -- haría el recast, pero acotado a este producto (no a la cuenta entera).
  update sale_line sl
     set menu_item_id = mi.id, map_source = 'manual', map_needs_review = false,
         unmapped_reason = null, updated_at = now()
    from sale s, menu_item mi
   where sl.sale_id = s.id
     and sl.account_id = p_account_id
     and sl.sale_id in (select sale_id from _recost_sales)
     and sl.menu_item_id is null
     and public.sales_product_norm(sl.product_name) = v_norm
     and mi.account_id = p_account_id
     and mi.external_source = 'lastapp'
     and mi.external_id = sl.external_product_id
     and mi.brand_id is not distinct from s.brand_id
     and mi.archived_at is null;

  for v_sale in select sale_id from _recost_sales loop
    v_movs := v_movs + coalesce(public.generate_sale_consumption(v_sale.sale_id), 0);
  end loop;

  return query select v_ventas, v_lineas, v_movs, true;
end;
$$;
