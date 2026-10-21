-- supabase/migrations/20261123T0100_p01_despacho.sql
--
-- P01 · «IMPUESTOS DE TUS CLIENTES» (Sumied para despachos). Solo añade: dos
-- columnas que admiten nulos en accounts, una tabla y funciones nuevas.
--
-- Decisiones de Julio (19/10, visto bueno al paso 1):
--   · Una cuenta es asesoría porque lo dice ella («Soy una asesoría»), en el
--     alta o en Ajustes: accounts.tax_advisor_since. No se deduce de tener
--     clientes: una asesoría nueva tiene que ver la pantalla para invitar al
--     primero.
--   · Cada cliente tiene una responsable, elegida entre las personas de la
--     asesoría: tax_client_assignee. Es de la asesoría: el cliente no la ve.
--   · La vista del trimestre la ve cualquier persona de la asesoría (igual que
--     conta_impuesto_puede_ver); asignar responsable, solo administración o
--     encargadas. Presentar sigue por lo que ya existe (conta_cert_confirmar
--     y conta-hacienda), de uno en uno.
--   · Solo salen los clientes con el consentimiento vivo (company_tax_presenter
--     en modo asesoría, consentido y sin retirar). Una empresa no ve nada de
--     esto: ni a las demás clientas de su asesoría ni quién la lleva.
--   · Las respuestas al resumen que se manda a los clientes van al correo de
--     la asesoría (accounts.billing_email); si no lo tiene, se pide antes.
--
--   accounts.tax_advisor_since / tax_advisor_by           la marca «Soy una asesoría»
--   tax_client_assignee                                   la responsable de cada cliente
--   conta_despacho_soy(cuenta)                [la persona] ¿es asesoría?, cuántos clientes, qué puede hacer
--   conta_despacho_marcar(cuenta, sí/no)      [la persona] «Soy una asesoría» (administración)
--   conta_despacho_correo_poner(cuenta, correo)[la persona] el correo al que responden los clientes
--   conta_despacho_equipo(cuenta)             [la persona] las personas de la asesoría
--   conta_despacho_responsable_poner(…)       [la persona] la responsable de un cliente
--   conta_despacho_trimestre(cuenta, año, T)  [la persona] la pantalla entera: cifras, filtros y clientes
--
-- Vuelta atrás: supabase/vuelta-atras/20261123T0100_p01_despacho.down.sql
-- Prueba: supabase/staging/sql/20261123_p01_despacho_prueba.sql

-- ── La marca «Soy una asesoría» ────────────────────────────────────────────
alter table public.accounts add column if not exists tax_advisor_since timestamptz;
alter table public.accounts add column if not exists tax_advisor_by uuid;
comment on column public.accounts.tax_advisor_since is
  'P01. Desde cuándo la cuenta dice que es una asesoría («Soy una asesoría»): enseña «Impuestos de tus clientes». Null = no lo es. Lo pone conta_despacho_marcar.';
comment on column public.accounts.tax_advisor_by is
  'P01. Quién marcó la cuenta como asesoría.';

-- ── La responsable de cada cliente ──────────────────────────────────────────
-- account_id es la ASESORÍA (la cuenta que la ve), no la de la empresa cliente.
create table if not exists public.tax_client_assignee (
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  user_id           uuid not null,
  assigned_by       uuid,
  assigned_by_name  text,
  assigned_at       timestamptz not null default now(),
  primary key (account_id, company_id)
);
comment on table public.tax_client_assignee is
  'P01. Quién de la asesoría (account_id) lleva los impuestos de cada empresa cliente. Solo lo ve la asesoría; lo escribe conta_despacho_responsable_poner.';

alter table public.tax_client_assignee enable row level security;
drop policy if exists tax_client_assignee_select on public.tax_client_assignee;
create policy tax_client_assignee_select on public.tax_client_assignee for select to authenticated
  using (public.belongs_to_account(account_id));
revoke all on table public.tax_client_assignee from anon, authenticated;
grant select on table public.tax_client_assignee to authenticated;

-- Ninguna cuenta se marca aquí: en producción hay 0 asesorías con clientes
-- (company_tax_presenter en modo asesoría, medido el 19/10), y un update sobre
-- accounts haría que el fichero dejara de solo añadir.

