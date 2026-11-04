-- supabase/migrations/20261104T1120_s01p_candado.sql
--
-- S01p · 2 · Los dos días de la empresa y el candado del cierre, según la
-- decisión 3 de Julio (04/11): «El cierre mensual sirve para tener la
-- contabilidad siempre al día. No es un candado fiscal. El candado de verdad es
-- el trimestre con el 303 presentado.»
--
-- 1. Dos campos de la empresa (company), que nadie da por hechos:
--    · month_close_day: el día del mes siguiente en que se cierra el mes, con la
--      información que haya ese día (Foodint, el 7). Lo que llegue después se
--      mira en el mes siguiente.
--    · payroll_pay_days: los días del mes siguiente en que se paga la nómina
--      (Foodint, el 5 y el 6).
--    Vacíos hasta que alguien los pone. Se guardan con conta_empresa_dias_guardar.
--
-- 2. Un mes cerrado con «Cerrar el mes» ya no impide apuntar. Lo apuntado
--    después queda escrito en conta_mes_cambio (qué asiento, qué le pasó, cuánto,
--    quién y cuándo), y el mes pasa a «Cerrado, con N cambios después».
--    conta_mes_cerrado (la que consultan validar, anular, el cierre del día, el
--    303 y Verifactu) solo dice «cerrado» para los meses que de verdad no
--    admiten nada: los del corte con Diez (kind «migrated», los 9 de Foodint, de
--    enero a septiembre) y los cerrados por un impuesto presentado («tax_filed»).
--    Los que cierra una persona («manual», el que pone conta_cerrar_mes) se
--    marcan, no se bloquean.
--
-- 3. El trimestre con el 303 presentado no admite NADA con su fecha, no solo
--    lo que lleva IVA: un disparador nuevo rechaza al crear un asiento y al
--    cambiarle la fecha (hasta ahora solo se paraba lo que tenía IVA, en
--    _conta_iva_candado_apunte y _conta_iva_candado_asiento, que se quedan). El
--    mensaje dice a qué periodo va. Se libran los de siempre
--    (_conta_iva_exento: migrados, apertura, cierre y la propia liquidación del
--    303). Y conta_primer_dia_abierto salta también el trimestre presentado.
--    Medido en producción el 04/11 (solo lectura): en Foodint, 0 asientos
--    creados en 2026 con fecha de un trimestre ya presentado (su 3T, del 20/10,
--    además es de antes del corte). En Casa Lola, 35 sin IVA de la siembra de
--    la demo del 03/11 (32 de banco y 3 de nómina): volver a sembrarla con su
--    3T presentado ya no pasaría.
--
-- Nada en el camino del pedido.
--
-- cambia: public.conta_mes_cerrado · prueba: supabase/staging/sql/20261104_s01p_candado_prueba.sql
-- cambia: public.conta_primer_dia_abierto · prueba: supabase/staging/sql/20261104_s01p_candado_prueba.sql
-- cambia: public.company · prueba: supabase/staging/sql/20261104_s01p_candado_prueba.sql
--   (dos columnas nuevas que admiten nulos, con su CHECK)
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261104_s01p_candado_prueba.sql
--   (dos disparadores nuevos: el del trimestre presentado, BEFORE, y el que apunta los cambios, AFTER)

-- ── 1 · Los dos días de la empresa ──────────────────────────────────────────
alter table public.company add column if not exists month_close_day smallint;
alter table public.company add column if not exists payroll_pay_days smallint[];
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'company_month_close_day_check') then
    alter table public.company add constraint company_month_close_day_check
      check (month_close_day is null or month_close_day between 1 and 28);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'company_payroll_pay_days_check') then
    alter table public.company add constraint company_payroll_pay_days_check
      check (payroll_pay_days is null or (cardinality(payroll_pay_days) between 1 and 4 and 1 <= all (payroll_pay_days) and 31 >= all (payroll_pay_days)));
  end if;
end $$;
comment on column public.company.month_close_day is
  'S01p · El día del mes siguiente en que se cierra un mes (con la información que haya ese día). Vacío: sin poner.';
comment on column public.company.payroll_pay_days is
  'S01p · Los días del mes siguiente en que se paga la nómina del mes. Vacío: sin poner.';

