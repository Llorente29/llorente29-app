-- supabase/migrations/20261102T2010_s01q_borrar_vercel_supabase.sql
--
-- S01q·7 · Foodint: se BORRAN los asientos 2/3272 y 2/3273 del 29/10 (Julio,
-- 02/11, respuesta S01q·7: «sí»). Mueve filas: va con autorizo.
--   · Son la factura de Vercel AJBFQADA-0006 y la de Supabase EFWCEJ-00007, del
--     18/09, que Diez ya tiene en los asientos 2/3129 (17,98 €) y 2/3130
--     (27,28 €), pagadas en el 4/3003 y el 4/3004. En Sumied se apuntaron a mano
--     el 29/10 con el importe en dólares tomado como euros (20,00 y 30,33).
--   · Cómo: con _conta_asientos_borrar (1837), como los 123: respaldo, la serie 2
--     renumerada desde el 3272 y la cadena recalculada desde el primer borrado.
--   · Cada factura queda «Ya contabilizada en Diez», enlazada a su asiento de
--     Diez. La guarda del #448 no las enlaza sola porque el total no es el mismo:
--     se enlazan aquí, a su asiento medido.
--   · El IVA soportado del 4T baja 10,57 € (4,20 + 6,37: sus 2 filas del libro,
--     que cuentan en octubre y no se han presentado).
--   · Los 2 asientos están en el BORRADOR del 303 del 4T de 2026 (sin presentar,
--     calculado el 30/10): Julio, 02/11, respuesta S01q·8, «A». En la misma
--     transacción: se sacan sus 2 líneas del borrador, se borran los asientos y
--     se vuelve a calcular el borrador con conta_impuesto_303_calcular. Si el 303
--     no está en borrador (alguien lo ha revisado o presentado), para sin hacer
--     nada. El recálculo recoge también lo que ha cambiado desde el 30/10, como
--     el borrado de los 123 (#449).
-- Lo de antes de cada factura queda en conta_s01q7_factura_antes, y el 303 entero
-- (la declaración, sus líneas, sus cajas y sus comprobaciones) en
-- conta_s01q7_303_antes, para la vuelta atrás exacta (con su calculated_at). Para
-- si algo no es lo medido. Sin Foodint (staging), no hace nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  -- asiento de Sumied, su factura, su asiento de Diez y lo que tiene que ser cada uno
  v_lista constant jsonb := jsonb_build_array(
    jsonb_build_object('asiento', 'a17eba5a-56e1-4b0d-a724-c1eab988bfe6', 'numero', 3272, 'factura', '403825dd-d8db-4ff5-a5cf-2115732fa89b',
                       'num_factura', 'AJBFQADA-0006', 'diez', 'd26f4850-6663-461e-ab75-af7bc06499b5', 'diez_numero', 3129),
    jsonb_build_object('asiento', '0f8ebdb5-0000-4e28-807d-e685e5890209', 'numero', 3273, 'factura', '7eddb982-81ef-444c-8d88-1e68d5d7c34f',
                       'num_factura', 'EFWCEJ-00007', 'diez', '68ba052f-4733-4238-baf1-133ae8c551e5', 'diez_numero', 3130));
  v_303 constant uuid := '8ae554ae-4853-42c9-b5b0-346840223d47';
  x jsonb; v_entries uuid[]; v_facturas uuid[]; v_iva_antes numeric; v_iva_despues numeric; v_iva_borrado numeric; r jsonb; v_ok int; v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01q·7: sin la cuenta de Foodint, no hay nada que borrar.';
    return;
  end if;

  -- Cada uno, el medido: el asiento de Sumied (validado, serie 2, del 29/10, de su
  -- factura) y su asiento de Diez (traído, con el número de la factura en el concepto).
  for x in select * from jsonb_array_elements(v_lista) loop
    if not exists (select 1 from public.journal_entry e
                    where e.id = (x->>'asiento')::uuid and e.company_id = v_e and e.account_id = v_acc and e.status = 'validado'
                      and e.series = 2 and e.number = (x->>'numero')::int and e.entry_date = date '2026-10-29'
                      and e.source_type = 'supplier_invoice' and e.source_id = (x->>'factura')::uuid) then
      raise exception 'S01q·7: el asiento 2/% no es el medido (validado, del 29/10, de la factura %): no se borra nada.', x->>'numero', x->>'num_factura';
    end if;
    if not exists (select 1 from public.journal_entry e
                    where e.id = (x->>'diez')::uuid and e.company_id = v_e and e.status = 'validado' and e.source_type = 'migrated'
                      and e.series = 2 and e.number = (x->>'diez_numero')::int and e.entry_date = date '2026-09-18'
                      and e.concept like (x->>'num_factura') || '%') then
      raise exception 'S01q·7: el asiento de Diez 2/% no es el medido (traído, del 18/09, con %): no se borra nada.', x->>'diez_numero', x->>'num_factura';
    end if;
    if exists (select 1 from public.supplier_invoice si where si.id = (x->>'factura')::uuid and si.journal_entry_id is not null)
       or exists (select 1 from public.supplier_invoice_auto a where a.invoice_id = (x->>'factura')::uuid)
       or exists (select 1 from public.supplier_invoice_payment p where p.invoice_id = (x->>'factura')::uuid) then
      raise exception 'S01q·7: la factura % ya no está como se midió (sin enlace, sin estado en la pasada y sin pagos): no se borra nada.', x->>'num_factura';
    end if;
    v_entries := v_entries || (x->>'asiento')::uuid;
    v_facturas := v_facturas || (x->>'factura')::uuid;
  end loop;

  -- El 303 del 4T: en borrador y sin presentar; y lo que tiene de estos 2 asientos, solo sus 2 líneas.
  if not exists (select 1 from public.tax_return t where t.id = v_303 and t.company_id = v_e and t.form_code = '303'
                    and t.fiscal_year = 2026 and t.period = '4T' and t.status = 'draft' and t.filed_at is null) then
    raise exception 'S01q·7: el 303 del 4T de 2026 ya no está en borrador (lo han revisado o presentado): no se borra nada.';
  end if;
  select count(*) into v_n from public.tax_return_line t join public.journal_line l on l.id = t.journal_line_id where l.entry_id = any(v_entries);
  if v_n <> 2 or exists (select 1 from public.tax_return_line t join public.journal_line l on l.id = t.journal_line_id
                          where l.entry_id = any(v_entries) and t.tax_return_id <> v_303) then
    raise exception 'S01q·7: los 2 asientos tenían que estar solo en el borrador del 303 del 4T, con 2 líneas, y están en % líneas o en otra declaración: no se borra nada.', v_n;
  end if;

  -- El 303 entero, como está (para la vuelta atrás exacta, con su calculated_at).
  create table if not exists public.conta_s01q7_303_antes as
    select 'declaracion'::text as que, to_jsonb(t) as fila from public.tax_return t where t.id = v_303
    union all select 'linea', to_jsonb(l) from public.tax_return_line l where l.tax_return_id = v_303
    union all select 'caja', to_jsonb(b) from public.tax_return_box b where b.tax_return_id = v_303
    union all select 'comprobacion', to_jsonb(c) from public.tax_return_check c where c.tax_return_id = v_303;
  alter table public.conta_s01q7_303_antes enable row level security;
  revoke all on table public.conta_s01q7_303_antes from public, anon, authenticated;

  -- 1 · Fuera del borrador las 2 líneas de estos asientos (la copia, arriba).
  delete from public.tax_return_line t using public.journal_line l
   where l.id = t.journal_line_id and l.entry_id = any(v_entries) and t.tax_return_id = v_303;

  -- El IVA soportado del 4T, antes (la misma vara después).
  select coalesce(sum(v.tax_amount), 0) into v_iva_antes from public.vat_book_entry v
   where v.company_id = v_e and v.book = 'received' and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31';
  select coalesce(sum(v.tax_amount), 0) into v_iva_borrado from public.vat_book_entry v where v.entry_id = any(v_entries);

  -- Lo de antes de cada factura, para la vuelta atrás exacta.
  create table if not exists public.conta_s01q7_factura_antes as
    select si.id as invoice_id, si.journal_entry_id from public.supplier_invoice si where si.id = any(v_facturas);
  alter table public.conta_s01q7_factura_antes enable row level security;
  revoke all on table public.conta_s01q7_factura_antes from public, anon, authenticated;

  r := public._conta_asientos_borrar(v_e, v_entries,
         'S01q·7 · Duplicado: la factura ya estaba en Diez (2/3129 y 2/3130); en Sumied se apuntó el importe en dólares como euros. Julio, 02/11.',
         'Julio (tanda S01q·7)');
  raise notice 'S01q·7: %', r->>'texto';

  -- Cada factura, «Ya contabilizada en Diez» y enlazada a su asiento de Diez.
  for x in select * from jsonb_array_elements(v_lista) loop
    update public.supplier_invoice set journal_entry_id = (x->>'diez')::uuid, updated_at = now() where id = (x->>'factura')::uuid;
    insert into public.supplier_invoice_auto (invoice_id, account_id, company_id, estado, porque, entry_id)
    values ((x->>'factura')::uuid, v_acc, v_e, 'ya_contabilizada',
            'Ya contabilizada en Diez (asiento 2/' || (x->>'diez_numero') || ', 18/09/2026): no se vuelve a apuntar.', (x->>'diez')::uuid);
  end loop;
  select count(*) into v_ok from public.supplier_invoice si join public.supplier_invoice_auto a on a.invoice_id = si.id
   where si.id = any(v_facturas) and a.estado = 'ya_contabilizada' and si.journal_entry_id = a.entry_id
     and exists (select 1 from public.journal_entry e where e.id = si.journal_entry_id and e.source_type = 'migrated');
  if v_ok <> 2 then raise exception 'S01q·7: solo % de las 2 facturas quedan enlazadas a su asiento de Diez: no se borra nada.', v_ok; end if;

  select coalesce(sum(v.tax_amount), 0) into v_iva_despues from public.vat_book_entry v
   where v.company_id = v_e and v.book = 'received' and v.voided_at is null
     and public._conta_iva_dia_del_libro(v.book, v.deduction_year, v.deduction_period, v.received_date, v.issue_date, v.operation_date) between date '2026-10-01' and date '2026-12-31';
  if v_iva_antes - v_iva_despues <> 10.57 or v_iva_borrado <> 10.57 then
    raise exception 'S01q·7: el IVA soportado del 4T tenía que bajar 10,57 € y baja % € (de % a %): no se borra nada.', v_iva_antes - v_iva_despues, v_iva_antes, v_iva_despues;
  end if;
  raise notice 'S01q·7: IVA soportado del 4T, de % a % € (−10,57 €). 2 facturas «Ya contabilizada en Diez».', v_iva_antes, v_iva_despues;

  -- 3 · El borrador del 303 del 4T, otra vez calculado (si ya no está en borrador, para).
  if not exists (select 1 from public.tax_return t where t.id = v_303 and t.status = 'draft' and t.filed_at is null) then
    raise exception 'S01q·7: el 303 del 4T de 2026 ya no está en borrador al ir a recalcularlo: no se borra nada.';
  end if;
  r := public.conta_impuesto_303_calcular(v_e, 2026, '4T');
  if exists (select 1 from public.tax_return_line t join public.journal_line l on l.id = t.journal_line_id where l.entry_id = any(v_entries))
     or not exists (select 1 from public.tax_return t where t.id = v_303 and t.status = 'draft' and t.calculated_at > now() - interval '1 minute') then
    raise exception 'S01q·7: el borrador del 303 no ha quedado recalculado sin los 2 asientos: no se borra nada.';
  end if;
  raise notice 'S01q·7: el borrador del 303 del 4T, recalculado: %', (select format('%s · %s €, %s líneas', t.result_kind, t.amount,
    (select count(*) from public.tax_return_line l where l.tax_return_id = t.id)) from public.tax_return t where t.id = v_303);
end $$;
