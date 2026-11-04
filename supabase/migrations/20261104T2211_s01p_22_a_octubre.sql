-- supabase/migrations/20261104T2211_s01p_22_a_octubre.sql
--
-- S01p · 4 · Foodint: las 22 facturas de OCTUBRE asentadas en noviembre pasan
-- a la fecha de su factura (Julio, S01p·9, camino A: borrar y volver a apuntar,
-- «sin dejar rastro sucio», como el 4/3313). Mueve filas: va con autorizo. El
-- real lo lanza Julio.
--
-- Lo medido en producción (solo lectura, 04/11): 22 facturas recibidas con
-- fecha de octubre (2.544,14 €), entradas del 01/11 al 03/11 y asentadas el día
-- en que entraron por la regla V04 (que la 2210 cambia). Las 22: validadas,
-- serie 2, con su IVA, en el BORRADOR del 303 del 4T; ninguna enviada a Diez ni
-- casada en el banco.
--
-- Cómo, en una transacción:
--   1. Las 22, las medidas (las vuelve a contar y para si no son 22 ni suman
--      2.544,14 €, o si alguna se envió a Diez, está casada o ya no está en
--      noviembre).
--   2. Copia del 303 del 4T entero y fuera sus líneas (si no, no se puede
--      renumerar lo de detrás), como en S01q·7 y el 3313.
--   3. _conta_asientos_borrar de las 22 (respaldo, serie 2 renumerada, cadena).
--   4. Cada una otra vez, desde su respaldo: el mismo asiento y los mismos
--      apuntes, con la FECHA DE SU FACTURA; su documento; el enlace a su
--      factura; y validado como Julio (journal_entry_validar: número siguiente
--      de la serie 2, huella encadenada; el disparador del libro registro pone
--      su IVA).
--   5. El 303 del 4T, otra vez calculado.
--   Antes de dejarlo hecho comprueba: el IVA del 4T igual que antes; las 22 con
--   su asiento validado con la fecha de su factura; los mismos euros en el debe.
-- Sin Foodint (staging), no hace nada.
--
-- sin hueco: _conta_asientos_borrar renumera la serie 2 de 2026 y recalcula la cadena; los 22 de nuevo toman los números siguientes de la serie 2, sin huecos.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := 'e298629b-9d34-4d62-9a00-ff7c3fa29a1a';
  v_303 constant uuid := '8ae554ae-4853-42c9-b5b0-346840223d47';
  v_ids uuid[]; v_n int; v_total numeric; v_debe_antes numeric; v_debe_despues numeric;
  v_iva_antes numeric; v_iva_despues numeric; r jsonb; v_lote uuid; b record; v_nuevo uuid; v_fecha date; v_factura uuid;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01p·4: sin la cuenta de Foodint, no hay nada que mover.';
    return;
  end if;

  -- 1 · Las 22, las medidas.
  select array_agg(e.id order by i.invoice_date, e.number), count(*), sum(i.grand_total)
    into v_ids, v_n, v_total
    from public.supplier_invoice i join public.journal_entry e on e.id = i.journal_entry_id
   where i.account_id = v_acc and e.company_id = v_e and e.account_id = v_acc
     and i.invoice_date between date '2026-10-01' and date '2026-10-31' and e.entry_date >= date '2026-11-01'
     and e.status = 'validado' and e.source_type = 'supplier_invoice' and e.series = 2
     and i.created_at < timestamptz '2026-11-04 19:00+00';
  if v_n is distinct from 22 or v_total is distinct from 2544.14 then
    raise exception 'S01p·4: tenían que ser 22 facturas de octubre asentadas en noviembre (2.544,14 €) y son % (% €): no se mueve nada.', v_n, v_total;
  end if;
  if exists (select 1 from public.external_send x where x.entry_id = any(v_ids))
     or exists (select 1 from public.bank_match k where k.journal_entry_id = any(v_ids)) then
    raise exception 'S01p·4: alguna de las 22 se ha enviado a Diez o está casada en el banco: no se mueve nada.';
  end if;
  select coalesce(sum(l.debit), 0) into v_debe_antes from public.journal_line l where l.entry_id = any(v_ids);

  -- 2 · El 303 del 4T: en borrador y sin presentar; copia entera y fuera sus líneas.
  if not exists (select 1 from public.tax_return t where t.id = v_303 and t.company_id = v_e and t.form_code = '303'
                    and t.fiscal_year = 2026 and t.period = '4T' and t.status = 'draft' and t.filed_at is null) then
    raise exception 'S01p·4: el 303 del 4T de 2026 ya no está en borrador (lo han revisado o presentado): no se mueve nada.';
  end if;
  create table if not exists public.conta_s01p4_303_antes as
    select 'declaracion'::text as que, to_jsonb(t) as fila from public.tax_return t where t.id = v_303
    union all select 'linea', to_jsonb(l) from public.tax_return_line l where l.tax_return_id = v_303
    union all select 'caja', to_jsonb(x) from public.tax_return_box x where x.tax_return_id = v_303
    union all select 'comprobacion', to_jsonb(c) from public.tax_return_check c where c.tax_return_id = v_303;
  alter table public.conta_s01p4_303_antes enable row level security;
  revoke all on table public.conta_s01p4_303_antes from public, anon, authenticated;
  select coalesce(sum(v.tax_amount), 0) into v_iva_antes from public.vat_book_entry v
   where v.company_id = v_e and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31';
  delete from public.tax_return_line t where t.tax_return_id = v_303;

  -- 3 · Se borran las 22.
  r := public._conta_asientos_borrar(v_e, v_ids,
         'S01p·4 · Facturas de octubre asentadas en noviembre (regla V04): se vuelven a apuntar con la fecha de su factura. Julio, 04/11.',
         'Julio (tanda S01p·4)');
  v_lote := (r->>'lote')::uuid;
  raise notice 'S01p·4: %', r->>'texto';

  -- 4 · Cada una otra vez, con la fecha de su factura, validada como Julio (como en la pantalla).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_julio, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_acc::text, true);
  for b in select * from public.conta_asiento_borrado where lote = v_lote and que = 'asiento'
            order by (asiento->>'document_date')::date nulls last, (asiento->>'number')::int loop
    v_factura := (b.asiento->>'source_id')::uuid;
    select i.invoice_date into v_fecha from public.supplier_invoice i where i.id = v_factura and i.account_id = v_acc;
    if v_fecha is null or v_fecha not between date '2026-10-01' and date '2026-10-31' then
      raise exception 'S01p·4: el asiento %/% no es de una factura de octubre: no se mueve nada.', b.asiento->>'series', b.numero_antes;
    end if;
    if jsonb_array_length(coalesce(b.enlaces->'factura_pago', '[]')) > 0 or jsonb_array_length(coalesce(b.enlaces->'diez_autorizo', '[]')) > 0
       or jsonb_array_length(coalesce(b.enlaces->'iva_reabierto', '[]')) > 0 then
      raise exception 'S01p·4: el asiento %/% tiene un pago, un autorizo de Diez o un IVA reabierto: no se mueve nada.', b.asiento->>'series', b.numero_antes;
    end if;
    v_nuevo := gen_random_uuid();
    insert into public.journal_entry
    select * from jsonb_populate_record(null::public.journal_entry, b.asiento || jsonb_build_object(
      'id', v_nuevo, 'entry_date', v_fecha, 'status', 'propuesto', 'number', null, 'chain_seq', null, 'prev_hash', null, 'hash', null,
      'validated_at', null, 'validated_by', null, 'validated_by_name', null, 'updated_at', now(),
      'confidence', 'seguro', 'reason', 'S01p·4: el mismo asiento de su factura, con la fecha de su factura (antes ' || (b.asiento->>'series') || '/' || b.numero_antes || ', del ' || to_char((b.asiento->>'entry_date')::date, 'DD/MM') || ').'));
    insert into public.journal_line
    select x.* from jsonb_array_elements(b.lineas) j,
           jsonb_populate_record(null::public.journal_line, j || jsonb_build_object('id', gen_random_uuid(), 'entry_id', v_nuevo)) x;
    insert into public.journal_entry_document
    select x.* from jsonb_array_elements(b.documentos) j,
           jsonb_populate_record(null::public.journal_entry_document, j || jsonb_build_object('id', gen_random_uuid(), 'entry_id', v_nuevo)) x;
    update public.document_activity set journal_entry_id = v_nuevo where id in (select (j #>> '{}')::uuid from jsonb_array_elements(coalesce(b.enlaces->'actividad', '[]')) j);
    update public.conta_liquidacion_resolucion set entry_id = v_nuevo where id in (select (j #>> '{}')::uuid from jsonb_array_elements(coalesce(b.enlaces->'resolucion', '[]')) j);
    perform public.journal_entry_validar(v_nuevo, 'Julio (tanda S01p·4)');
    update public.supplier_invoice set journal_entry_id = v_nuevo, updated_at = now() where id = v_factura and account_id = v_acc;
  end loop;
  perform set_config('request.jwt.claims', '', true);

  -- Lo que queda: las 22 facturas, cada una con su asiento validado con su fecha; los mismos euros.
  select count(*) into v_n from public.supplier_invoice i join public.journal_entry e on e.id = i.journal_entry_id
   where i.id in (select (b.asiento->>'source_id')::uuid from public.conta_asiento_borrado b where b.lote = v_lote and b.que = 'asiento')
     and e.status = 'validado' and e.entry_date = i.invoice_date and e.series = 2;
  if v_n <> 22 then raise exception 'S01p·4: solo % de las 22 quedan con su asiento validado con la fecha de su factura: no se mueve nada.', v_n; end if;
  select coalesce(sum(l.debit), 0) into v_debe_despues from public.journal_line l join public.journal_entry e on e.id = l.entry_id
   join public.supplier_invoice i on i.journal_entry_id = e.id
   where i.id in (select (b.asiento->>'source_id')::uuid from public.conta_asiento_borrado b where b.lote = v_lote and b.que = 'asiento');
  if v_debe_despues <> v_debe_antes then raise exception 'S01p·4: el debe de las 22 pasa de % a %: no se mueve nada.', v_debe_antes, v_debe_despues; end if;

  -- 5 · El borrador del 303 del 4T, otra vez calculado; el IVA del 4T, igual.
  r := public.conta_impuesto_303_calcular(v_e, 2026, '4T');
  if not exists (select 1 from public.tax_return t where t.id = v_303 and t.status = 'draft' and t.filed_at is null and t.calculated_at > now() - interval '1 minute') then
    raise exception 'S01p·4: el borrador del 303 no ha quedado recalculado: no se mueve nada.';
  end if;
  select coalesce(sum(v.tax_amount), 0) into v_iva_despues from public.vat_book_entry v
   where v.company_id = v_e and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31';
  if v_iva_antes <> v_iva_despues then
    raise exception 'S01p·4: el IVA del 4T no podía cambiar y pasa de % a %: no se mueve nada.', v_iva_antes, v_iva_despues;
  end if;
  raise notice 'S01p·4: 22 facturas en octubre, validadas con la fecha de su factura (debe %). IVA del 4T sin cambios: %. El 303: %.',
    v_debe_despues, v_iva_despues, (select format('%s · %s €', t.result_kind, t.amount) from public.tax_return t where t.id = v_303);
end $$;
