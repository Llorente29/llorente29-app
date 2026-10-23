-- supabase/vuelta-atras/20261208T0870_d07_uber_quitar_provisionales.down.sql
--
-- Vuelta atrás de 20261208T0870: las facturas provisionales vuelven tal cual,
-- con sus líneas y su IVA, desde el respaldo; cada liquidación recupera su
-- enlace, su marca de revisar y su nota como estaban; y se quita el respaldo.
-- Una liquidación que entretanto se enlazó con una factura de verdad se queda
-- con la suya (no se pisa). Sin respaldo (staging), no hace nada.
do $$
declare v_cols text; r record; v_n int := 0;
begin
  if to_regclass('public.conta_respaldo_d07_provisionales') is null then
    raise notice 'D07 0870 vuelta atrás: no hay respaldo: nada que devolver.';
    return;
  end if;
  -- Las columnas que se escriben (number_key es generada).
  for r in select t.tabla from (values (1, 'supplier_invoice'), (2, 'supplier_invoice_line'), (3, 'supplier_invoice_tax')) t(o, tabla) order by t.o loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = r.tabla and c.is_generated = 'NEVER';
    execute format('insert into public.%1$I (%2$s) select %2$s from public.conta_respaldo_d07_provisionales b, '
                   'jsonb_populate_record(null::public.%1$I, b.fila) where b.tabla = %3$L on conflict do nothing', r.tabla, v_cols, r.tabla);
  end loop;
  update public.channel_settlement cs
     set commission_invoice_id = (b.fila->>'commission_invoice_id')::uuid,
         needs_review = (b.fila->>'needs_review')::boolean,
         review_note = b.fila->>'review_note',
         updated_at = (b.fila->>'updated_at')::timestamptz
    from public.conta_respaldo_d07_provisionales b
   where b.tabla = 'channel_settlement' and cs.id = b.id and cs.commission_invoice_id is null;
  get diagnostics v_n = row_count;
  raise notice 'D07 0870 vuelta atrás: las provisionales, de vuelta; % liquidaciones con su enlace de antes.', v_n;
end $$;
drop table if exists public.conta_respaldo_d07_provisionales;
