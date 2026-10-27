-- supabase/migrations/20261027T1408_v04_iva_reabrir.sql
--
-- cambia: public.conta_iva_presentado · prueba: supabase/staging/sql/20261027_v04_iva_reabrir_prueba.sql
-- cambia: public.conta_iva_presentados · prueba: supabase/staging/sql/20261027_v04_iva_reabrir_prueba.sql
-- cambia: public.tax_return · prueba: supabase/staging/sql/20261027_v04_iva_reabrir_prueba.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261027_v04_iva_reabrir_prueba.sql
-- cambia: public.journal_line · prueba: supabase/staging/sql/20261027_v04_iva_reabrir_prueba.sql
-- cambia: public.vat_book_entry · prueba: supabase/staging/sql/20261027_v04_iva_reabrir_prueba.sql
--
-- V04 · Respuesta 5, punto 3 · REABRIR PARA CORREGIR (PR 2 del candado del IVA).
--
--   1. vat_reopening: cada reapertura de un periodo con el 303 presentado. La
--      abre el administrador de la empresa o su gestor (la asesoría con su
--      consentimiento), con un motivo escrito. La presentación original NO se
--      toca: se crea una nueva declaración del mismo periodo con su número
--      siguiente (sequence + 1) y replaces_return_id → la original, como
--      complementaria o sustitutiva («rectificativa»).
--   2. conta_iva_presentado (el único sitio que decide el candado, 1233): un
--      periodo reabierto deja de estar cerrado hasta que se registre la nueva
--      presentación. Y el «(20/10)» del mensaje es el de la última presentada.
--   3. vat_reopening_entry: cada asiento con IVA creado, validado, anulado o
--      cambiado mientras está reabierto, y cada cambio de su libro, queda
--      marcado con quién, cuándo, el motivo y el número de la nueva
--      presentación. Lo enseña el diario.
--   4. Se vuelve a cerrar solo, al registrar la nueva presentación (presentada).
--      conta_iva_reapertura_presentada la apunta con su CSV.
--   5. A los 30 días sin presentar, un aviso al administrador (cada 7 días, cron
--      iva-reabierto-recordar), y el trimestre sale en rojo: «Reabierto para
--      corregir, sin presentar».
--   6. conta_iva_presentados (para las pantallas) dice qué periodo está
--      reabierto; conta_iva_reaperturas, las de un ejercicio con su original y
--      su nueva presentación.
--
-- Cada función que ya existe se guarda antes con _respaldar_funcion y su vuelta
-- atrás la restaura byte a byte.

-- Los cerrojos de las cuatro tablas que reciben disparador, de golpe y al
-- principio, siempre en el mismo orden: así no se cruza a medias con quien
-- esté escribiendo en ellas (el ensayo 652 chocó con una e2e en marcha).
set local lock_timeout = '20s';
lock table public.tax_return, public.journal_entry, public.journal_line, public.vat_book_entry in share row exclusive mode;

select public._respaldar_funcion('public.conta_iva_presentado(uuid,date)', '20261027T1408_v04_iva_reabrir');
select public._respaldar_funcion('public.conta_iva_presentados(uuid,int)', '20261027T1408_v04_iva_reabrir');

-- ── 1 · Las reaperturas ────────────────────────────────────────────────────
create table if not exists public.vat_reopening (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete cascade,
  fiscal_year        integer not null,
  period             text not null check (period ~ '^([1-4]T|0[1-9]|1[0-2])$'),
  original_return_id uuid not null references public.tax_return(id),
  new_return_id      uuid not null references public.tax_return(id),
  kind               text not null check (kind in ('complementary', 'substitutive')),
  reason             text not null check (length(btrim(reason)) >= 10),
  opened_at          timestamptz not null default now(),
  opened_by          uuid,
  opened_by_name     text,
  closed_at          timestamptz,
  closed_by_name     text,
  reminded_at        timestamptz
);
comment on table public.vat_reopening is
  'V04 · Reabrir para corregir (1408). Un periodo con el 303 presentado, reabierto con un motivo por el administrador o el gestor. La presentación original no se toca: new_return_id es la nueva (sequence + 1, replaces_return_id → la original). Se cierra sola al presentarse la nueva. Solo la escriben las funciones de la 1408.';
