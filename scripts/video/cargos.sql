-- scripts/video/cargos.sql — V01 · los cargos de Revolut que vuelven, y su casado.
--
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -v cuenta=<uuid> -v empresa=<uuid> -v numeros=<n1,n2,n3> -f scripts/video/cargos.sql
--
-- SOLO el carril del run (como sembrar.sql). Lo que haría la lectura de
-- Revolut al llegar el aviso: un extracto «agregador:revolut» de hoy con un
-- cargo por pago (el importe exacto y la referencia del pago), y lo que haría
-- conta_pago_casar_banco: casar cada cargo con su factura por el núcleo de
-- verdad (_bank_casar_nucleo, «folvy»), que hace el asiento y marca la factura
-- pagada. No pasa por el sandbox: el pago de la pantalla no salió (ver guion.mjs).

\set ON_ERROR_STOP 1
select set_config('video.cuenta', :'cuenta', false), set_config('video.empresa', :'empresa', false), set_config('video.numeros', :'numeros', false);

do $$
declare
  c uuid := current_setting('video.cuenta')::uuid; e uuid := current_setting('video.empresa')::uuid;
  t uuid; st uuid; mv uuid; f record; n int := 0; res jsonb; codigo text; tercero uuid; hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  if split_part(c::text, '-', 2) = '0000' then raise exception 'V01: % es la plantilla, no un carril.', c; end if;
  select l.treasury_account_id into t from public.bank_aggregator_link l where l.company_id = e and l.provider = 'revolut';
  if t is null then raise exception 'V01: la empresa del carril no tiene Revolut enlazado.'; end if;

  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, period_from, period_to,
    opening_balance, closing_balance, movements_count, new_count, repeated_count, balanced, unchecked_reason, continuity, imported_by_name)
  values (c, e, t, 'agregador:revolut', 'api', hoy, hoy, null, null, 3, 3, 0, null, 'Vídeo V01: los cargos de los tres pagos.', 'sin_saldo', 'Revolut')
  returning id into st;

  for f in
    select si.id, si.invoice_number, si.grand_total, s.name as proveedor, s.legal_name, s.id as supplier_id
      from public.supplier_invoice si join public.supplier s on s.id = si.supplier_id
     where si.account_id = c and si.invoice_number = any (string_to_array(current_setting('video.numeros'), ','))
     order by si.grand_total desc
  loop
    n := n + 1;
    insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount,
      bank_concept, clean_concept, reference_1, reference_2, fingerprint, soft_fingerprint, status)
    values (c, e, t, st, hoy, hoy, -f.grand_total,
      'To ' || coalesce(f.legal_name, f.proveedor) || ' · ' || f.invoice_number, 'Transferencia a ' || f.proveedor || ' · ' || f.invoice_number,
      f.invoice_number, 'video-v01:' || f.id, 'video-v01|' || f.id, 'video-v01|' || f.id, 'pendiente')
    returning id into mv;

    select a.code into codigo from public.company_account_link l join public.company_account a on a.id = l.company_account_id
     where l.company_id = e and l.entity = 'supplier' and l.entity_id = f.supplier_id::text and l.role = 'principal';
    select pr.party_id into tercero from public.party_role pr where pr.supplier_id = f.supplier_id and pr.role = 'supplier' limit 1;
    res := public._bank_casar_nucleo(mv,
      jsonb_build_object('tipo', 'factura_recibida', 'facturas', jsonb_build_array(jsonb_build_object('id', f.id, 'importe', f.grand_total)),
                         'cuenta_tercero', codigo, 'tercero_id', tercero, 'concepto', 'Pago ' || f.invoice_number || ' · ' || f.proveedor),
      'seguro', 'Es el pago que salió desde Sumied por Revolut: el mismo importe y la referencia del pago.', '[]'::jsonb, 'folvy', null);
    raise notice 'Casado %: % (%)', f.invoice_number, f.grand_total, res;
  end loop;
  if n <> 3 then raise exception 'V01: tenía que casar 3 cargos y he encontrado % facturas.', n; end if;
end $$;

select si.invoice_number, si.status, si.paid_at is not null as pagada, m.status as cargo, b.by_who
  from public.supplier_invoice si
  join public.bank_match_item i on i.supplier_invoice_id = si.id
  join public.bank_match b on b.id = i.match_id and b.status = 'vivo'
  join public.bank_movement m on m.id = b.movement_id
 where si.account_id = :'cuenta' and si.invoice_number = any (string_to_array(:'numeros', ','));
