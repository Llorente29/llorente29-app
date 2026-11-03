-- supabase/migrations/20261103T0744_s01q_liquidacion_no_repite.sql
--
-- S01q·10 · Regla hermana de la 1 (Julio, 03/11): una liquidación de
-- plataforma no lleva la comisión ni su IVA si su factura de comisión ya está
-- contabilizada (en Sumied o traída de Diez), ni lleva asiento si es de
-- referencia. Lo para la base, venga de la propuesta, de la pantalla o de una
-- tanda:
--   · al escribir una línea de gasto (6…) o de IVA soportado en el asiento de
--     una liquidación;
--   · al crear el asiento de una liquidación de referencia;
--   · al validarlo, si ya llevaba esas líneas de antes.
-- Mensaje (23505): «La comisión de esta liquidación ya está contabilizada en
-- el asiento 2/3300 del 16/10/2026 (su factura I170326000537098): aquí solo
-- se compensa.» De referencia (23514): «Esta liquidación es de referencia (de
-- antes del corte, el 01/10/2026): no lleva asiento.»
-- Al empezar mide lo que hay y para si algo ya la rompe (en Foodint, la 0743
-- deja 0; medido el 03/11 en todas las cuentas: solo esas 27).
--
-- sin hueco: el fichero no retira nada; solo añade funciones y disparadores.
--
-- cambia: public.journal_line · prueba: supabase/staging/sql/20261103_s01q_liquidaciones_prueba.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261103_s01q_liquidaciones_prueba.sql

-- El asiento validado de la factura de comisión de una liquidación (de Sumied o traído de Diez), o null.
create or replace function public._conta_liquidacion_comision_asiento(p_liq uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('serie', e.series, 'numero', e.number, 'fecha', e.entry_date, 'migrado', e.source_type = 'migrated', 'factura', si.invoice_number)
    from public.channel_settlement cs
    join public.supplier_invoice si on si.id = cs.commission_invoice_id and si.account_id = cs.account_id
    join public.journal_entry e on e.status = 'validado'
         and ((e.source_type = 'supplier_invoice' and e.source_id = si.id) or e.id = si.journal_entry_id)
   where cs.id = p_liq
   order by (e.source_type = 'supplier_invoice') desc, e.entry_date
   limit 1
$$;
revoke all on function public._conta_liquidacion_comision_asiento(uuid) from public, anon, authenticated;

-- Por qué no puede llevar gasto ni IVA (o null si puede).
create or replace function public._conta_liquidacion_no_repite(p_liq uuid, p_company uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_cs public.channel_settlement; d jsonb;
begin
  select * into v_cs from public.channel_settlement where id = p_liq;
  if v_cs.id is null then return null; end if;
  if coalesce(v_cs.is_reference, false) then
    return format('Esta liquidación es de referencia (de antes del corte, el %s): no lleva asiento.', to_char(public._conta_corte(p_company), 'DD/MM/YYYY'));
  end if;
  d := public._conta_liquidacion_comision_asiento(p_liq);
  if d is null then return null; end if;
  return format('La comisión de esta liquidación ya está contabilizada en el asiento %s del %s%s (su factura %s): aquí solo se compensa.',
    (d->>'serie') || '/' || coalesce(d->>'numero', '—'), to_char((d->>'fecha')::date, 'DD/MM/YYYY'),
    case when (d->>'migrado')::boolean then ', traído de Diez' else '' end, coalesce(d->>'factura', 'sin número'));
end $$;
revoke all on function public._conta_liquidacion_no_repite(uuid, uuid) from public, anon, authenticated;

create or replace function public.tg_journal_line_liquidacion_no_repite()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_e public.journal_entry; v_code text; v_msg text;
begin
  select * into v_e from public.journal_entry where id = new.entry_id;
  if v_e.source_type is distinct from 'channel_settlement' or v_e.status = 'anulado' or v_e.source_id is null then return new; end if;
  select code into v_code from public.company_account where id = new.company_account_id;
  if coalesce(v_code, '') not like '6%' and new.vat_book is distinct from 'received' then return new; end if;
  v_msg := public._conta_liquidacion_no_repite(v_e.source_id, v_e.company_id);
  if v_msg is null then return new; end if;
  raise exception using errcode = case when v_msg like 'Esta liquidación es de referencia%' then '23514' else '23505' end, message = v_msg;
end $$;
revoke all on function public.tg_journal_line_liquidacion_no_repite() from public, anon, authenticated;

create or replace function public.tg_journal_entry_liquidacion_no_repite()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_msg text;
begin
  if new.source_type is distinct from 'channel_settlement' or new.source_id is null or new.status = 'anulado' then return new; end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.channel_settlement cs where cs.id = new.source_id and coalesce(cs.is_reference, false)) then
      v_msg := public._conta_liquidacion_no_repite(new.source_id, new.company_id);
      raise exception using errcode = '23514', message = v_msg;
    end if;
    return new;
  end if;
  -- Al validarla: si ya llevaba gasto o IVA soportado de antes.
  if new.status = 'validado' and old.status is distinct from 'validado'
     and exists (select 1 from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
                  where l.entry_id = new.id and (ca.code like '6%' or l.vat_book = 'received')) then
    v_msg := public._conta_liquidacion_no_repite(new.source_id, new.company_id);
    if v_msg is not null then
      raise exception using errcode = case when v_msg like 'Esta liquidación es de referencia%' then '23514' else '23505' end, message = v_msg;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tg_journal_entry_liquidacion_no_repite() from public, anon, authenticated;

-- Antes de crear la regla: lo que hay hoy no puede romperla.
do $$
declare v_txt text;
begin
  select string_agg(format('%s (%s)', coalesce(e.concept, e.id::text), e.status), '; ') into v_txt
    from public.journal_entry e
   where e.source_type = 'channel_settlement' and e.status <> 'anulado' and e.source_id is not null
     and exists (select 1 from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
                  where l.entry_id = e.id and (ca.code like '6%' or l.vat_book = 'received'))
     and public._conta_liquidacion_no_repite(e.source_id, e.company_id) is not null;
  if v_txt is not null then
    raise exception 'S01q·10: hay asientos de liquidación que ya repiten su comisión o son de referencia; no se crea la regla. %', v_txt;
  end if;
end $$;

drop trigger if exists trg_journal_line_liquidacion_no_repite on public.journal_line;
create trigger trg_journal_line_liquidacion_no_repite
  before insert on public.journal_line
  for each row execute function public.tg_journal_line_liquidacion_no_repite();
drop trigger if exists trg_journal_entry_liquidacion_no_repite on public.journal_entry;
create trigger trg_journal_entry_liquidacion_no_repite
  before insert or update of status on public.journal_entry
  for each row execute function public.tg_journal_entry_liquidacion_no_repite();