create unique index if not exists vat_reopening_una_abierta on public.vat_reopening (company_id, fiscal_year, period) where closed_at is null;
alter table public.vat_reopening enable row level security;
drop policy if exists vat_reopening_select on public.vat_reopening;
create policy vat_reopening_select on public.vat_reopening for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]) or public.conta_impuesto_puede_ver(company_id));
revoke all on table public.vat_reopening from anon;
revoke insert, update, delete on table public.vat_reopening from authenticated;

create table if not exists public.vat_reopening_entry (
  reopening_id  uuid not null references public.vat_reopening(id) on delete cascade,
  entry_id      uuid not null references public.journal_entry(id) on delete cascade,
  account_id    uuid not null,
  company_id    uuid not null,
  action        text not null check (action in ('creado', 'validado', 'anulado', 'cambiado', 'libro')),
  at            timestamptz not null default now(),
  by_user       uuid,
  by_name       text,
  primary key (reopening_id, entry_id, action)
);
comment on table public.vat_reopening_entry is
  'V04 · Reabrir para corregir (1408). Cada asiento con IVA creado, validado, anulado o cambiado (o su libro) mientras su periodo estaba reabierto: quién y cuándo. El motivo y la nueva presentación están en su vat_reopening.';
create index if not exists vat_reopening_entry_asiento on public.vat_reopening_entry (entry_id);
alter table public.vat_reopening_entry enable row level security;
drop policy if exists vat_reopening_entry_select on public.vat_reopening_entry;
create policy vat_reopening_entry_select on public.vat_reopening_entry for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]) or public.conta_impuesto_puede_ver(company_id));
revoke all on table public.vat_reopening_entry from anon;
revoke insert, update, delete on table public.vat_reopening_entry from authenticated;

-- La reapertura abierta que cubre ese día, o null.
create or replace function public.conta_iva_reabierto(p_company uuid, p_fecha date)
returns public.vat_reopening language sql stable security definer set search_path = public as $$
  select o.* from public.vat_reopening o
   cross join lateral public.conta_impuesto_periodo_fechas(o.fiscal_year, o.period) f
   where p_fecha is not null and o.company_id = p_company and o.closed_at is null and p_fecha between f.desde and f.hasta
   limit 1
$$;
revoke all on function public.conta_iva_reabierto(uuid, date) from public, anon, authenticated;

-- ── 2 · El candado sabe de lo reabierto ────────────────────────────────────
create or replace function public.conta_iva_presentado(p_company uuid, p_fecha date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'ejercicio', r.fiscal_year, 'periodo', r.period, 'cadencia', r.cadence,
                            'desde', f.desde, 'hasta', f.hasta,
                            'presentado', coalesce(r.filed_at, r.updated_at), 'secuencia', r.sequence)
    from public.tax_return r
   cross join lateral public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period) f
   where p_fecha is not null and r.company_id = p_company and r.form_code = '303'
     and r.fiscal_year = extract(year from p_fecha)::int
     and r.period ~ '^([1-4]T|0[1-9]|1[0-2])$'
     and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')
     and p_fecha between f.desde and f.hasta
     -- V04 (1408): reabierto para corregir, el periodo no está cerrado hasta su nueva presentación.
     and not exists (select 1 from public.vat_reopening o where o.company_id = p_company and o.fiscal_year = r.fiscal_year
                       and o.period = r.period and o.closed_at is null)
   -- La última presentada: su fecha es la que dice el mensaje.
   order by r.sequence desc, r.filed_at desc nulls last
   limit 1
