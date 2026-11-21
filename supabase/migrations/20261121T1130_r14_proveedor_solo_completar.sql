-- supabase/migrations/20261121T1130_r14_proveedor_solo_completar.sql
--
-- R14 · El proveedor nuevo se da de alta solo. 3 de 3: las recibidas YA LEÍDAS sin
-- proveedor se completan al aplicar (encargo R14, punto 3), en todas las cuentas. Va
-- detrás de la 1110 y la 1120. Escribe sobre lo que existe (supplier_invoice.supplier_id,
-- y proveedores y subcuentas nuevos): pide autorizo.
--
-- Solo las que no tienen proveedor, traen lectura de factura y no están validadas,
-- pagadas, descartadas ni anuladas (lo validado no se toca: lo mira _conta_proveedor_solo).
-- Las que no se pueden completar quedan con su motivo en conta_proveedor_solo. Lo que
-- cuenta antes y después: scripts/conta/produccion/cuentas/r14-proveedor-solo.sql.
-- Se puede pasar dos veces (la segunda no encuentra nada).
-- Vuelta atrás: supabase/vuelta-atras/20261121T1130_r14_proveedor_solo_completar.down.sql

do $$
declare r record; v jsonb;
begin
  create temp table if not exists _r14 (account_id uuid, company_id uuid, que text, motivo text) on commit drop;
  truncate _r14;
  for r in
    select i.id, i.account_id, i.company_id from public.supplier_invoice i
     where i.supplier_id is null and coalesce(i.reading, '{}'::jsonb) ? 'factura'
       and i.status not in ('descartada', 'anulada', 'pagada')
       and not exists (select 1 from public.conta_proveedor_solo x where x.invoice_id = i.id)
     order by i.account_id, i.company_id, i.created_at, i.id
  loop
    v := public._conta_proveedor_solo(r.id, 'al_aplicar');
    insert into _r14 values (r.account_id, r.company_id, v->>'que',
      case when v->>'que' = 'no' then regexp_replace(v->>'motivo', '\(.*?\)', '(…)', 'g') when v->>'que' = 'ya' then v->>'motivo' end);
  end loop;
  -- Lo que ha hecho, por cuenta y empresa (los ids cortados a 8, sin nombres ni NIF).
  for r in select left(account_id::text, 8) a, left(company_id::text, 8) e,
                  count(*) filter (where que = 'alta') alta, count(*) filter (where que = 'existente') existente,
                  count(*) filter (where que = 'plataforma') plataforma, count(*) filter (where que = 'no') no,
                  count(*) filter (where que = 'ya') ya,
                  string_agg(distinct motivo, ' | ') filter (where que in ('no', 'ya')) motivos
             from _r14 group by 1, 2 order by 1, 2 loop
    raise notice 'R14 · cuenta % · empresa % · al aplicar: % con un proveedor nuevo, % con uno que ya estaba, % de una plataforma; % sin completar y % que no se tocan. Motivos: %.',
      r.a, r.e, r.alta, r.existente, r.plataforma, r.no, r.ya, coalesce(r.motivos, 'ninguno');
  end loop;
  -- Regla 31 · La tabla de lo que vende contra lo que se apuntó DE VERDAD: las recibidas con
  -- líneas y asiento validado, la hoja de su gasto (la cuenta del 6 al debe) contra la que
  -- propone la tabla por sus líneas. Por cuenta (ids cortados a 8): cuántas tienen líneas,
  -- a cuántas propone algo, y de las validadas, cuántas propone bien.
  for r in
    with f as (
      select i.account_id, i.id, public._conta_gasto_por_venta(array(select l.raw_text from public.supplier_invoice_line l where l.supplier_invoice_id = i.id order by l.position))->>'hoja' hoja,
             (select a.template_code from public.journal_entry e join public.journal_line jl on jl.entry_id = e.id and jl.debit > 0
                join public.company_account a on a.id = jl.company_account_id and a.code like '6%'
               where e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status = 'validado'
               order by jl.debit desc limit 1) verdad
        from public.supplier_invoice i
       where coalesce(i.reading, '{}'::jsonb) ? 'factura' and exists (select 1 from public.supplier_invoice_line l where l.supplier_invoice_id = i.id)
    )
    select left(account_id::text, 8) a, count(*) n, count(hoja) propone, count(verdad) validadas,
           count(*) filter (where verdad is not null and hoja is not null) validadas_con_propuesta,
           count(*) filter (where verdad is not null and hoja = left(verdad, 3)) bien
      from f group by 1 order by 1
  loop
    raise notice 'R14 · regla 31 · cuenta % · % leídas con líneas; la tabla propone en %; de % validadas, propone en % y acierta la hoja en %.',
      r.a, r.n, r.propone, r.validadas, r.validadas_con_propuesta, r.bien;
  end loop;
end $$;