-- ── Los clientes con permiso vivo de una asesoría ──────────────────────────
create or replace function public.conta_despacho_clientes(p_account uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select t.company_id from public.company_tax_presenter t
   where t.advisor_account_id = p_account and t.mode = 'advisor' and t.consented_at is not null and t.revoked_at is null
$$;

-- ── ¿Es asesoría? ───────────────────────────────────────────────────────────
create or replace function public.conta_despacho_soy(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.accounts;
begin
  if p_account is null or not public.belongs_to_account(p_account) then
    raise exception 'No eres de esta cuenta.' using errcode = '42501';
  end if;
  select * into a from public.accounts where id = p_account;
  return jsonb_build_object(
    'asesoria', a.tax_advisor_since is not null,
    'desde', a.tax_advisor_since,
    'nombre', coalesce(nullif(btrim(a.legal_name), ''), a.name),
    'correo_respuesta', nullif(btrim(coalesce(a.billing_email, '')), ''),
    'clientes', (select count(*) from public.conta_despacho_clientes(p_account)),
    'puede_gestionar', public.current_user_is_admin_or_manager_of(p_account),
    'puede_marcar', public.current_user_is_admin_of(p_account));
end $$;

-- ── «Soy una asesoría» ──────────────────────────────────────────────────────
create or replace function public.conta_despacho_marcar(p_account uuid, p_es boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_desde timestamptz;
begin
  if p_account is null or not public.current_user_is_admin_of(p_account) then
    raise exception 'Solo la administración de la cuenta dice si es una asesoría.' using errcode = '42501';
  end if;
  if p_es is null then raise exception 'Di si la cuenta es una asesoría o no.' using errcode = '22023'; end if;
  select count(*) into v_n from public.conta_despacho_clientes(p_account);
  if not p_es and v_n > 0 then
    -- Quitarla escondería a clientes que siguen dando permiso (regla 7): lo retiran ellos.
    raise exception 'Llevas los impuestos de % cliente%: mientras te den permiso, la cuenta sigue siendo una asesoría.',
      v_n, case when v_n = 1 then '' else 's' end using errcode = '22023';
  end if;
  update public.accounts
     set tax_advisor_since = case when p_es then coalesce(tax_advisor_since, now()) end,
         tax_advisor_by = case when p_es then coalesce(tax_advisor_by, auth.uid()) end
   where id = p_account
  returning tax_advisor_since into v_desde;
  return jsonb_build_object('ok', true, 'asesoria', p_es, 'desde', v_desde,
    'mensaje', case when p_es
      then 'Hecho: la cuenta es una asesoría. En Impuestos verás «Impuestos de tus clientes»' ||
           case when v_n = 0 then ', vacía hasta que un cliente te invite.' else format(', con tus %s cliente%s.', v_n, case when v_n = 1 then '' else 's' end) end
      else 'Hecho: la cuenta ya no es una asesoría.' end);
end $$;

-- ── El correo al que responden los clientes ────────────────────────────────
create or replace function public.conta_despacho_correo_poner(p_account uuid, p_correo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text := lower(btrim(coalesce(p_correo, '')));
begin
  if p_account is null or not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo la administración o una encargada de la asesoría cambia su correo.' using errcode = '42501';
  end if;
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un correo válido.' using errcode = '22023'; end if;
  update public.accounts set billing_email = v where id = p_account;
  return jsonb_build_object('ok', true, 'correo', v,
    'mensaje', format('Guardado: las respuestas de tus clientes llegarán a %s.', v));
end $$;

-- ── Las personas de la asesoría ─────────────────────────────────────────────
create or replace function public.conta_despacho_equipo(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_account is null or not public.belongs_to_account(p_account) then
    raise exception 'No eres de esta cuenta.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('usuario', u.user_id, 'nombre', public.conta_impuesto_nombre_de_en(u.user_id, p_account), 'rol', u.role)
                                    order by public.conta_impuesto_nombre_de_en(u.user_id, p_account)), '[]')
            from public.user_profiles u
           where u.account_id = p_account and u.active);
end $$;

-- El nombre de una persona en una cuenta (puede estar en varias).
create or replace function public.conta_impuesto_nombre_de_en(p_user uuid, p_account uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(display_name), '') from public.user_profiles
                    where user_id = p_user order by (account_id = p_account) desc, active desc, display_name limit 1), 'Sin nombre')