$$;
revoke all on function public.conta_iva_presentado(uuid, date) from public, anon, authenticated;
comment on function public.conta_iva_presentado(uuid, date) is
  'V04 · candado del IVA (1233; 1408: lo reabierto no está cerrado). El último 303 presentado (filed, booked, paid, offset o refunded) que cubre esa fecha, o null. El único sitio que decide si el IVA de un día está cerrado.';

-- ── 3 · Marcar lo que se hace con el periodo reabierto ─────────────────────
create or replace function public._conta_iva_marcar(p_reopening public.vat_reopening, p_entry uuid, p_accion text)
returns void language sql security definer set search_path = public as $$
  insert into public.vat_reopening_entry (reopening_id, entry_id, account_id, company_id, action, by_user, by_name)
  select (p_reopening).id, p_entry, (p_reopening).account_id, (p_reopening).company_id, p_accion, auth.uid(), public.conta_impuesto_quien()
   where (p_reopening).id is not null
  on conflict (reopening_id, entry_id, action) do update set at = now(), by_user = excluded.by_user, by_name = excluded.by_name
$$;
revoke all on function public._conta_iva_marcar(public.vat_reopening, uuid, text) from public, anon, authenticated;

create or replace function public._conta_iva_marcar_asiento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v public.vat_reopening;
begin
  if public._conta_iva_exento(new.source_type, new.source_id, new.company_id) or not public._conta_iva_asiento_con_iva(new.id) then return null; end if;
  if new.status = 'anulado' and old.status is distinct from 'anulado' then
    v := public.conta_iva_reabierto(new.company_id, old.entry_date);
    perform public._conta_iva_marcar(v, new.id, 'anulado');
  elsif new.status = 'validado' and old.status is distinct from 'validado' then
    v := public.conta_iva_reabierto(new.company_id, new.entry_date);
    perform public._conta_iva_marcar(v, new.id, 'validado');
  elsif new.status in ('propuesto', 'borrador') then
    v := public.conta_iva_reabierto(new.company_id, new.entry_date);
    perform public._conta_iva_marcar(v, new.id, 'cambiado');
  end if;
  return null;
end $$;
revoke all on function public._conta_iva_marcar_asiento() from public, anon, authenticated;
create trigger trg_journal_entry_iva_reabierto after update of status, entry_date, concept on public.journal_entry
  for each row execute function public._conta_iva_marcar_asiento();

create or replace function public._conta_iva_marcar_apunte()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_e record; v public.vat_reopening;
begin
  if not (new.vat_book is not null
          or exists (select 1 from public.company_account a where a.id = new.company_account_id and (a.code like '472%' or a.code like '477%'))) then
    return null;
  end if;
  select e.company_id, e.entry_date, e.source_type, e.source_id into v_e from public.journal_entry e where e.id = new.entry_id;
  if not found or public._conta_iva_exento(v_e.source_type, v_e.source_id, v_e.company_id) then return null; end if;
  v := public.conta_iva_reabierto(v_e.company_id, v_e.entry_date);
  perform public._conta_iva_marcar(v, new.entry_id, case when tg_op = 'INSERT' then 'creado' else 'cambiado' end);
  return null;
end $$;
revoke all on function public._conta_iva_marcar_apunte() from public, anon, authenticated;
create trigger trg_journal_line_iva_reabierto after insert or update on public.journal_line
  for each row execute function public._conta_iva_marcar_apunte();

create or replace function public._conta_iva_marcar_libro()
returns trigger language plpgsql security definer set search_path = public as $$
declare v public.vat_reopening;
begin
  if new.entry_id is null or public._conta_iva_exento(new.source_type, new.source_id, new.company_id) then return null; end if;
  v := public.conta_iva_reabierto(new.company_id,
         public._conta_iva_dia_del_libro(new.book, new.deduction_year, new.deduction_period, new.received_date, new.issue_date, new.operation_date));
  if v.id is null and tg_op = 'UPDATE' then
    v := public.conta_iva_reabierto(old.company_id,
           public._conta_iva_dia_del_libro(old.book, old.deduction_year, old.deduction_period, old.received_date, old.issue_date, old.operation_date));
  end if;
  perform public._conta_iva_marcar(v, new.entry_id, 'libro');
  return null;
