-- supabase/migrations/20261122T0230_i01b_asesoria.sql
--
-- I01b · P4b · «INVITAR A MI ASESORÍA». Solo añade: una tabla y funciones.
--
-- Decisión de Julio (18/10, «ok a todo»): la invitación VINCULA, no crea
-- cuentas sola. El único freno para dar de alta cuentas (un administrador de
-- plataforma, conta_crear_cuenta_sola) no se afloja:
--   · un administrador de la empresa invita a su asesoría por correo: una
--     invitación viva por empresa, caduca a los 7 días; reenviar la misma,
--     como mucho 3 veces y una por hora; como mucho 5 invitaciones nuevas por
--     empresa en 30 días;
--   · al aceptar, si ese correo ya es administrador de UNA cuenta de Sumied,
--     se vincula en el acto: la asesoría ve y gestiona los impuestos de la
--     empresa, con el consentimiento de quien la invitó;
--   · si no, queda «esperando el alta»: la aprueba un administrador de
--     plataforma (que da de alta la cuenta por el camino de siempre) y
--     entonces se vincula.
--
--   tax_advisor_invitation                       la invitación (el token, solo su huella)
--   conta_asesoria_invitar(…)       [service_role] la crea o la reenvía (conta-asesoria)
--   conta_asesoria_cancelar(inv)    [la persona]   un administrador de la empresa
--   conta_asesoria_ver(huella)      [service_role] lo que ve la página de aceptar
--   conta_asesoria_cuenta_de(correo)[service_role] la cuenta de la que ese correo es administrador, si es una
--   conta_asesoria_aceptar(…)       [service_role] vincula o deja esperando el alta
--   conta_asesoria_aprobar(…)       [service_role] el alta hecha por la plataforma: vincula
--   conta_asesoria_pendientes()     [la persona]   las que esperan el alta (solo plataforma)
--   conta_asesoria_de_empresa(emp)  [la persona]   la invitación viva de una empresa (Certificados)
--
-- Vuelta atrás: supabase/vuelta-atras/20261122T0230_i01b_asesoria.down.sql

create table if not exists public.tax_advisor_invitation (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  company_id          uuid not null references public.company(id) on delete cascade,
  email               text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  advisor_name        text not null check (btrim(advisor_name) <> ''),
  basis               text not null check (basis in ('social_collaborator', 'power_of_attorney')),
  token_hash          text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status              text not null default 'pending' check (status in ('pending', 'waiting_approval', 'accepted', 'cancelled', 'expired')),
  invited_by          uuid not null,
  invited_by_name     text not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  sends               smallint not null default 1 check (sends between 1 and 3),
  last_sent_at        timestamptz not null default now(),
  accepted_at         timestamptz,
  advisor_account_id  uuid references public.accounts(id),
  approved_by         uuid,
  approved_at         timestamptz,
  cancelled_by        uuid,
  cancelled_at        timestamptz,
  check ((status = 'accepted') = (advisor_account_id is not null)),
  check (status <> 'cancelled' or cancelled_at is not null)
);
comment on table public.tax_advisor_invitation is
  'I01b. La invitación de una empresa a su asesoría: vincula al aceptar si la asesoría ya tiene Sumied; si no, espera el alta de la plataforma. Del token solo se guarda su huella.';
create unique index if not exists tax_advisor_invitation_una_viva on public.tax_advisor_invitation (company_id)
  where status in ('pending', 'waiting_approval');

alter table public.tax_advisor_invitation enable row level security;
drop policy if exists tax_advisor_invitation_select on public.tax_advisor_invitation;
create policy tax_advisor_invitation_select on public.tax_advisor_invitation for select to authenticated
  using (public.current_user_is_admin_of(account_id));
revoke all on table public.tax_advisor_invitation from anon;
revoke insert, update, delete on table public.tax_advisor_invitation from authenticated;

-- Caducar lo vencido de una empresa (lo llaman las demás).
create or replace function public.conta_asesoria_caducar(p_company uuid)
returns void language sql security definer set search_path = public as $$
  update public.tax_advisor_invitation set status = 'expired'
   where company_id = p_company and status = 'pending' and expires_at <= now()
