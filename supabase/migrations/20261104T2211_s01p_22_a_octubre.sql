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
-- Las 22 toman números al final de la serie 2. Sumied no reordena la serie: el
-- número oficial es el de Diez (Julio, S01p·11: renumerar por fecha cambiaría
-- 2.948 números, 94 de ellos ya enviados a Diez).
--
-- El cómo vive en dos funciones (solo las llama una tanda), para que la prueba
-- de staging recorra el camino entero con una cuenta de mentira (Julio, S01p·10):
--   _s01p_facturas_a_su_fecha(empresa, asientos, 303, quién, motivo)
--   _s01p_facturas_a_su_fecha_deshacer(empresa, 303)
-- y la tanda de Foodint, abajo, solo mide y la llama. Sin Foodint, no hace nada.
--
-- sin hueco: _conta_asientos_borrar renumera la serie 2 de 2026 y recalcula la cadena; los 22 de nuevo toman los números siguientes de la serie 2, sin huecos.

create or replace function public._s01p_facturas_a_su_fecha(p_company uuid, p_entries uuid[], p_303 uuid, p_quien uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_n int; v_debe_antes numeric; v_debe_despues numeric; v_iva_antes numeric; v_iva_despues numeric;
  v_desde date; v_hasta date; v_anio int; v_periodo text; r jsonb; v_lote uuid; b record; v_nuevo uuid; v_fecha date; v_factura uuid;
  v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true);
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or coalesce(array_length(p_entries, 1), 0) = 0 then raise exception 'S01p·4: sin empresa o sin asientos.'; end if;
  -- Cada uno: validado, de una factura recibida, con fecha distinta de la de su factura; ni enviado a Diez ni casado.
  select count(*) into v_n from public.journal_entry e join public.supplier_invoice i on i.id = e.source_id and i.journal_entry_id = e.id
   where e.id = any(p_entries) and e.company_id = p_company and e.status = 'validado' and e.source_type = 'supplier_invoice'
     and i.invoice_date is not null and e.entry_date <> i.invoice_date;
  if v_n <> array_length(p_entries, 1) then raise exception 'S01p·4: % de los % asientos no son de una factura recibida validada con otra fecha: no se mueve nada.', array_length(p_entries, 1) - v_n, array_length(p_entries, 1); end if;
  if exists (select 1 from public.external_send x where x.entry_id = any(p_entries)) or exists (select 1 from public.bank_match k where k.journal_entry_id = any(p_entries)) then
    raise exception 'S01p·4: alguno se ha enviado a Diez o está casado en el banco: no se mueve nada.';
  end if;
  select coalesce(sum(l.debit), 0) into v_debe_antes from public.journal_line l where l.entry_id = any(p_entries);

  -- El 303 del periodo: en borrador y sin presentar; copia entera y fuera sus líneas (si no, no se puede renumerar lo de detrás).
  select t.fiscal_year, t.period, f.desde, f.hasta into v_anio, v_periodo, v_desde, v_hasta
    from public.tax_return t cross join lateral public.conta_impuesto_periodo_fechas(t.fiscal_year, t.period) f
   where t.id = p_303 and t.company_id = p_company and t.form_code = '303' and t.status = 'draft' and t.filed_at is null;
  if v_anio is null then raise exception 'S01p·4: el 303 indicado no está en borrador (o no es de la empresa): no se mueve nada.'; end if;
  if exists (select 1 from public.journal_entry e join public.supplier_invoice i on i.journal_entry_id = e.id
              where e.id = any(p_entries) and (i.invoice_date not between v_desde and v_hasta or e.entry_date not between v_desde and v_hasta)) then
    raise exception 'S01p·4: alguno sale del trimestre del 303 (su factura o su asiento): no se mueve nada.';
  end if;
  create table if not exists public.conta_s01p4_303_antes as
    select 'declaracion'::text as que, to_jsonb(t) as fila from public.tax_return t where t.id = p_303
    union all select 'linea', to_jsonb(l) from public.tax_return_line l where l.tax_return_id = p_303
    union all select 'caja', to_jsonb(x) from public.tax_return_box x where x.tax_return_id = p_303
    union all select 'comprobacion', to_jsonb(c) from public.tax_return_check c where c.tax_return_id = p_303;
  alter table public.conta_s01p4_303_antes enable row level security;
  revoke all on table public.conta_s01p4_303_antes from public, anon, authenticated;
  select coalesce(sum(v.tax_amount), 0) into v_iva_antes from public.vat_book_entry v
   where v.company_id = p_company and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between v_desde and v_hasta;
  delete from public.tax_return_line t where t.tax_return_id = p_303;

  -- Se borran (respaldo, serie renumerada, cadena).
  r := public._conta_asientos_borrar(p_company, p_entries, p_motivo, 'Tanda S01p·4');
  v_lote := (r->>'lote')::uuid;

  -- Cada uno otra vez, con la fecha de su factura, validado como quien la lanza (como en la pantalla).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_quien, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_acc::text, true);
  for b in select * from public.conta_asiento_borrado where lote = v_lote and que = 'asiento'
            order by (asiento->>'document_date')::date nulls last, (asiento->>'number')::int loop
    v_factura := (b.asiento->>'source_id')::uuid;
    select i.invoice_date into v_fecha from public.supplier_invoice i where i.id = v_factura and i.account_id = v_acc;
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
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);

  -- Lo que queda: cada factura con su asiento validado con su fecha; los mismos euros; la cadena entera.
  select count(*) into v_n from public.supplier_invoice i join public.journal_entry e on e.id = i.journal_entry_id
   where i.id in (select (cb.asiento->>'source_id')::uuid from public.conta_asiento_borrado cb where cb.lote = v_lote and cb.que = 'asiento')
     and e.status = 'validado' and e.entry_date = i.invoice_date;
  if v_n <> array_length(p_entries, 1) then raise exception 'S01p·4: solo % de las % facturas quedan con su asiento validado con su fecha: no se mueve nada.', v_n, array_length(p_entries, 1); end if;
  select coalesce(sum(l.debit), 0) into v_debe_despues from public.journal_line l join public.supplier_invoice i on i.journal_entry_id = l.entry_id
   where i.id in (select (cb.asiento->>'source_id')::uuid from public.conta_asiento_borrado cb where cb.lote = v_lote and cb.que = 'asiento');
  if v_debe_despues <> v_debe_antes then raise exception 'S01p·4: el debe pasa de % a %: no se mueve nada.', v_debe_antes, v_debe_despues; end if;
  if public._conta_cadena_rota(p_company) <> 0 then raise exception 'S01p·4: la cadena de huellas no cuadra después: no se mueve nada.'; end if;

  -- El borrador del 303, otra vez calculado; el IVA del trimestre, igual.
  r := public.conta_impuesto_303_calcular(p_company, v_anio, v_periodo);
  if not exists (select 1 from public.tax_return t where t.id = p_303 and t.status = 'draft' and t.filed_at is null and t.calculated_at > now() - interval '1 minute') then
    raise exception 'S01p·4: el borrador del 303 no ha quedado recalculado: no se mueve nada.';
  end if;
  select coalesce(sum(v.tax_amount), 0) into v_iva_despues from public.vat_book_entry v
   where v.company_id = p_company and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between v_desde and v_hasta;
  if v_iva_antes <> v_iva_despues then raise exception 'S01p·4: el IVA del trimestre no podía cambiar y pasa de % a %: no se mueve nada.', v_iva_antes, v_iva_despues; end if;
  return jsonb_build_object('lote', v_lote, 'movidos', v_n, 'debe', v_debe_despues, 'iva', v_iva_despues,
    'texto', format('%s facturas con su asiento en la fecha de su factura (debe %s). IVA del %s sin cambios: %s.', v_n, v_debe_despues, v_periodo, v_iva_despues));