end $$;
revoke all on function public._conta_iva_marcar_libro() from public, anon, authenticated;
create trigger trg_vat_book_entry_iva_reabierto after insert or update on public.vat_book_entry
  for each row execute function public._conta_iva_marcar_libro();

-- ── 1 · Reabrir ─────────────────────────────────────────────────────────────
-- Solo el administrador de la empresa o su gestor (la asesoría que presenta sus
-- impuestos, con su consentimiento). Un encargado no.
create or replace function public.conta_iva_puede_reabrir(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company c where c.id = p_company and public.current_user_is_admin_of(c.account_id))
      or exists (select 1 from public.company_tax_presenter t
                  where t.company_id = p_company and t.mode = 'advisor' and t.consented_at is not null and t.revoked_at is null
                    and public.current_user_is_admin_or_manager_of(t.advisor_account_id))
$$;
revoke all on function public.conta_iva_puede_reabrir(uuid) from public, anon;
grant execute on function public.conta_iva_puede_reabrir(uuid) to authenticated;

create or replace function public.conta_iva_reabrir(p_return uuid, p_motivo text, p_tipo text default 'complementary', p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tax_return; v_ultima public.tax_return; v_nueva uuid; v_seq smallint; v_id uuid; v_nombre text;
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null or r.form_code <> '303' then raise exception 'Esa declaración no es un 303.' using errcode = 'P0002'; end if;
  if not public.conta_iva_puede_reabrir(r.company_id) then
    raise exception 'Solo el administrador de la empresa o su gestor reabren un periodo presentado.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Escribe por qué se reabre (al menos diez letras): queda en cada asiento que se cambie.' using errcode = '23514';
  end if;
  if coalesce(p_tipo, 'complementary') not in ('complementary', 'substitutive') then
    raise exception 'La nueva presentación es complementaria o sustitutiva.' using errcode = '22023';
  end if;
  -- La última del periodo tiene que estar presentada, y nada reabierto ya.
  select * into v_ultima from public.tax_return
   where company_id = r.company_id and form_code = '303' and fiscal_year = r.fiscal_year and period = r.period
   order by sequence desc limit 1;
  if v_ultima.status not in ('filed', 'booked', 'paid', 'offset', 'refunded') then
    raise exception 'El 303 % de % no está presentado: no hay nada que reabrir.', r.period, r.fiscal_year using errcode = '22023';
  end if;
  if exists (select 1 from public.vat_reopening o where o.company_id = r.company_id and o.fiscal_year = r.fiscal_year and o.period = r.period and o.closed_at is null) then
    raise exception 'El % de % ya está reabierto para corregir.', public.conta_iva_periodo_nombre(r.period, r.fiscal_year, false), r.fiscal_year using errcode = '23505';
  end if;
  v_seq := v_ultima.sequence + 1;
  v_nombre := coalesce(p_quien_nombre, public.conta_impuesto_quien());
  insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period, sequence, kind, replaces_return_id, due_date, status)
  values (r.account_id, r.company_id, r.obligation_id, r.form_code, r.fiscal_year, r.cadence, r.period, v_seq, coalesce(p_tipo, 'complementary'), v_ultima.id, r.due_date, 'draft')
  returning id into v_nueva;
  insert into public.vat_reopening (account_id, company_id, fiscal_year, period, original_return_id, new_return_id, kind, reason, opened_by, opened_by_name)
  values (r.account_id, r.company_id, r.fiscal_year, r.period, v_ultima.id, v_nueva, coalesce(p_tipo, 'complementary'), btrim(p_motivo), auth.uid(), v_nombre)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'nueva', v_nueva, 'secuencia', v_seq,
    'texto', format('Reabierto el %s de %s para corregir. La presentación del %s se queda como estaba: lo que cambies irá en la %s nº %s.',
                    public.conta_iva_periodo_nombre(r.period, r.fiscal_year, false), r.fiscal_year,
                    to_char((coalesce(v_ultima.filed_at, v_ultima.updated_at) at time zone 'Europe/Madrid')::date, 'DD/MM'),
                    case when coalesce(p_tipo, 'complementary') = 'complementary' then 'complementaria' else 'sustitutiva' end, v_seq));