$$;

-- ── La responsable de un cliente ────────────────────────────────────────────
create or replace function public.conta_despacho_responsable_poner(p_account uuid, p_company uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_empresa text; v_nombre text; v_quien text;
begin
  if p_account is null or not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo la administración o una encargada de la asesoría reparte los clientes.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.conta_despacho_clientes(p_account) c where c = p_company) then
    raise exception 'Esa empresa no te ha dado permiso para llevar sus impuestos.' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(trade_name), ''), legal_name) into v_empresa from public.company where id = p_company;
  v_quien := public.conta_impuesto_nombre_de_en(auth.uid(), p_account);
  if p_user is null then
    delete from public.tax_client_assignee where account_id = p_account and company_id = p_company;
    return jsonb_build_object('ok', true, 'mensaje', format('%s se queda sin responsable.', v_empresa));
  end if;
  if not exists (select 1 from public.user_profiles where user_id = p_user and account_id = p_account and active) then
    raise exception 'Esa persona no es de tu asesoría.' using errcode = '22023';
  end if;
  v_nombre := public.conta_impuesto_nombre_de_en(p_user, p_account);
  insert into public.tax_client_assignee (account_id, company_id, user_id, assigned_by, assigned_by_name)
  values (p_account, p_company, p_user, auth.uid(), v_quien)
  on conflict (account_id, company_id) do update
    set user_id = excluded.user_id, assigned_by = excluded.assigned_by, assigned_by_name = excluded.assigned_by_name, assigned_at = now();
  return jsonb_build_object('ok', true, 'usuario', p_user, 'nombre', v_nombre,
    'mensaje', format('%s lleva ahora %s.', v_nombre, v_empresa));
end $$;