create or replace function public.conta_empresa_dias_guardar(p_company uuid, p_dia_cierre smallint, p_dias_nomina smallint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_dias smallint[];
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Solo un administrador de la cuenta puede cambiar los días de la empresa.' using errcode = '42501';
  end if;
  if p_dia_cierre is not null and p_dia_cierre not between 1 and 28 then
    raise exception 'El día de cierre va del 1 al 28 del mes siguiente.' using errcode = '22023';
  end if;
  select array_agg(distinct d order by d) into v_dias from unnest(coalesce(p_dias_nomina, '{}'::smallint[])) d;
  if v_dias is not null and (cardinality(v_dias) > 4 or exists (select 1 from unnest(v_dias) d where d not between 1 and 31)) then
    raise exception 'Los días de pago de la nómina van del 1 al 31, como mucho cuatro.' using errcode = '22023';
  end if;
  update public.company set month_close_day = p_dia_cierre, payroll_pay_days = v_dias where id = p_company;
  return jsonb_build_object('dia_cierre', p_dia_cierre, 'dias_nomina', to_jsonb(v_dias),
    'mensaje', concat_ws(' ',
      case when p_dia_cierre is null then 'Sin día de cierre.' else format('Cada mes se cierra el día %s del siguiente.', p_dia_cierre) end,
      case when v_dias is null then 'Sin días de pago de la nómina.'
           else format('La nómina se paga el %s del mes siguiente.', array_to_string(v_dias, ' y el ')) end));
end $$;
revoke all on function public.conta_empresa_dias_guardar(uuid, smallint, smallint[]) from public, anon;
grant execute on function public.conta_empresa_dias_guardar(uuid, smallint, smallint[]) to authenticated;

-- ── 2 · El mes cerrado por una persona se marca, no se bloquea ─────────────
do $$ begin
  if strpos(pg_get_functiondef('public.conta_mes_cerrado(uuid,date)'::regprocedure), 'S01p') = 0 then
    perform public._respaldar_funcion('public.conta_mes_cerrado(uuid,date)', '20261104T1120_s01p_candado');
  end if;
end $$;
create or replace function public.conta_mes_cerrado(p_company uuid, p_fecha date)
returns boolean language sql stable set search_path = public as $$
  -- S01p: solo los meses que no admiten nada (el corte con Diez y los cerrados
  -- por un impuesto presentado). Los que cierra una persona se marcan
  -- (conta_mes_cambio), no se bloquean: el candado de verdad es el trimestre
  -- con el 303 presentado (conta_iva_presentado).
  select exists (
    select 1 from public.fiscal_period_lock
     where company_id = p_company and month = date_trunc('month', p_fecha)::date and reopened_at is null
       and kind in ('migrated', 'tax_filed'))
$$;

create table if not exists public.conta_mes_cambio (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete cascade,
  lock_id     uuid not null references public.fiscal_period_lock(id) on delete cascade,
  month       date not null,
  entry_id    uuid not null,
  que         text not null check (que in ('validado', 'anulado', 'entra', 'sale')),
  importe     numeric not null default 0,
  concepto    text,
  hecho_por   uuid,
  hecho_por_nombre text,
  hecho_at    timestamptz not null default now()
);
comment on table public.conta_mes_cambio is
  'S01p · Lo que se apuntó en un mes ya cerrado por una persona: qué asiento, qué le pasó (validado, anulado, entra o sale por cambio de fecha), cuánto, quién y cuándo.';
create index if not exists conta_mes_cambio_mes on public.conta_mes_cambio (company_id, month, hecho_at);
alter table public.conta_mes_cambio enable row level security;
drop policy if exists conta_mes_cambio_select on public.conta_mes_cambio;
create policy conta_mes_cambio_select on public.conta_mes_cambio for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_mes_cambio from anon;
grant select on public.conta_mes_cambio to authenticated;

create or replace function public._tg_s01p_mes_cambio()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_l public.fiscal_period_lock; v_imp numeric; v_que text; v_mes date;
begin
  for v_que, v_mes in
    select x.que, x.mes from (values
      -- Validado o anulado en un mes cerrado.
      (case when tg_op = 'INSERT' and new.status = 'validado' then 'validado'
            when tg_op = 'UPDATE' and new.status = 'validado' and old.status is distinct from 'validado' then 'validado'
            when tg_op = 'UPDATE' and new.status = 'anulado' and old.status = 'validado' then 'anulado' end,
       date_trunc('month', new.entry_date)::date),
      -- Un validado que cambia de fecha: entra en un mes cerrado o sale de él.
      (case when tg_op = 'UPDATE' and new.status = 'validado' and old.status = 'validado'
                 and date_trunc('month', new.entry_date) <> date_trunc('month', old.entry_date) then 'entra' end,
       date_trunc('month', new.entry_date)::date),
      (case when tg_op = 'UPDATE' and new.status = 'validado' and old.status = 'validado'
                 and date_trunc('month', new.entry_date) <> date_trunc('month', old.entry_date) then 'sale' end,
       date_trunc('month', old.entry_date)::date)) x(que, mes)
     where x.que is not null
  loop
    select * into v_l from public.fiscal_period_lock
     where company_id = new.company_id and month = v_mes and reopened_at is null and kind = 'manual';
    continue when v_l.id is null;
    select coalesce(sum(l.debit), 0) into v_imp from public.journal_line l where l.entry_id = new.id;
    insert into public.conta_mes_cambio (account_id, company_id, lock_id, month, entry_id, que, importe, concepto, hecho_por, hecho_por_nombre)
    values (new.account_id, new.company_id, v_l.id, v_mes, new.id, v_que, v_imp, left(new.concept, 200), auth.uid(),
            coalesce(new.validated_by_name, public.conta_nombre_actor()));
  end loop;
  return null;
end $$;
revoke all on function public._tg_s01p_mes_cambio() from public, anon, authenticated;
drop trigger if exists s01p_mes_cambio on public.journal_entry;
create trigger s01p_mes_cambio
  after insert or update of status, entry_date on public.journal_entry
  for each row execute function public._tg_s01p_mes_cambio();

-- Lo que cambió en un mes desde que se cerró (para la pantalla y su PDF).
create or replace function public.conta_mes_cambios(p_company uuid, p_mes date)
returns table(cambio_id uuid, entry_id uuid, que text, importe numeric, concepto text, hecho_por_nombre text, hecho_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.entry_id, c.que, c.importe, c.concepto, c.hecho_por_nombre, c.hecho_at
    from public.conta_mes_cambio c
    join public.fiscal_period_lock l on l.id = c.lock_id and l.reopened_at is null
   where c.company_id = p_company and c.month = date_trunc('month', p_mes)::date
     and public.belongs_to_account(c.account_id)
   order by c.hecho_at, c.id
$$;
revoke all on function public.conta_mes_cambios(uuid, date) from public, anon;
grant execute on function public.conta_mes_cambios(uuid, date) to authenticated;

-- ── 3 · El trimestre presentado no admite nada ──────────────────────────────
create or replace function public._tg_s01p_trimestre_presentado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_p jsonb;
begin
  if tg_op = 'UPDATE' and new.entry_date is not distinct from old.entry_date then return new; end if;
  if public._conta_iva_exento(new.source_type, new.source_id, new.company_id) then return new; end if;
  v_p := public.conta_iva_presentado(new.company_id, new.entry_date);
  if v_p is null then return new; end if;
  raise exception '%', public.conta_iva_presentado_mensaje(new.company_id, v_p,
                         case when new.source_type = 'supplier_invoice' then 'factura' else 'corregir' end)
    using errcode = '23514', hint = 'iva_presentado';
end $$;
revoke all on function public._tg_s01p_trimestre_presentado() from public, anon, authenticated;
drop trigger if exists trg_journal_entry_0_trimestre_presentado on public.journal_entry;
create trigger trg_journal_entry_0_trimestre_presentado
  before insert or update of entry_date on public.journal_entry
  for each row execute function public._tg_s01p_trimestre_presentado();

-- conta_iva_presentado solo la ejecutan postgres y service_role, y
-- conta_primer_dia_abierto corre como quien valida (la llama
-- conta_motivos_para_validar): la pregunta, con su propio permiso y solo sí o no.
create or replace function public._s01p_iva_presentado_el(p_company uuid, p_fecha date)
returns boolean language sql stable security definer set search_path = public as $$
  select public.conta_iva_presentado(p_company, p_fecha) is not null
$$;
revoke all on function public._s01p_iva_presentado_el(uuid, date) from public, anon;
grant execute on function public._s01p_iva_presentado_el(uuid, date) to authenticated, service_role;

do $$ begin
  if strpos(pg_get_functiondef('public.conta_primer_dia_abierto(uuid,date)'::regprocedure), '_s01p_iva_presentado_el') = 0 then
    perform public._respaldar_funcion('public.conta_primer_dia_abierto(uuid,date)', '20261104T1120_s01p_candado');
  end if;
end $$;
create or replace function public.conta_primer_dia_abierto(p_company uuid, p_fecha date)
returns date language sql stable set search_path = public as $$
  select min(d)::date
    from generate_series(p_fecha, p_fecha + 400, interval '1 day') d
   where not public.conta_mes_cerrado(p_company, d::date)
     and not public._s01p_iva_presentado_el(p_company, d::date)   -- S01p: ni en un trimestre con el 303 presentado
     and exists (select 1 from public.fiscal_year y
                  where y.company_id = p_company and y.status = 'open' and d::date between y.starts_on and y.ends_on
                    and (y.imported_until is null or d::date > y.imported_until))
$$;
