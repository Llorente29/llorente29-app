-- supabase/vuelta-atras/20261115T0110_d01_liquidaciones_referencia_foodint.down.sql
-- Deshace la 0110 del 15: devuelve las 7 facturas de comisión desde su copia
-- (con sus líneas y su IVA, los mismos ids), las vuelve a enganchar a su
-- liquidación, quita la marca de referencia y vuelve a decir lo que queda por
-- aclarar. Después borra la copia.
-- Freno: la copia de esta tanda tiene 7, ninguna de esas facturas existe ya y
-- las 7 liquidaciones siguen de referencia y sin factura; si no, para sin tocar
-- nada. En una base sin la copia (staging), no hace nada.
do $$
declare
  v_tanda constant text := '20261115T0110_d01_liquidaciones_referencia_foodint';
  n int; n_ya int; n_liq int; cols_i text; cols_l text; cols_t text; r record;
begin
  if to_regclass('public.conta_respaldo_liquidacion_factura') is null then return; end if;
  select count(*) into n from public.conta_respaldo_liquidacion_factura where conta_respaldo_liquidacion_factura.tanda = v_tanda;
  if n = 0 then return; end if;
  select count(*) into n_ya from public.conta_respaldo_liquidacion_factura c join public.supplier_invoice i on i.id = c.invoice_id where c.tanda = v_tanda;
  select count(*) into n_liq from public.conta_respaldo_liquidacion_factura c join public.channel_settlement s on s.id = c.settlement_id
   where c.tanda = v_tanda and s.is_reference and s.commission_invoice_id is null;
  if n <> 7 or n_ya <> 0 or n_liq <> 7 then
    raise exception 'VUELTA ATRÁS 0110 del 15 (referencia) PARADA: la copia tiene %, % ya existen y % liquidaciones siguen de referencia sin factura (se esperaban 7, 0 y 7). No se toca nada.', n, n_ya, n_liq
      using errcode = 'P0001';
  end if;
  -- Las columnas que se pueden escribir (number_key es generada).
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_i from information_schema.columns
   where table_schema = 'public' and table_name = 'supplier_invoice' and is_generated = 'NEVER';
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_l from information_schema.columns
   where table_schema = 'public' and table_name = 'supplier_invoice_line' and is_generated = 'NEVER';
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_t from information_schema.columns
   where table_schema = 'public' and table_name = 'supplier_invoice_tax' and is_generated = 'NEVER';
  execute format('insert into public.supplier_invoice (%1$s) select %1$s from public.conta_respaldo_liquidacion_factura c, jsonb_populate_record(null::public.supplier_invoice, c.invoice) where c.tanda = %2$L', cols_i, v_tanda);
  execute format('insert into public.supplier_invoice_line (%1$s) select %1$s from public.conta_respaldo_liquidacion_factura c, jsonb_populate_recordset(null::public.supplier_invoice_line, c.lines) where c.tanda = %2$L', cols_l, v_tanda);
  execute format('insert into public.supplier_invoice_tax (%1$s) select %1$s from public.conta_respaldo_liquidacion_factura c, jsonb_populate_recordset(null::public.supplier_invoice_tax, c.taxes) where c.tanda = %2$L', cols_t, v_tanda);
  update public.channel_settlement s set commission_invoice_id = c.invoice_id, is_reference = null, updated_at = now()
    from public.conta_respaldo_liquidacion_factura c where c.tanda = v_tanda and s.id = c.settlement_id;
  for r in select settlement_id from public.conta_respaldo_liquidacion_factura c where c.tanda = v_tanda loop
    perform public._conta_liquidacion_marcar(r.settlement_id);
  end loop;
  delete from public.conta_respaldo_liquidacion_factura c where c.tanda = v_tanda;
  raise notice 'Vuelta atrás: % facturas devueltas a su liquidación.', n;
end $$;
drop table if exists public.conta_respaldo_liquidacion_factura;