end $$;
revoke all on function public.conta_iva_reabrir(uuid, text, text, text) from public, anon;
grant execute on function public.conta_iva_reabrir(uuid, text, text, text) to authenticated;
comment on function public.conta_iva_reabrir(uuid, text, text, text) is
  'V04 · Reabrir para corregir (1408). Reabre un periodo con el 303 presentado (el administrador o el gestor, con motivo): crea la nueva declaración (sequence + 1, complementaria o sustitutiva, replaces_return_id → la última presentada) y deja la original como estaba.';

-- ── 4 · Se cierra al presentarse la nueva ──────────────────────────────────
create or replace function public._conta_iva_reapertura_cerrar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('filed', 'booked', 'paid', 'offset', 'refunded') and old.status not in ('filed', 'booked', 'paid', 'offset', 'refunded') then
    update public.vat_reopening set closed_at = now(), closed_by_name = coalesce(new.filed_by_name, public.conta_impuesto_quien())
     where new_return_id = new.id and closed_at is null;
  end if;
  return null;
end $$;
revoke all on function public._conta_iva_reapertura_cerrar() from public, anon, authenticated;
create trigger trg_tax_return_reapertura_cerrar after update of status on public.tax_return
  for each row execute function public._conta_iva_reapertura_cerrar();

-- Apuntar la nueva presentación (hecha en la sede de Hacienda): su CSV, cuándo,
-- y su resultado. La registra y la reapertura se cierra.
create or replace function public.conta_iva_reapertura_presentada(p_reopening uuid, p_csv text, p_fecha timestamptz, p_resultado text, p_importe numeric, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.vat_reopening; v_csv text := upper(btrim(coalesce(p_csv, ''))); v_nombre text;
begin
  select * into o from public.vat_reopening where id = p_reopening for update;
  if o.id is null then raise exception 'Esa reapertura no está.' using errcode = 'P0002'; end if;
  if not public.conta_iva_puede_reabrir(o.company_id) then
    raise exception 'Solo el administrador de la empresa o su gestor apuntan la nueva presentación.' using errcode = '42501';
  end if;
  if o.closed_at is not null then raise exception 'Esta reapertura ya está cerrada.' using errcode = '22023'; end if;
  if v_csv !~ '^[A-Z0-9]{16}$' then raise exception 'El CSV de Hacienda son 16 letras y números.' using errcode = '22023'; end if;
  if p_resultado not in ('to_pay', 'to_refund', 'to_offset', 'zero', 'no_activity') then raise exception 'Di el resultado de la nueva presentación.' using errcode = '22023'; end if;
  if p_resultado in ('zero', 'no_activity') and coalesce(p_importe, 0) <> 0 or p_resultado not in ('zero', 'no_activity') and coalesce(p_importe, 0) <= 0 then
    raise exception 'El importe no casa con el resultado.' using errcode = '22023';
  end if;
  v_nombre := coalesce(p_quien_nombre, public.conta_impuesto_quien());
  update public.tax_return set status = 'filed', result_kind = p_resultado, amount = coalesce(p_importe, 0), filed_at = coalesce(p_fecha, now()),
         filed_by = auth.uid(), filed_by_name = v_nombre, filed_via = 'outside', aeat_csv = v_csv, updated_at = now()
   where id = o.new_return_id;
  return jsonb_build_object('ok', true, 'texto', format('Apuntada la %s nº %s del %s de %s (CSV %s). El periodo vuelve a estar cerrado.',
    case when o.kind = 'complementary' then 'complementaria' else 'sustitutiva' end,
    (select sequence from public.tax_return where id = o.new_return_id),
    public.conta_iva_periodo_nombre(o.period, o.fiscal_year, false), o.fiscal_year, v_csv));
end $$;
revoke all on function public.conta_iva_reapertura_presentada(uuid, text, timestamptz, text, numeric, text) from public, anon;
grant execute on function public.conta_iva_reapertura_presentada(uuid, text, timestamptz, text, numeric, text) to authenticated;

-- ── 5 · El recordatorio a los 30 días ──────────────────────────────────────
create or replace function public.conta_iva_reaperturas_recordar()
returns integer language plpgsql security definer set search_path = public as $$
declare o record; n int := 0;
begin
  for o in select v.*, coalesce(nullif(c.trade_name, ''), c.legal_name) as empresa from public.vat_reopening v join public.company c on c.id = v.company_id
            where v.closed_at is null and v.opened_at < now() - interval '30 days'
              and (v.reminded_at is null or v.reminded_at < now() - interval '7 days') loop
    begin
      perform public.encolar_alerta(
        p_kind            => 'iva_reabierto_sin_presentar',
        p_subject         => 'Un trimestre reabierto sin presentar',
        p_message         => format('El %s de %s de %s lleva %s días reabierto para corregir y sin presentar. Presenta la %s y apúntala en Impuestos.',
                               public.conta_iva_periodo_nombre(o.period, o.fiscal_year, false), o.fiscal_year, o.empresa,
                               extract(day from now() - o.opened_at)::int, case when o.kind = 'complementary' then 'complementaria' else 'sustitutiva' end),
        p_debounce_kind   => 'iva_reabierto:' || o.id::text,
        p_debounce_window => interval '7 days',
        p_account_id      => o.account_id,
        p_location_id     => null,
        p_brand_id        => null,
        p_severity        => 'aviso');
      update public.vat_reopening set reminded_at = now() where id = o.id;
      n := n + 1;
    exception when others then
      raise notice 'iva_reabierto_sin_presentar: no se pudo encolar el aviso (%)', sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.conta_iva_reaperturas_recordar() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'iva-reabierto-recordar') then perform cron.unschedule('iva-reabierto-recordar'); end if;
    perform cron.schedule('iva-reabierto-recordar', '17 7 * * *', $cron$select public.conta_iva_reaperturas_recordar()$cron$);
  end if;
