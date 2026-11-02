-- supabase/migrations/20261102T2011_s01q_no_duplicar.sql
--
-- S01q·7 · Que Sumied no pueda duplicar: las reglas 1 a 4, en la base (Julio,
-- 02/11, respuesta S01q·7: «aprobadas tal cual, con sus mensajes»). Así lo para
-- la base, venga de la pasada, de la pantalla o de una tanda.
--   1. Una factura recibida no se contabiliza dos veces: un asiento de una
--      factura recibida no se propone ni se valida si otro asiento vivo de la
--      empresa (de Diez o no, que no sea el suyo) lleva su número (en el concepto
--      o el justificante) y una línea de su proveedor (su subcuenta o su tercero)
--      en su lado: haber si es factura, debe si es abono. Con cualquier total. La
--      salida, la de siempre: «No es repetida» en la factura.
--   2. Ningún asiento de Sumied con fecha anterior al corte de su empresa (salvo
--      los traídos de Diez y los de apertura y cierre), al crearlo y al cambiarle
--      la fecha.
--   3. Una factura emitida, un asiento: el asiento de una factura emitida no es
--      el de otra (disparador con el mensaje e índice único debajo).
--   4. Un pago o un cobro no pasa del total de su factura, en la tabla.
-- Al empezar mide lo que hay: si algo de hoy ya rompe una regla, para y lo dice
-- (no se crea una regla que la base ya incumple).
--
-- sin hueco: el fichero no retira nada; solo añade funciones, disparadores y un índice.
--
-- Pone disparadores nuevos en cuatro tablas que ya existen (ninguna del camino del pedido):
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261102_s01q_no_duplicar_prueba.sql
-- cambia: public.customer_invoice · prueba: supabase/staging/sql/20261102_s01q_no_duplicar_prueba.sql
-- cambia: public.supplier_invoice_payment · prueba: supabase/staging/sql/20261102_s01q_no_duplicar_prueba.sql
-- cambia: public.customer_invoice_payment · prueba: supabase/staging/sql/20261102_s01q_no_duplicar_prueba.sql

-- 0 · El importe como se lee en España: 1.234,56.
create or replace function public._conta_s01q_euros(p numeric)
returns text language sql immutable set search_path = public as $$
  select translate(to_char(round(p, 2), 'FM999,999,999,990.00'), ',.', '.,')
$$;
revoke all on function public._conta_s01q_euros(numeric) from public, anon, authenticated;