end $$;
revoke all on function public._s01p_facturas_a_su_fecha(uuid, uuid[], uuid, uuid, text) from public, anon, authenticated, service_role;
comment on function public._s01p_facturas_a_su_fecha(uuid, uuid[], uuid, uuid, text) is
  'S01p·4 (2211). Borra asientos validados de facturas recibidas con otra fecha y los vuelve a apuntar, desde su respaldo, con la fecha de su factura (números al final de su serie: el oficial es el de Diez); saca y recalcula el borrador del 303 del trimestre. Solo una tanda.';

create or replace function public._s01p_facturas_a_su_fecha_deshacer(p_company uuid, p_303 uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lote uuid; v_nuevos uuid[]; r jsonb;
begin
  select lote into v_lote from public.conta_asiento_borrado
   where company_id = p_company and que = 'asiento' and deshecho_at is null and motivo like 'S01p·4 · %' and motivo not like 'S01p·4 · Vuelta atrás%'
   order by at desc limit 1;
  if v_lote is null then return jsonb_build_object('texto', 'Nada que deshacer.'); end if;
  select array_agg(i.journal_entry_id) into v_nuevos from public.supplier_invoice i
   where i.id in (select (cb.asiento->>'source_id')::uuid from public.conta_asiento_borrado cb where cb.lote = v_lote and cb.que = 'asiento')
     and i.journal_entry_id is not null;
  delete from public.tax_return_line where tax_return_id = p_303;
  if v_nuevos is not null then
    r := public._conta_asientos_borrar(p_company, v_nuevos, 'S01p·4 · Vuelta atrás: se quitan los asientos con la fecha de su factura para devolver los de antes.', 'Vuelta atrás S01p·4');
  end if;
  r := public._conta_asientos_borrado_deshacer(v_lote);
  if to_regclass('public.conta_s01p4_303_antes') is not null then
    delete from public.tax_return_line where tax_return_id = p_303;
    delete from public.tax_return_box where tax_return_id = p_303;
    delete from public.tax_return_check where tax_return_id = p_303;
    update public.tax_return t set status = a.status, amount = a.amount, result_kind = a.result_kind, calculated_at = a.calculated_at, updated_at = a.updated_at
      from (select (jsonb_populate_record(null::public.tax_return, fila)).* from public.conta_s01p4_303_antes where que = 'declaracion') a
     where t.id = a.id;
    insert into public.tax_return_line select (jsonb_populate_record(null::public.tax_return_line, fila)).* from public.conta_s01p4_303_antes where que = 'linea';
    insert into public.tax_return_box select (jsonb_populate_record(null::public.tax_return_box, fila)).* from public.conta_s01p4_303_antes where que = 'caja';
    insert into public.tax_return_check select (jsonb_populate_record(null::public.tax_return_check, fila)).* from public.conta_s01p4_303_antes where que = 'comprobacion';
    drop table public.conta_s01p4_303_antes;
  end if;
  return r;
end $$;
revoke all on function public._s01p_facturas_a_su_fecha_deshacer(uuid, uuid) from public, anon, authenticated, service_role;

-- ── Foodint: las 22, medidas, y la función ─────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := 'e298629b-9d34-4d62-9a00-ff7c3fa29a1a';
  v_303 constant uuid := '8ae554ae-4853-42c9-b5b0-346840223d47';
  v_ids uuid[]; v_n int; v_total numeric; r jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01p·4: sin la cuenta de Foodint, no hay nada que mover.';
    return;
  end if;
  select array_agg(e.id order by i.invoice_date, e.number), count(*), sum(i.grand_total) into v_ids, v_n, v_total
    from public.supplier_invoice i join public.journal_entry e on e.id = i.journal_entry_id
   where i.account_id = v_acc and e.company_id = v_e and e.account_id = v_acc
     and i.invoice_date between date '2026-10-01' and date '2026-10-31' and e.entry_date >= date '2026-11-01'
     and e.status = 'validado' and e.source_type = 'supplier_invoice' and e.series = 2
     and i.created_at < timestamptz '2026-11-04 19:00+00';
  if v_n is distinct from 22 or v_total is distinct from 2544.14 then
    raise exception 'S01p·4: tenían que ser 22 facturas de octubre asentadas en noviembre (2.544,14 €) y son % (% €): no se mueve nada.', v_n, v_total;
  end if;
  -- La tanda mueve filas, pero dentro de la función, donde el analizador no mira: esta línea
  -- (la marca de cuándo se tocó cada factura, que la función vuelve a poner) lo deja a la vista,
  -- para que pida «autorizo» como cualquier tanda que mueve filas.
  update public.supplier_invoice i set updated_at = now()
    from public.journal_entry e where e.id = i.journal_entry_id and e.id = any(v_ids) and i.account_id = v_acc;
  r := public._s01p_facturas_a_su_fecha(v_e, v_ids, v_303, v_julio,
         'S01p·4 · Facturas de octubre asentadas en noviembre (regla V04): se vuelven a apuntar con la fecha de su factura. Julio, 04/11.');
  raise notice 'S01p·4: %', r->>'texto';
end $$;