-- ── La pantalla: el trimestre de todos los clientes ─────────────────────────
-- Qué modelos son «del trimestre» (nT del año):
--   · trimestrales: el periodo nT;  · mensuales: sus tres meses;
--   · pagos del 202: 1P en el 1T, 2P en el 3T y 3P en el 4T;
--   · anuales: los que se presentan en los tres meses siguientes al trimestre
--     (el 390 de 2026, en enero de 2027: en el 4T de 2026).
-- Salen también las declaraciones que existen aunque el modelo ya no esté
-- vigente, y los periodos sin plazo calculable (regla 7: no se esconde nada).
-- No escribe nada. p_hoy solo cambia «hoy» (para las pruebas y las capturas).
create or replace function public.conta_despacho_trimestre(p_account uuid, p_year int, p_period text, p_hoy date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := coalesce(p_hoy, (now() at time zone 'Europe/Madrid')::date);
  v_q int; v_fin date; v_ven date; v_202 text;
  v_clientes jsonb; v_resumen jsonb; v_plazos jsonb; v_yo uuid := auth.uid();
begin
  if p_period is null or p_period !~ '^[1-4]T$' or p_year is null or p_year not between 2000 and 2100 then
    raise exception 'Elige un trimestre: 1T, 2T, 3T o 4T de un año.' using errcode = '22023';
  end if;
  if p_account is null or not public.belongs_to_account(p_account) then
    raise exception 'No eres de esta asesoría.' using errcode = '42501';
  end if;
  v_q := left(p_period, 1)::int;
  v_fin := (make_date(p_year, v_q * 3, 1) + interval '1 month')::date - 1;
  v_ven := (v_fin + interval '3 months')::date;
  v_202 := case v_q when 1 then '1P' when 3 then '2P' when 4 then '3P' end;

  select jsonb_build_object('presentacion', x.presentacion, 'domiciliacion', x.domiciliacion) into v_plazos
    from public.conta_impuesto_plazo_si_hay('303', 'quarterly', p_year, p_period) x;

  with cli as (
    select c.id, c.account_id, coalesce(nullif(btrim(c.trade_name), ''), c.legal_name) as nombre, c.legal_name, c.entity_kind, c.is_hospitality,
           tp.vat_period, tp.sii, tp.vat_prorata, tp.vat_prorata_pct, t.advisor_basis, t.consented_at, t.consented_by_name,
           coalesce(t.certificate_id,
                    (select k.id from public.tax_certificate k
                      where k.owner_account_id = p_account and k.status = 'active' and k.valid_to > now()
                      order by k.valid_to desc limit 1)) as cert
      from public.company_tax_presenter t
      join public.company c on c.id = t.company_id
      left join public.company_tax_profile tp on tp.company_id = c.id
     where t.advisor_account_id = p_account and t.mode = 'advisor' and t.consented_at is not null and t.revoked_at is null
  ),
  per as (
    select o.company_id, o.form_code, o.cadence, o.payment_mode, x.ej, x.per
      from public.tax_obligation o
      join cli on cli.id = o.company_id
     cross join lateral (
       select p_year, p_period where o.cadence = 'quarterly'
       union all select p_year, lpad(m::text, 2, '0') from generate_series(v_q * 3 - 2, v_q * 3) m where o.cadence = 'monthly'
       union all select p_year, v_202 where o.cadence = 'instalments_202' and v_202 is not null
       union all select y, '0A' from generate_series(p_year - 1, p_year) y where o.cadence = 'annual'
     ) x(ej, per)
     where o.valid_to is null and o.active
  ),
  dec as (
    select r.* from public.tax_return r join cli on cli.id = r.company_id
     where r.sequence = 1 and r.fiscal_year between p_year - 1 and p_year
  ),
  base as (
    select coalesce(per.company_id, d.company_id) as company_id, coalesce(per.form_code, d.form_code) as modelo,
           coalesce(per.cadence, d.cadence) as cadencia, coalesce(per.ej, d.fiscal_year) as ej, coalesce(per.per, d.period) as periodo,
           per.payment_mode as pago_obl, d.id as rid, d.status, d.result_kind, d.amount, d.payment_mode, d.due_date,
           d.due_date_direct_debit, d.filed_at, d.filed_via
      from per full join dec d
        on d.company_id = per.company_id and d.form_code = per.form_code and d.fiscal_year = per.ej and d.period = per.per
  ),
  f0 as (
    select b.*, coalesce(b.due_date, pl.presentacion) as plazo, coalesce(b.due_date_direct_debit, pl.domiciliacion) as plazo_dom,
           coalesce(coalesce(b.payment_mode, nullif(b.pago_obl, 'none')) = 'direct_debit', false) as domicilia,
           coalesce(b.status, 'pending') in ('filed', 'booked', 'paid', 'offset', 'refunded') as presentado,
           coalesce(b.status, 'pending') = 'not_required' as no_hace_falta,
           (select count(*) from public.tax_return_check k where k.tax_return_id = b.rid and k.result = 'error') as errores,
           (select count(*) from public.tax_return_check k where k.tax_return_id = b.rid and k.result = 'warning' and k.accepted_at is null) as avisos,
           (select k.title from public.tax_return_check k where k.tax_return_id = b.rid and k.result in ('error', 'warning') and k.accepted_at is null
             order by (k.result = 'error') desc, k.checked_at limit 1) as aviso
      from base b
      left join lateral public.conta_impuesto_plazo_si_hay(b.modelo, b.cadencia, b.ej, b.periodo) pl on true
  ),
  f as (
    select f0.*,
           case when f0.domicilia and f0.plazo_dom is not null then f0.plazo_dom else f0.plazo end as plazo_suyo,
           case
             when f0.no_hace_falta then 'no_hace_falta'
             when f0.presentado then 'presentado'
             when f0.errores > 0 then 'avisos'
             when f0.status = 'reviewed' then 'listo'
             when f0.status = 'draft' and f0.avisos > 0 then 'avisos'
             when f0.status = 'draft' then 'revisar'
             else 'por_calcular' end as estado
      from f0
     where (f0.cadencia = 'quarterly' and f0.ej = p_year and f0.periodo = p_period)
        or (f0.cadencia = 'monthly' and f0.ej = p_year and f0.periodo in (select lpad(m::text, 2, '0') from generate_series(v_q * 3 - 2, v_q * 3) m))
        or (f0.cadencia = 'instalments_202' and f0.ej = p_year and f0.periodo = v_202)
        or (f0.cadencia = 'annual' and f0.plazo > v_fin and f0.plazo <= v_ven)
  ),
  fx as (
    select f.*,
           f.plazo_suyo - v_hoy as dias,
           (not f.presentado and not f.no_hace_falta and f.plazo_suyo is not null and f.plazo_suyo - v_hoy <= 2) as urgente
      from f
  ),
  porcli as (
    select cli.*,
           k.subject_name as cert_titular, k.valid_to as cert_caduca, k.status as cert_status,
           case
             when cli.cert is null then 'sin_certificado'
             when k.status = 'removed' then 'quitado'
             when k.valid_to <= now() then 'caducado'
             when not public.conta_cert_puede_usar(v_yo, k.id) then 'sin_permiso'
             when k.valid_to <= now() + interval '30 days' then 'caduca'
             else 'ok' end as cert_estado,
           a.user_id as resp_id,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'declaracion', fx.rid, 'modelo', fx.modelo, 'nombre', tf.name, 'cadencia', fx.cadencia,
                     'ejercicio', fx.ej, 'periodo', fx.periodo, 'estado', fx.estado,
                     'estado_texto', public.conta_impuesto_estado_texto(coalesce(fx.status, 'pending')),
                     'resultado', fx.result_kind, 'importe', fx.amount,
                     'plazo', fx.plazo, 'plazo_domiciliacion', fx.plazo_dom, 'plazo_suyo', fx.plazo_suyo,
                     'domicilia', fx.domicilia, 'dias', fx.dias, 'urgente', fx.urgente, 'atrasado', fx.dias < 0 and fx.urgente,
                     'errores', fx.errores, 'avisos', fx.avisos, 'aviso', fx.aviso,
                     'presentada', fx.filed_at, 'por', fx.filed_via,
                     'desde_sumied', fx.modelo = '303')
                   order by (fx.modelo <> '303'), fx.modelo, fx.ej, fx.periodo), '[]')
              from fx left join public.tax_form tf on tf.code = fx.modelo where fx.company_id = cli.id) as modelos,
           (select count(*) from fx where fx.company_id = cli.id and not fx.no_hace_falta) as n_modelos,
           (select count(*) from fx where fx.company_id = cli.id and fx.presentado) as n_presentados,
           (select count(*) from fx where fx.company_id = cli.id and fx.estado = 'listo') as n_listos,
           (select count(*) from fx where fx.company_id = cli.id and fx.estado = 'listo' and fx.modelo = '303') as n_listos_303,
           (select count(*) from fx where fx.company_id = cli.id and fx.estado = 'avisos') as n_avisos,
           (select count(*) from fx where fx.company_id = cli.id and fx.urgente and fx.estado <> 'listo') as n_urgentes,
           -- A ingresar: lo que falta por presentar. A compensar y a devolver: lo del trimestre, presentado o no.
           (select sum(fx.amount) from fx where fx.company_id = cli.id and fx.result_kind = 'to_pay' and not fx.no_hace_falta and not fx.presentado) as a_ingresar,
           (select sum(fx.amount) from fx where fx.company_id = cli.id and fx.result_kind = 'to_offset') as a_compensar,
           (select sum(fx.amount) from fx where fx.company_id = cli.id and fx.result_kind = 'to_refund') as a_devolver,
           (select bool_or(fx.domicilia) from fx where fx.company_id = cli.id) as domicilia,
           -- Lo que vence: su aviso si lo tiene («Faltan 3 facturas por correo · vence el 15/10»), si no, revisarlo.
           (select coalesce(fx.aviso, format('Revisar el %s', fx.modelo))
                   || case when fx.dias < 0 then ': venció el ' else case when fx.aviso is null then ': vence el ' else ' · vence el ' end end
                   || to_char(fx.plazo_suyo, 'DD/MM')
              from fx where fx.company_id = cli.id and fx.urgente and fx.estado <> 'listo' order by fx.plazo_suyo, fx.modelo limit 1) as u_txt,
           (select format('Corregir el %s: %s', fx.modelo, coalesce(fx.aviso, 'tiene errores'))
              from fx where fx.company_id = cli.id and fx.errores > 0 order by fx.plazo_suyo nulls last, fx.modelo limit 1) as e_txt,
           (select coalesce(fx.aviso, format('Mirar los avisos del %s', fx.modelo))
              from fx where fx.company_id = cli.id and fx.estado = 'avisos' order by fx.plazo_suyo nulls last, fx.modelo limit 1) as w_txt,
           (select fx.modelo from fx where fx.company_id = cli.id and fx.estado = 'listo' order by fx.plazo_suyo nulls last, fx.modelo limit 1) as l_modelo,
           (select fx.modelo from fx where fx.company_id = cli.id and fx.estado = 'revisar' order by fx.plazo_suyo nulls last, fx.modelo limit 1) as r_modelo,
           (select fx.modelo from fx where fx.company_id = cli.id and fx.estado = 'por_calcular' order by fx.plazo_suyo nulls last, fx.modelo limit 1) as p_modelo
      from cli
      left join public.tax_certificate k on k.id = cli.cert
      left join public.tax_client_assignee a on a.account_id = p_account and a.company_id = cli.id
  ),
  conpaso as (
    select pc.*,
           (pc.n_modelos > pc.n_presentados) as pendiente,
           case
             when pc.n_modelos > pc.n_presentados and pc.cert_estado = 'sin_certificado' then 'Falta el certificado para presentar'
             when pc.n_modelos > pc.n_presentados and pc.cert_estado in ('caducado', 'quitado') then 'Renovar el certificado: ya no vale'
             when pc.n_modelos > pc.n_presentados and pc.cert_estado = 'sin_permiso' then 'Pedir permiso para usar el certificado'
             when pc.u_txt is not null then pc.u_txt
             when pc.e_txt is not null then pc.e_txt
             when pc.w_txt is not null then pc.w_txt
             when pc.n_listos = 1 then format('Presentar el %s', pc.l_modelo)
             when pc.n_listos > 1 then format('Presentar %s modelos', pc.n_listos)
             when pc.r_modelo is not null then format('Revisar el %s', pc.r_modelo)
             when pc.p_modelo is not null then format('Preparar el %s', pc.p_modelo)
             when pc.cert_estado = 'caduca' then format('Renovar el certificado: caduca el %s', to_char(pc.cert_caduca at time zone 'Europe/Madrid', 'DD/MM'))
             when pc.n_modelos = 0 then 'Sin modelos este trimestre'
             else 'Todo presentado' end as siguiente_paso,
           case
             when pc.u_txt is not null then 0
             when pc.n_modelos > pc.n_presentados and pc.cert_estado in ('sin_certificado', 'caducado', 'quitado', 'sin_permiso') then 1
             when pc.n_avisos > 0 then 2
             when pc.n_listos > 0 then 3
             when pc.n_modelos > pc.n_presentados then 4
             when pc.cert_estado = 'caduca' then 5
             else 6 end as orden
      from porcli pc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'empresa', c.id, 'nombre', c.nombre, 'razon_social', c.legal_name,
           'tipo', c.entity_kind, 'hosteleria', c.is_hospitality, 'periodo_iva', c.vat_period, 'sii', coalesce(c.sii, false),
           'prorrata', case when c.vat_prorata then c.vat_prorata_pct end, 'base', c.advisor_basis,
           'consentimiento', jsonb_build_object('quien', c.consented_by_name, 'cuando', c.consented_at),
           'domicilia', coalesce(c.domicilia, false),
           'modelos', c.modelos,
           'a_ingresar', c.a_ingresar, 'a_compensar', c.a_compensar, 'a_devolver', c.a_devolver,
           'responsable', case when c.resp_id is null then null else jsonb_build_object(
               'usuario', c.resp_id, 'nombre', public.conta_impuesto_nombre_de_en(c.resp_id, p_account),
               'activa', exists (select 1 from public.user_profiles u where u.user_id = c.resp_id and u.account_id = p_account and u.active)) end,
           'certificado', jsonb_build_object('id', c.cert, 'estado', c.cert_estado, 'titular', c.cert_titular, 'caduca', c.cert_caduca,
               'dias', case when c.cert_caduca is null then null else ((c.cert_caduca at time zone 'Europe/Madrid')::date - (now() at time zone 'Europe/Madrid')::date) end),
           'listos', c.n_listos, 'listos_303', c.n_listos_303, 'con_avisos', c.n_avisos > 0, 'urgentes', c.n_urgentes,
           'pendiente', c.pendiente, 'siguiente_paso', c.siguiente_paso, 'orden', c.orden)
         order by c.orden, c.nombre), '[]')
    into v_clientes
    from conpaso c;

  select jsonb_build_object(
           'clientes', jsonb_array_length(v_clientes),
           'modelos', coalesce(sum((select count(*) from jsonb_array_elements(x->'modelos') m where m->>'estado' <> 'no_hace_falta')), 0),
           'presentados', coalesce(sum((select count(*) from jsonb_array_elements(x->'modelos') m where m->>'estado' = 'presentado')), 0),
           'listos', coalesce(sum((select count(*) from jsonb_array_elements(x->'modelos') m where m->>'estado' = 'listo')), 0),
           'para_revisar', coalesce(sum((select count(*) from jsonb_array_elements(x->'modelos') m where m->>'estado' in ('revisar', 'avisos', 'por_calcular'))), 0),
           'vencen', coalesce(sum((select count(*) from jsonb_array_elements(x->'modelos') m
                                    where m->>'estado' in ('revisar', 'avisos', 'por_calcular') and (m->>'urgente')::boolean and not (m->>'atrasado')::boolean)), 0),
           'atrasados', coalesce(sum((select count(*) from jsonb_array_elements(x->'modelos') m
                                       where m->>'estado' in ('revisar', 'avisos', 'por_calcular', 'listo') and (m->>'atrasado')::boolean)), 0),
           'filtros', jsonb_build_object(
             'con_avisos', count(*) filter (where (x->>'con_avisos')::boolean),
             'listos', count(*) filter (where (x->>'listos')::int > 0),
             'sin_certificado', count(*) filter (where x->'certificado'->>'estado' in ('sin_certificado', 'caducado', 'quitado', 'sin_permiso')),
             'domiciliados', count(*) filter (where (x->>'domicilia')::boolean)))
    into v_resumen
    from jsonb_array_elements(v_clientes) x;

  return jsonb_build_object(
    'hoy', v_hoy, 'ejercicio', p_year, 'periodo', p_period, 'plazos', v_plazos,
    'asesoria', (select coalesce(nullif(btrim(legal_name), ''), name) from public.accounts where id = p_account),
    'es_asesoria', (select tax_advisor_since is not null from public.accounts where id = p_account),
    'puede_gestionar', public.current_user_is_admin_or_manager_of(p_account),
    'resumen', v_resumen, 'clientes', v_clientes);