end $$;

-- ── 6 · Para las pantallas ─────────────────────────────────────────────────
create or replace function public.conta_iva_presentados(p_company uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  -- Quien es de la cuenta, o quien ve sus impuestos (su asesoría, con su consentimiento).
  if v_cuenta is null or not (v_cuenta = any ((select public.current_user_account_ids())::uuid[]) or public.conta_impuesto_puede_ver(p_company)) then
    raise exception 'No puedes ver esta empresa.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('periodo', r.period, 'ejercicio', r.fiscal_year, 'desde', f.desde, 'hasta', f.hasta,
                                        'presentado', coalesce(u.filed_at, u.updated_at), 'declaracion', u.id,
                                        'nombre', public.conta_iva_periodo_nombre(r.period, r.fiscal_year),
                                        'siguiente', public.conta_iva_periodo_nombre(
                                            public.conta_iva_periodo_de(r.cadence, coalesce(public.conta_primer_dia_iva_abierto(p_company, f.hasta + 1), f.hasta + 1)),
                                            extract(year from coalesce(public.conta_primer_dia_iva_abierto(p_company, f.hasta + 1), f.hasta + 1))::int,
                                            extract(year from coalesce(public.conta_primer_dia_iva_abierto(p_company, f.hasta + 1), f.hasta + 1))::int <> r.fiscal_year),
                                        -- V04 (1408): reabierto para corregir (sin candado hasta su nueva presentación).
                                        'reabierto', (select jsonb_build_object('id', o.id, 'motivo', o.reason, 'desde', o.opened_at, 'por', o.opened_by_name,
                                                                                'tipo', o.kind, 'secuencia', (select n.sequence from public.tax_return n where n.id = o.new_return_id))
                                                        from public.vat_reopening o where o.company_id = p_company and o.fiscal_year = r.fiscal_year
                                                         and o.period = r.period and o.closed_at is null))
                     order by f.desde)
      from public.tax_return r
     cross join lateral public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period) f
     cross join lateral (select x.* from public.tax_return x where x.company_id = r.company_id and x.form_code = '303' and x.fiscal_year = r.fiscal_year
                           and x.period = r.period and x.status in ('filed', 'booked', 'paid', 'offset', 'refunded')
                         order by x.sequence desc limit 1) u
     where r.company_id = p_company and r.form_code = '303' and r.fiscal_year = p_year and r.sequence = 1
       and r.period ~ '^([1-4]T|0[1-9]|1[0-2])$'
       and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')), '[]'::jsonb);