$$;

-- Vincular: quién presenta pasa a ser la asesoría, con el consentimiento de quien invitó.
create or replace function public.conta_asesoria_vincular(i public.tax_advisor_invitation, p_advisor_account uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_advisor_account = i.account_id then
    raise exception 'La asesoría no puede ser la misma cuenta que la empresa.' using errcode = '22023';
  end if;
  insert into public.company_tax_presenter (company_id, account_id, mode, advisor_account_id, advisor_basis, consented_by, consented_by_name, consented_at, since)
  values (i.company_id, i.account_id, 'advisor', p_advisor_account, i.basis, i.invited_by, i.invited_by_name, now(), current_date)
  on conflict (company_id) do update set mode = 'advisor', advisor_account_id = excluded.advisor_account_id, advisor_basis = excluded.advisor_basis,
    consented_by = excluded.consented_by, consented_by_name = excluded.consented_by_name, consented_at = excluded.consented_at,
    revoked_by = null, revoked_at = null, certificate_id = null, since = current_date, updated_at = now();
  update public.tax_advisor_invitation set status = 'accepted', accepted_at = coalesce(accepted_at, now()), advisor_account_id = p_advisor_account
   where id = i.id;
end $$;

create or replace function public.conta_asesoria_invitar(p_user uuid, p_company uuid, p_email text, p_nombre text, p_basis text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.company; i public.tax_advisor_invitation; v_email text := lower(btrim(coalesce(p_email, ''))); v_nombre text;
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_cert_es_admin(p_user, c.account_id) then
    raise exception 'Solo un administrador de la empresa invita a su asesoría.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un correo válido.' using errcode = '22023'; end if;
  if btrim(coalesce(p_nombre, '')) = '' then raise exception 'Falta el nombre de la asesoría.' using errcode = '22023'; end if;
  if p_basis not in ('social_collaborator', 'power_of_attorney') then raise exception 'Di cómo presenta la asesoría: como colaboradora social o con un poder.' using errcode = '22023'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Falta el enlace de la invitación.' using errcode = '22023'; end if;
  if exists (select 1 from public.user_profiles u join auth.users a on a.id = u.user_id
              where u.account_id = c.account_id and u.active and lower(a.email) = v_email) then
    raise exception 'Ese correo es de una persona de tu propia cuenta: invita a la asesoría con el suyo.' using errcode = '22023';
  end if;
  perform public.conta_asesoria_caducar(p_company);
  v_nombre := public.conta_cert_nombre(p_user, c.account_id);
  select * into i from public.tax_advisor_invitation where company_id = p_company and status in ('pending', 'waiting_approval') for update;
  if i.id is not null then
    if i.status = 'waiting_approval' then
      raise exception 'La invitación a % ya está aceptada y espera que Sumied dé de alta su cuenta.', i.email using errcode = '22023';
    end if;
    if i.email <> v_email then
      raise exception 'Ya hay una invitación viva a % hasta el %: cancélala antes de invitar a otra.', i.email,
        to_char(i.expires_at at time zone 'Europe/Madrid', 'DD/MM') using errcode = '22023';
    end if;
    if i.sends >= 3 then raise exception 'Esta invitación ya se ha mandado 3 veces: cancélala y crea otra si hace falta.' using errcode = '22023'; end if;
    if i.last_sent_at > now() - interval '1 hour' then
      raise exception 'Se mandó hace menos de una hora: espera un poco antes de volver a mandarla.' using errcode = '22023';
    end if;
    update public.tax_advisor_invitation set token_hash = p_token_hash, sends = sends + 1, last_sent_at = now(),
           expires_at = now() + interval '7 days', advisor_name = btrim(p_nombre), basis = p_basis
     where id = i.id returning * into i;
    return jsonb_build_object('id', i.id, 'reenvio', true, 'expira', i.expires_at, 'empresa', c.legal_name, 'invita', v_nombre);
  end if;
  if (select count(*) from public.tax_advisor_invitation where company_id = p_company and created_at > now() - interval '30 days') >= 5 then
    raise exception 'Esta empresa ya ha creado 5 invitaciones en 30 días: no se mandan más por ahora.' using errcode = '22023';
  end if;
  insert into public.tax_advisor_invitation (account_id, company_id, email, advisor_name, basis, token_hash, invited_by, invited_by_name, expires_at)
  values (c.account_id, p_company, v_email, btrim(p_nombre), p_basis, p_token_hash, p_user, v_nombre, now() + interval '7 days')
  returning * into i;
  return jsonb_build_object('id', i.id, 'reenvio', false, 'expira', i.expires_at, 'empresa', c.legal_name, 'invita', v_nombre);
end $$;

create or replace function public.conta_asesoria_cancelar(p_invitation uuid)
returns text language plpgsql security definer set search_path = public as $$
declare i public.tax_advisor_invitation;
begin
  select * into i from public.tax_advisor_invitation where id = p_invitation for update;
  if i.id is null then raise exception 'Esa invitación no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(i.account_id) then
    raise exception 'Solo un administrador de la empresa cancela su invitación.' using errcode = '42501';
  end if;
  if i.status not in ('pending', 'waiting_approval') then return 'Esa invitación ya no estaba viva.'; end if;
  update public.tax_advisor_invitation set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now() where id = i.id;
  return format('Cancelada la invitación a %s: su enlace ya no sirve.', i.email);
end $$;

create or replace function public.conta_asesoria_ver(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.tax_advisor_invitation; c public.company;
begin
  select * into i from public.tax_advisor_invitation where token_hash = p_token_hash;
  if i.id is null then return jsonb_build_object('estado', 'no_esta'); end if;
  perform public.conta_asesoria_caducar(i.company_id);
  select * into i from public.tax_advisor_invitation where id = i.id;
  select * into c from public.company where id = i.company_id;
  return jsonb_build_object('estado', i.status, 'empresa', c.legal_name, 'invita', i.invited_by_name,
    'asesoria', i.advisor_name, 'base', i.basis, 'correo', i.email, 'expira', i.expires_at);
end $$;

-- La cuenta de la que ese correo es administrador activo; null si no es de ninguna o es de varias
-- (entonces decide la plataforma al dar el alta).
create or replace function public.conta_asesoria_cuenta_de(p_email text)
returns uuid language sql stable security definer set search_path = public as $$
  select case when count(distinct u.account_id) = 1 then min(u.account_id::text)::uuid end
    from public.user_profiles u join auth.users a on a.id = u.user_id
   where lower(a.email) = lower(btrim(p_email)) and u.active and u.role = 'admin'
$$;

create or replace function public.conta_asesoria_aceptar(p_token_hash text, p_advisor_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.tax_advisor_invitation; c public.company;
begin
  select * into i from public.tax_advisor_invitation where token_hash = p_token_hash for update;
  if i.id is null then raise exception 'Esa invitación no existe: pide a la empresa que te mande otra.' using errcode = 'P0002'; end if;
  select * into c from public.company where id = i.company_id;
  if i.status = 'accepted' then return jsonb_build_object('estado', 'accepted', 'mensaje', 'Ya estaba aceptada: entra con tu usuario.'); end if;
  if i.status = 'waiting_approval' then
    return jsonb_build_object('estado', 'waiting_approval', 'mensaje', 'Ya estaba aceptada: espera el correo para poner tu contraseña.');
  end if;
  if i.status <> 'pending' or i.expires_at <= now() then
    raise exception 'Esta invitación ya no vale (%): pide a % que te mande otra.',
      case when i.status = 'cancelled' then 'la canceló la empresa' else 'caducó' end, c.legal_name using errcode = '22023';
  end if;
  if p_advisor_account is not null then
    perform public.conta_asesoria_vincular(i, p_advisor_account);
    return jsonb_build_object('estado', 'accepted', 'mensaje',
      format('Hecho: ya llevas los impuestos de %s. Entra con tu usuario y la verás en Impuestos.', c.legal_name));
  end if;
  update public.tax_advisor_invitation set status = 'waiting_approval', accepted_at = now() where id = i.id;
  return jsonb_build_object('estado', 'waiting_approval', 'mensaje',
    format('Recibido. Sumied dará de alta tu cuenta y te llegará un correo a %s para poner tu contraseña; entonces verás %s en Impuestos.', i.email, c.legal_name));
end $$;

create or replace function public.conta_asesoria_aprobar(p_invitation uuid, p_platform_user uuid, p_advisor_account uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.tax_advisor_invitation;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_platform_user and active) then
    raise exception 'Solo un administrador de la plataforma da el alta de una asesoría.' using errcode = '42501';
  end if;
  select * into i from public.tax_advisor_invitation where id = p_invitation for update;
  if i.id is null then raise exception 'Esa invitación no está.' using errcode = 'P0002'; end if;
  if i.status <> 'waiting_approval' then raise exception 'Esa invitación no espera el alta (está «%»).', i.status using errcode = '22023'; end if;
  perform public.conta_asesoria_vincular(i, p_advisor_account);
  update public.tax_advisor_invitation set approved_by = p_platform_user, approved_at = now() where id = i.id;
  return jsonb_build_object('ok', true, 'mensaje', format('Vinculada: %s lleva los impuestos de la empresa.', i.advisor_name));
end $$;

create or replace function public.conta_asesoria_pendientes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.platform_admins where user_id = auth.uid() and active) then
    raise exception 'Solo un administrador de la plataforma ve las altas de asesorías.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'asesoria', i.advisor_name, 'correo', i.email, 'base', i.basis,
                                                       'empresa', c.legal_name, 'cuenta_empresa', a.name,
                                                       'invita', i.invited_by_name, 'aceptada', i.accepted_at,
                                                       'ya_es_admin_de', (select count(distinct u.account_id) from public.user_profiles u join auth.users au on au.id = u.user_id
                                                                          where lower(au.email) = i.email and u.active and u.role = 'admin'))
                                    order by i.accepted_at), '[]')
            from public.tax_advisor_invitation i join public.company c on c.id = i.company_id join public.accounts a on a.id = i.account_id
           where i.status = 'waiting_approval');