end $$;

comment on function public.conta_despacho_trimestre(uuid, int, text, date) is
  'P01. Lo que pinta «Impuestos de tus clientes»: las cifras, los filtros y cada cliente con permiso vivo, con sus modelos del trimestre, importes, certificado, responsable y siguiente paso. No escribe nada.';

revoke all on function public.conta_despacho_clientes(uuid), public.conta_despacho_soy(uuid), public.conta_despacho_marcar(uuid, boolean),
  public.conta_despacho_correo_poner(uuid, text), public.conta_despacho_equipo(uuid), public.conta_impuesto_nombre_de_en(uuid, uuid),
  public.conta_despacho_responsable_poner(uuid, uuid, uuid), public.conta_despacho_trimestre(uuid, int, text, date) from public, anon, authenticated;
grant execute on function public.conta_despacho_soy(uuid), public.conta_despacho_marcar(uuid, boolean), public.conta_despacho_correo_poner(uuid, text),
  public.conta_despacho_equipo(uuid), public.conta_despacho_responsable_poner(uuid, uuid, uuid),
  public.conta_despacho_trimestre(uuid, int, text, date) to authenticated, service_role;
grant execute on function public.conta_despacho_clientes(uuid), public.conta_impuesto_nombre_de_en(uuid, uuid) to service_role;