-- 1 · ¿Está esta factura recibida en otro asiento vivo? (null si no)
create or replace function public._conta_factura_en_otro_asiento(p_invoice uuid, p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.supplier_invoice; v_num text; v_re text; d jsonb;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or v.not_duplicate_confirmed_at is not null or v.supplier_id is null then return null; end if;
  v_num := upper(regexp_replace(coalesce(v.invoice_number, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_num) < 4 then return null; end if;
  -- El número, con cualquier separador entre sus caracteres, y solo (no dentro de otro más largo).
  v_re := '(^|[^A-Z0-9])' || array_to_string(regexp_split_to_array(v_num, ''), '[^A-Z0-9]*') || '($|[^A-Z0-9])';
  -- Su proveedor, en su lado, por el neto del asiento: un asiento que le carga y le
  -- abona lo mismo (la propuesta de liquidación que compensa la comisión) no la lleva.
  select jsonb_build_object('id', e.id, 'serie', e.series, 'numero', e.number, 'fecha', e.entry_date, 'migrado', e.source_type = 'migrated',
           'importe', q.importe)
    into d
    from public.journal_entry e
    cross join lateral (
      select sum(case when v.grand_total >= 0 then l.credit - l.debit else l.debit - l.credit end) importe
        from public.journal_line l
       where l.entry_id = e.id
         and (l.company_account_id in (select k.company_account_id from public.company_account_link k
                                        where k.company_id = v.company_id and k.entity = 'supplier' and k.entity_id = v.supplier_id::text and k.role = 'principal')
              or l.party_id in (select pr.party_id from public.party_role pr
                                 where pr.account_id = v.account_id and pr.role = 'supplier' and pr.supplier_id = v.supplier_id))) q
   where e.company_id = v.company_id and e.account_id = v.account_id
     and e.id is distinct from p_entry
     and e.status <> 'anulado' and e.source_type <> 'reversal'
     and not exists (select 1 from public.journal_entry o where o.reverses_entry_id = e.id)
     and not (e.source_type = 'supplier_invoice' and e.source_id = v.id)
     and (upper(coalesce(e.concept, '')) ~ v_re or upper(coalesce(e.document_ref, '')) ~ v_re)
     and q.importe > 0
   order by (e.source_type = 'migrated') desc, e.entry_date, e.number nulls last
   limit 1;
  return d;
end $$;
revoke all on function public._conta_factura_en_otro_asiento(uuid, uuid) from public, anon, authenticated;
comment on function public._conta_factura_en_otro_asiento(uuid, uuid) is
  'S01q·7 · Regla 1: el otro asiento vivo que ya lleva esta factura recibida (su número y su proveedor en su lado, con cualquier total), o null.';

create or replace function public.tg_journal_entry_factura_una_vez()
returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if new.source_type is distinct from 'supplier_invoice' or new.source_id is null or new.status = 'anulado' then return new; end if;
  if tg_op = 'UPDATE' and not ((new.status = 'validado' and old.status is distinct from 'validado')
                               or new.source_id is distinct from old.source_id or new.source_type is distinct from old.source_type) then
    return new;
  end if;
  d := public._conta_factura_en_otro_asiento(new.source_id, new.id);
  if d is null then return new; end if;
  raise exception using errcode = '23505', message = format(
    'Esta factura ya está contabilizada en el asiento %s del %s, %s, por %s €. No se apunta dos veces. Si es otra factura con el mismo número, márcala «No es repetida».',
    case when d->>'numero' is null then 'sin número todavía' else (d->>'serie') || '/' || (d->>'numero') end,
    to_char((d->>'fecha')::date, 'DD/MM/YYYY'),
    case when (d->>'migrado')::boolean then 'traído de Diez' else 'de Sumied' end,
    public._conta_s01q_euros((d->>'importe')::numeric));
end $$;
revoke all on function public.tg_journal_entry_factura_una_vez() from public, anon, authenticated;

-- 2 · Ningún asiento de Sumied antes del corte.
create or replace function public.tg_journal_entry_no_antes_del_corte()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_corte date;
begin
  if new.source_type in ('migrated', 'opening', 'closing') then return new; end if;
  if tg_op = 'UPDATE' and new.entry_date is not distinct from old.entry_date then return new; end if;
  v_corte := public._conta_corte(new.company_id);
  if v_corte is null or new.entry_date >= v_corte then return new; end if;
  raise exception using errcode = '23514', message = format('No se apunta: el día %s es de antes del corte (%s). Ese periodo lo lleva %s.',
    to_char(new.entry_date, 'DD/MM/YYYY'), to_char(v_corte, 'DD/MM/YYYY'),
    case when exists (select 1 from public.fiscal_year y where y.company_id = new.company_id and y.origin_program = 'diez') then 'Diez' else 'la contabilidad de antes' end);
end $$;
revoke all on function public.tg_journal_entry_no_antes_del_corte() from public, anon, authenticated;

-- 3 · Una factura emitida, un asiento.
create or replace function public.tg_customer_invoice_un_asiento()
returns trigger language plpgsql security definer set search_path = public as $$
declare o public.customer_invoice;
begin
  if new.entry_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.entry_id is not distinct from old.entry_id then return new; end if;
  select * into o from public.customer_invoice where entry_id = new.entry_id and id <> new.id limit 1;
  if o.id is null then return new; end if;
  raise exception using errcode = '23505', message = format('Este asiento ya es el de la factura %s del %s. Una factura, un asiento.',
    coalesce(o.number_text, o.series_code || '-' || o.number::text, 'sin número'), to_char(o.issue_date, 'DD/MM/YYYY'));
end $$;
revoke all on function public.tg_customer_invoice_un_asiento() from public, anon, authenticated;

-- 4 · Un pago o un cobro no pasa del total de su factura.
create or replace function public._conta_s01q_como_se_pago(p_method text, p_banco boolean)
returns text language sql immutable set search_path = public as $$
  select case when p_banco then 'por el banco'
              when p_method = 'transfer' then 'por transferencia'
              when p_method = 'compensation' then 'por compensación'
              when p_method = 'prepaid' then 'por adelantado'
              when p_method = 'plataforma' then 'por la plataforma'
              when p_method = 'traido_diez' then 'en Diez'
              when p_method = 'card' then 'con tarjeta'
              when p_method = 'cash' then 'en efectivo'
              else 'a mano' end
$$;
revoke all on function public._conta_s01q_como_se_pago(text, boolean) from public, anon, authenticated;

create or replace function public.tg_invoice_payment_tope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric; v_s int; v_otros numeric; v_n int; u record; v_cobro boolean := tg_table_name = 'customer_invoice_payment';
begin
  if tg_op = 'UPDATE' and new.amount is not distinct from old.amount and new.invoice_id is not distinct from old.invoice_id then return new; end if;
  if v_cobro then
    select total into v_total from public.customer_invoice where id = new.invoice_id for update;
    select coalesce(sum(amount), 0), count(*) into v_otros, v_n from public.customer_invoice_payment where invoice_id = new.invoice_id and id <> new.id;
    select paid_on, amount, method, bank_match_id is not null as banco into u from public.customer_invoice_payment
     where invoice_id = new.invoice_id and id <> new.id order by paid_on desc, created_at desc limit 1;
  else
    select grand_total into v_total from public.supplier_invoice where id = new.invoice_id for update;
    select coalesce(sum(amount), 0), count(*) into v_otros, v_n from public.supplier_invoice_payment where invoice_id = new.invoice_id and id <> new.id;
    select paid_on, amount, method, bank_match_id is not null as banco into u from public.supplier_invoice_payment
     where invoice_id = new.invoice_id and id <> new.id order by paid_on desc, created_at desc limit 1;
  end if;
  if v_total is null then return new; end if;
  v_s := case when v_total < 0 then -1 else 1 end;
  if v_s * (v_otros + new.amount) <= abs(v_total) + 0.005 then return new; end if;
  if v_n > 0 and v_s * v_otros >= abs(v_total) - 0.005 then
    raise exception using errcode = '23505', message = format('Esta factura ya está %s: %s € %sel %s %s. Para %s otra vez, deshaz antes %s.',
      case when v_cobro then 'cobrada' else 'pagada' end,
      public._conta_s01q_euros(abs(v_otros)),
      case when v_n > 1 then format('en %s %s, el último ', v_n, case when v_cobro then 'cobros' else 'pagos' end) else '' end,
      to_char(u.paid_on, 'DD/MM'), public._conta_s01q_como_se_pago(u.method, u.banco),
      case when v_cobro then 'cobrarla' else 'pagarla' end,
      case when v_n > 1 then case when v_cobro then 'esos cobros' else 'esos pagos' end else case when v_cobro then 'ese cobro' else 'ese pago' end end);
  end if;
  raise exception using errcode = '23505', message = format('Esta factura es de %s € y ya tiene %s € %s: este %s de %s € pasa del total.',
    public._conta_s01q_euros(abs(v_total)), public._conta_s01q_euros(abs(v_otros)),
    case when v_cobro then 'cobrados' else 'pagados' end, case when v_cobro then 'cobro' else 'pago' end, public._conta_s01q_euros(abs(new.amount)));
end $$;
revoke all on function public.tg_invoice_payment_tope() from public, anon, authenticated;

-- 5 · Antes de crear las reglas: lo que hay hoy no puede romperlas.
do $$
declare v_mal text[] := '{}'; v_txt text;
begin
  select string_agg(format('%s (factura %s, asiento %s/%s)', c.legal_name, si.invoice_number, e.series, e.number), '; ') into v_txt
    from public.journal_entry e join public.supplier_invoice si on si.id = e.source_id join public.company c on c.id = e.company_id
   where e.source_type = 'supplier_invoice' and e.status <> 'anulado'
     and public._conta_factura_en_otro_asiento(si.id, e.id) is not null;
  if v_txt is not null then v_mal := v_mal || ('Regla 1, facturas recibidas ya contabilizadas en otro asiento: ' || v_txt); end if;

  select string_agg(format('%s (asiento %s/%s del %s)', c.legal_name, e.series, coalesce(e.number::text, '—'), to_char(e.entry_date, 'DD/MM/YYYY')), '; ') into v_txt
    from public.journal_entry e join public.company c on c.id = e.company_id
   where e.source_type not in ('migrated', 'opening', 'closing')
     and e.entry_date < public._conta_corte(e.company_id);
  if v_txt is not null then v_mal := v_mal || ('Regla 2, asientos de Sumied de antes del corte: ' || v_txt); end if;

  select string_agg(format('asiento %s en %s facturas', entry_id, n), '; ') into v_txt
    from (select entry_id, count(*) n from public.customer_invoice where entry_id is not null group by 1 having count(*) > 1) z;
  if v_txt is not null then v_mal := v_mal || ('Regla 3, facturas emitidas que comparten asiento: ' || v_txt); end if;

  select string_agg(t, '; ') into v_txt from (
    select format('recibida %s', si.invoice_number) t from public.supplier_invoice si
     where (select coalesce(sum(p.amount), 0) from public.supplier_invoice_payment p where p.invoice_id = si.id) * case when si.grand_total < 0 then -1 else 1 end > abs(si.grand_total) + 0.005
    union all
    select format('emitida %s', coalesce(ci.number_text, ci.id::text)) from public.customer_invoice ci
     where (select coalesce(sum(p.amount), 0) from public.customer_invoice_payment p where p.invoice_id = ci.id) * case when ci.total < 0 then -1 else 1 end > abs(ci.total) + 0.005) z;
  if v_txt is not null then v_mal := v_mal || ('Regla 4, facturas pagadas o cobradas por encima de su total: ' || v_txt); end if;

  if cardinality(v_mal) > 0 then
    raise exception 'S01q·7: hoy ya hay lo que las reglas tienen que impedir; no se crea ninguna. %', array_to_string(v_mal, ' · ');
  end if;
end $$;

-- 6 · Las reglas.
drop trigger if exists trg_journal_entry_factura_una_vez on public.journal_entry;
create trigger trg_journal_entry_factura_una_vez
  before insert or update of status, source_id, source_type on public.journal_entry
  for each row execute function public.tg_journal_entry_factura_una_vez();

drop trigger if exists trg_journal_entry_no_antes_del_corte on public.journal_entry;
create trigger trg_journal_entry_no_antes_del_corte
  before insert or update of entry_date on public.journal_entry
  for each row execute function public.tg_journal_entry_no_antes_del_corte();

drop trigger if exists trg_customer_invoice_un_asiento on public.customer_invoice;
create trigger trg_customer_invoice_un_asiento
  before insert or update of entry_id on public.customer_invoice
  for each row execute function public.tg_customer_invoice_un_asiento();
create unique index if not exists ux_customer_invoice_entry on public.customer_invoice (entry_id) where entry_id is not null;

drop trigger if exists trg_supplier_invoice_payment_tope on public.supplier_invoice_payment;
create trigger trg_supplier_invoice_payment_tope
  before insert or update of amount, invoice_id on public.supplier_invoice_payment
  for each row execute function public.tg_invoice_payment_tope();
drop trigger if exists trg_customer_invoice_payment_tope on public.customer_invoice_payment;
create trigger trg_customer_invoice_payment_tope
  before insert or update of amount, invoice_id on public.customer_invoice_payment
  for each row execute function public.tg_invoice_payment_tope();