end $$;

create or replace function public.conta_asesoria_de_empresa(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.tax_advisor_invitation;
begin
  if not public.conta_impuesto_puede_ver(p_company) then raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501'; end if;
  perform public.conta_asesoria_caducar(p_company);
  select * into i from public.tax_advisor_invitation where company_id = p_company and status in ('pending', 'waiting_approval');
  if i.id is null then return null; end if;
  return jsonb_build_object('id', i.id, 'estado', i.status, 'correo', i.email, 'asesoria', i.advisor_name, 'base', i.basis,
    'invita', i.invited_by_name, 'creada', i.created_at, 'expira', i.expires_at, 'envios', i.sends, 'ultimo_envio', i.last_sent_at);
end $$;

revoke all on function public.conta_asesoria_caducar(uuid), public.conta_asesoria_vincular(public.tax_advisor_invitation, uuid),
  public.conta_asesoria_invitar(uuid, uuid, text, text, text, text), public.conta_asesoria_ver(text), public.conta_asesoria_cuenta_de(text),
  public.conta_asesoria_aceptar(text, uuid), public.conta_asesoria_aprobar(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.conta_asesoria_invitar(uuid, uuid, text, text, text, text), public.conta_asesoria_ver(text),
  public.conta_asesoria_cuenta_de(text), public.conta_asesoria_aceptar(text, uuid), public.conta_asesoria_aprobar(uuid, uuid, uuid) to service_role;
revoke all on function public.conta_asesoria_cancelar(uuid), public.conta_asesoria_pendientes(), public.conta_asesoria_de_empresa(uuid) from public, anon;
grant execute on function public.conta_asesoria_cancelar(uuid), public.conta_asesoria_pendientes(), public.conta_asesoria_de_empresa(uuid) to authenticated, service_role;