end $$;
revoke all on function public.conta_iva_presentados(uuid, int) from public, anon;
grant execute on function public.conta_iva_presentados(uuid, int) to authenticated;
comment on function public.conta_iva_presentados(uuid, int) is
  'V04 · candado del IVA (1233; 1408: con «reabierto» y la fecha de la última presentada). Los periodos con el 303 presentado de un ejercicio. Para el candado de las pantallas; quien manda es la base (conta_iva_presentado).';

-- La vuelta atrás PARA si hay alguna reapertura: cada una tiene su nueva presentación y sus asientos marcados.
create or replace function public._conta_iva_reabrir_se_puede_deshacer()
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.vat_reopening) then
    raise exception 'Vuelta atrás de la 1408 PARADA: hay % reaperturas del IVA (con su nueva presentación y sus asientos marcados).',
      (select count(*) from public.vat_reopening) using errcode = 'P0001';
  end if;
end $$;
revoke all on function public._conta_iva_reabrir_se_puede_deshacer() from public, anon, authenticated;

-- Las reaperturas de un ejercicio, con la original y la nueva presentación (Impuestos las enseña juntas).
create or replace function public.conta_iva_reaperturas(p_company uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not (v_cuenta = any ((select public.current_user_account_ids())::uuid[]) or public.conta_impuesto_puede_ver(p_company)) then
    raise exception 'No puedes ver esta empresa.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'periodo', o.period, 'ejercicio', o.fiscal_year, 'tipo', o.kind, 'motivo', o.reason,
             'abierta', o.opened_at, 'por', o.opened_by_name, 'cerrada', o.closed_at, 'cerrada_por', o.closed_by_name,
             'dias', extract(day from coalesce(o.closed_at, now()) - o.opened_at)::int,
             'original', jsonb_build_object('id', a.id, 'secuencia', a.sequence, 'estado', a.status, 'presentada', a.filed_at, 'csv', a.aeat_csv, 'importe', a.amount, 'resultado', a.result_kind),
             'nueva', jsonb_build_object('id', n.id, 'secuencia', n.sequence, 'estado', n.status, 'presentada', n.filed_at, 'csv', n.aeat_csv, 'importe', n.amount, 'resultado', n.result_kind),
             'asientos', (select count(distinct m.entry_id) from public.vat_reopening_entry m where m.reopening_id = o.id))
           order by o.opened_at)
      from public.vat_reopening o
      join public.tax_return a on a.id = o.original_return_id
      join public.tax_return n on n.id = o.new_return_id
     where o.company_id = p_company and o.fiscal_year = p_year), '[]'::jsonb);
end $$;
revoke all on function public.conta_iva_reaperturas(uuid, int) from public, anon;
grant execute on function public.conta_iva_reaperturas(uuid, int) to authenticated;
