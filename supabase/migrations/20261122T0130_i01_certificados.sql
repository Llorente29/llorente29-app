-- supabase/migrations/20261122T0130_i01_certificados.sql
--
-- I01a · 4 · EL ALMACÉN DE CERTIFICADOS, CON EL VAULT (informe I01 paso 1, §2).
-- Solo añade: una tabla (el token de un solo uso) y funciones. Las tablas del
-- certificado (tax_certificate, _grant, _use) son de la 0110.
--
--   conta_cert_guardar(persona, cuenta, ficha, material)   [solo service_role]
--     Lo llama la función conta-certificado después de abrir y validar el
--     .p12. Solo un administrador de la cuenta. Con el Vault, SOLO la cuenta de
--     Foodint (decisión del 17/10: el KMS es obligatorio antes de cualquier
--     otro cliente, y lo impide el código: esta función). El material (cert y
--     clave en PEM) va al Vault; en la tabla, solo la ficha y el id del secreto.
--   conta_cert_confirmar(certificado, acción, declaración, empresa)  [la persona]
--     «Presentar» (o probar, consultar, bajar el PDF) y confirmar: emite un
--     token de un solo uso, válido 5 minutos, si la persona puede presentar
--     con ese certificado.
--   conta_cert_abrir(token, persona)                       [solo service_role]
--     Comprueba token, persona, permiso y vigencia; gasta el token; apunta el
--     uso (como «sin terminar» hasta que se cierre) y devuelve el material.
--     Lo que no vale también queda apuntado («denied»), con su porqué.
--   conta_cert_uso_terminar(uso, resultado, mensaje, ref)  [solo service_role]
--   conta_cert_quitar(certificado)                         [la persona]
--     «Quitar ahora»: borra el secreto del Vault y deja la ficha «retirada»
--     con quién y cuándo. El registro de usos se queda.
--   conta_cert_permiso(certificado, persona, permiso)      [la persona]
--     «Puede presentar» (file) o «solo ver» (view); null lo retira.
--   conta_cert_custodia(almacén)
--     El texto de custodia del tablero 8 según el almacén: con el Vault NO
--     dice «nadie puede verlo, tampoco en Sumied» (§2.2: quien tenga SQL de
--     servicio lo puede leer).
--
-- La contraseña y el .p12 no llegan nunca a la base. Ninguna función escribe
-- el material en un mensaje, un aviso ni el registro.

-- ── El token de un solo uso ─────────────────────────────────────────────────
create table if not exists public.tax_certificate_confirmation (
  id                uuid primary key default gen_random_uuid(),
  certificate_id    uuid not null references public.tax_certificate(id) on delete cascade,
  owner_account_id  uuid not null references public.accounts(id) on delete cascade,
  user_id           uuid not null,
  action            text not null check (action in ('test', 'file', 'query', 'receipt_pdf')),
  tax_return_id     uuid references public.tax_return(id) on delete cascade,
  company_id        uuid references public.company(id) on delete cascade,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  used_at           timestamptz,
  check (expires_at > created_at)
);
comment on table public.tax_certificate_confirmation is
  'I01a. El token de un solo uso de cada uso del certificado: lo emite conta_cert_confirmar al confirmar la persona, lo gasta conta_cert_abrir. 5 minutos.';
alter table public.tax_certificate_confirmation enable row level security;
drop policy if exists tax_certificate_confirmation_select on public.tax_certificate_confirmation;
create policy tax_certificate_confirmation_select on public.tax_certificate_confirmation for select to authenticated using (user_id = auth.uid());
revoke all on public.tax_certificate_confirmation from anon, authenticated;
grant select on public.tax_certificate_confirmation to authenticated;

-- ── Lo fijo ─────────────────────────────────────────────────────────────────
-- La única cuenta que admite el Vault. Por id, no por nombre (regla 9).
create or replace function public.conta_cert_cuenta_vault()
returns uuid language sql immutable as $$ select '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid $$;

create or replace function public.conta_cert_custodia(p_storage text)
returns text language sql immutable as $$
  select case p_storage
    when 'kms' then 'Queda cifrado con una clave que solo puede usar el servidor que presenta. Nadie puede verlo ni descargarlo, tampoco en Sumied. Cada uso queda apuntado.'
    else 'Queda cifrado y solo lo usa el servidor de Sumied para presentar, cuando una persona con permiso lo confirma. Nadie puede descargarlo desde la aplicación, y cada uso queda apuntado.'
  end
$$;
comment on function public.conta_cert_custodia(text) is
  'I01a. El texto de custodia según el almacén. Con el Vault no dice «nadie puede verlo, tampoco en Sumied»: quien tenga SQL de servicio podría leerlo (informe §2.2).';

-- Administrador activo de una cuenta, para una persona dada (las funciones de
-- servicio no tienen auth.uid()).
create or replace function public.conta_cert_es_admin(p_user uuid, p_account uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_profiles
                  where user_id = p_user and account_id = p_account and role = 'admin' and active)
$$;

-- Puede usar el certificado: un administrador de la cuenta dueña, o quien tenga «puede presentar».
create or replace function public.conta_cert_puede_usar(p_user uuid, p_certificate uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tax_certificate c
                  where c.id = p_certificate
                    and (public.conta_cert_es_admin(p_user, c.owner_account_id)
                         or exists (select 1 from public.tax_certificate_grant g
                                     where g.certificate_id = c.id and g.user_id = p_user and g.permission = 'file' and g.revoked_at is null)))
$$;

-- El nombre de la persona en la cuenta dueña del certificado (una persona puede estar en varias).
create or replace function public.conta_cert_nombre(p_user uuid, p_account uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(display_name), '') from public.user_profiles
                    where user_id = p_user order by (account_id = p_account) desc, active desc limit 1), 'Sumied')
$$;

-- ── Guardar ─────────────────────────────────────────────────────────────────
create or replace function public.conta_cert_guardar(p_user uuid, p_account uuid, p_ficha jsonb, p_material text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := gen_random_uuid(); v_secreto uuid; v_hasta timestamptz; v_desde timestamptz; v_huella text; v_nombre text;
begin
  if p_user is null or p_account is null then raise exception 'Falta quién lo sube o la cuenta.' using errcode = '22023'; end if;
  if not public.conta_cert_es_admin(p_user, p_account) then
    raise exception 'Solo un administrador de la cuenta puede subir un certificado.' using errcode = '42501';
  end if;
  -- Con el Vault, solo Foodint. El KMS no está: no hay otro almacén donde guardarlo.
  if p_account <> public.conta_cert_cuenta_vault() then
    raise exception 'Todavía no se pueden guardar certificados en esta cuenta: falta el almacén con clave externa (KMS), y hasta que esté solo se admite la cuenta de Foodint. No se ha guardado nada.'
      using errcode = '42501';
  end if;
  if p_material is null or length(p_material) < 100 or p_material !~ 'BEGIN CERTIFICATE' or p_material !~ 'PRIVATE KEY' then
    raise exception 'Falta el certificado o su clave.' using errcode = '22023';
  end if;
  v_desde := (p_ficha->>'valid_from')::timestamptz;
  v_hasta := (p_ficha->>'valid_to')::timestamptz;
  v_huella := lower(p_ficha->>'fingerprint_sha256');
  if v_hasta is null or v_hasta <= now() then
    raise exception 'El certificado caducó el %. No se guarda.', to_char(v_hasta at time zone 'Europe/Madrid', 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if exists (select 1 from public.tax_certificate where fingerprint_sha256 = v_huella and status <> 'removed') then
    raise exception 'Ese certificado ya está guardado.' using errcode = '23505';
  end if;
  v_nombre := public.conta_cert_nombre(p_user, p_account);
  v_secreto := vault.create_secret(p_material, 'tax_certificate:' || v_id::text, 'I01a · certificado de Hacienda (cert y clave en PEM)');
  insert into public.tax_certificate (id, owner_account_id, subject_name, subject_tax_id_hash, subject_tax_id_tail, issuer, serial,
                                      valid_from, valid_to, fingerprint_sha256, kind, storage, vault_secret_id, uploaded_by, uploaded_by_name)
  values (v_id, p_account, p_ficha->>'subject_name', lower(p_ficha->>'subject_tax_id_hash'), upper(p_ficha->>'subject_tax_id_tail'),
          p_ficha->>'issuer', p_ficha->>'serial', v_desde, v_hasta, v_huella, p_ficha->>'kind', 'vault', v_secreto, p_user, v_nombre);
  insert into public.tax_certificate_grant (certificate_id, user_id, permission, granted_by) values (v_id, p_user, 'file', p_user);
  insert into public.tax_certificate_use (certificate_id, owner_account_id, user_id, user_name, action, result, message)
  values (v_id, p_account, p_user, v_nombre, 'upload', 'ok', 'Subido y comprobado: la clave corresponde al certificado y está en vigor.');
  return jsonb_build_object('id', v_id, 'custodia', public.conta_cert_custodia('vault'));
end $$;
comment on function public.conta_cert_guardar(uuid, uuid, jsonb, text) is
  'I01a. Guarda un certificado ya validado (conta-certificado). Solo un administrador de la cuenta; con el Vault, solo la cuenta de Foodint. Solo service_role.';

-- ── El token de un solo uso ─────────────────────────────────────────────────
create or replace function public.conta_cert_confirmar(p_certificate uuid, p_action text, p_tax_return uuid default null, p_company uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.tax_certificate; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Tienes que entrar con tu usuario.' using errcode = '42501'; end if;
  select * into c from public.tax_certificate where id = p_certificate;
  if c.id is null then raise exception 'Ese certificado no está.' using errcode = 'P0002'; end if;
  if p_action not in ('test', 'file', 'query', 'receipt_pdf') then raise exception 'Ese uso no existe.' using errcode = '22023'; end if;
  if c.status = 'removed' then raise exception 'Ese certificado se quitó el %: ya no se puede usar.', to_char(c.removed_at at time zone 'Europe/Madrid', 'DD/MM/YYYY') using errcode = '22023'; end if;
  if c.valid_to <= now() then raise exception 'Ese certificado caducó el %: sube uno nuevo.', to_char(c.valid_to at time zone 'Europe/Madrid', 'DD/MM/YYYY') using errcode = '22023'; end if;
  if not public.conta_cert_puede_usar(auth.uid(), c.id) then
    raise exception 'No tienes permiso para presentar con este certificado.' using errcode = '42501';
  end if;
  insert into public.tax_certificate_confirmation (certificate_id, owner_account_id, user_id, action, tax_return_id, company_id, expires_at)
  values (c.id, c.owner_account_id, auth.uid(), p_action, p_tax_return, p_company, now() + interval '5 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- ── Abrir para usar ─────────────────────────────────────────────────────────
-- No lanza error al no dejar: devuelve {ok:false, mensaje} para que el «denied»
-- quede apuntado (una excepción desharía el apunte).
create or replace function public.conta_cert_abrir(p_confirmation uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tax_certificate_confirmation; c public.tax_certificate; v_motivo text; v_uso uuid; v_material text;
begin
  select * into t from public.tax_certificate_confirmation where id = p_confirmation for update;
  if t.id is null then return jsonb_build_object('ok', false, 'mensaje', 'Esa confirmación no existe. Vuelve a pulsar y confirmar.'); end if;
  select * into c from public.tax_certificate where id = t.certificate_id;
  v_motivo := case
    when t.user_id is distinct from p_user then 'Esa confirmación es de otra persona.'
    when t.used_at is not null then 'Esa confirmación ya se usó. Vuelve a pulsar y confirmar.'
    when t.expires_at <= now() then 'Esa confirmación ha caducado (dura 5 minutos). Vuelve a pulsar y confirmar.'
    when c.status = 'removed' then 'Ese certificado se ha quitado: ya no se puede usar.'
    when c.valid_to <= now() then 'Ese certificado ha caducado: sube uno nuevo.'
    when not public.conta_cert_puede_usar(p_user, c.id) then 'Ya no tienes permiso para presentar con este certificado.'
    when c.storage <> 'vault' then 'Ese certificado está en el almacén con clave externa (KMS), que todavía no está preparado.'
    else null end;
  if v_motivo is not null then
    if c.valid_to <= now() and c.status = 'active' then update public.tax_certificate set status = 'expired' where id = c.id; end if;
    insert into public.tax_certificate_use (certificate_id, owner_account_id, tax_return_id, company_id, user_id, user_name, action, result, message)
    values (c.id, c.owner_account_id, t.tax_return_id, t.company_id, p_user, public.conta_cert_nombre(p_user, c.owner_account_id), t.action, 'denied', v_motivo);
    return jsonb_build_object('ok', false, 'mensaje', v_motivo);
  end if;
  update public.tax_certificate_confirmation set used_at = now() where id = t.id;
  -- Sin terminar hasta que quien lo usa diga cómo fue: si la llamada se cae, queda así.
  insert into public.tax_certificate_use (certificate_id, owner_account_id, tax_return_id, company_id, user_id, user_name, action, confirmation_id, result, message)
  values (c.id, c.owner_account_id, t.tax_return_id, t.company_id, p_user, public.conta_cert_nombre(p_user, c.owner_account_id), t.action, t.id, 'error',
          'Sin terminar: la llamada a Hacienda no ha dicho cómo acabó.')
  returning id into v_uso;
  select decrypted_secret into v_material from vault.decrypted_secrets where id = c.vault_secret_id;
  if v_material is null then
    update public.tax_certificate_use set message = 'El certificado no está en el almacén.' where id = v_uso;
    return jsonb_build_object('ok', false, 'mensaje', 'El certificado no está en el almacén: vuelve a subirlo.');
  end if;
  return jsonb_build_object('ok', true, 'material', v_material, 'uso_id', v_uso, 'certificate_id', c.id);
end $$;

create or replace function public.conta_cert_uso_terminar(p_use uuid, p_result text, p_message text, p_aeat_ref_masked text default null)
returns void language plpgsql security definer set search_path = public as $$
declare u public.tax_certificate_use;
begin
  if p_result not in ('ok', 'error') then raise exception 'Resultado no válido.' using errcode = '22023'; end if;
  if p_message is null or btrim(p_message) = '' then raise exception 'Falta cómo acabó, en palabras.' using errcode = '22023'; end if;
  update public.tax_certificate_use set result = p_result, message = btrim(p_message), aeat_ref_masked = p_aeat_ref_masked
   where id = p_use and message = 'Sin terminar: la llamada a Hacienda no ha dicho cómo acabó.'
  returning * into u;
  if u.id is null then raise exception 'Ese uso no existe o ya está cerrado.' using errcode = 'P0002'; end if;
  if u.action = 'test' then
    update public.tax_certificate set last_test_at = now(), last_test_result = p_result, last_test_message = btrim(p_message) where id = u.certificate_id;
  end if;
end $$;

-- ── Quitar ahora ────────────────────────────────────────────────────────────
create or replace function public.conta_cert_quitar(p_certificate uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c public.tax_certificate; v_nombre text;
begin
  select * into c from public.tax_certificate where id = p_certificate for update;
  if c.id is null then raise exception 'Ese certificado no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(c.owner_account_id) then
    raise exception 'Solo un administrador de la cuenta puede quitar un certificado.' using errcode = '42501';
  end if;
  if c.status = 'removed' then return 'Ya estaba quitado.'; end if;
  v_nombre := public.conta_cert_nombre(auth.uid(), c.owner_account_id);
  if c.vault_secret_id is not null then delete from vault.secrets where id = c.vault_secret_id; end if;
  update public.tax_certificate set status = 'removed', vault_secret_id = null, ciphertext = null, wrapped_key = null, kms_key_ref = null,
         removed_at = now(), removed_by = auth.uid(), removed_by_name = v_nombre
   where id = c.id;
  update public.tax_certificate_confirmation set used_at = now() where certificate_id = c.id and used_at is null;
  update public.tax_certificate_grant set revoked_at = now() where certificate_id = c.id and revoked_at is null;
  insert into public.tax_certificate_use (certificate_id, owner_account_id, user_id, user_name, action, result, message)
  values (c.id, c.owner_account_id, auth.uid(), v_nombre, 'remove', 'ok', 'Quitado: borrado del almacén. Nadie puede usarlo desde ahora.');
  return 'Quitado. Se ha borrado del almacén y nadie puede usarlo desde ahora; el registro de usos se queda.';
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────────
create or replace function public.conta_cert_permiso(p_certificate uuid, p_user uuid, p_permission text)
returns text language plpgsql security definer set search_path = public as $$
declare c public.tax_certificate;
begin
  select * into c from public.tax_certificate where id = p_certificate;
  if c.id is null then raise exception 'Ese certificado no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(c.owner_account_id) then
    raise exception 'Solo un administrador de la cuenta puede dar o quitar permisos sobre un certificado.' using errcode = '42501';
  end if;
  if p_permission is not null and p_permission not in ('file', 'view') then raise exception 'Ese permiso no existe.' using errcode = '22023'; end if;
  if p_permission is not null and not exists (select 1 from public.user_profiles where user_id = p_user and account_id = c.owner_account_id and active) then
    raise exception 'Esa persona no es de esta cuenta.' using errcode = '22023';
  end if;
  update public.tax_certificate_grant set revoked_at = now() where certificate_id = c.id and user_id = p_user and revoked_at is null;
  if p_permission is null then return 'Permiso retirado.'; end if;
  insert into public.tax_certificate_grant (certificate_id, user_id, permission, granted_by) values (c.id, p_user, p_permission, auth.uid());
  return case p_permission when 'file' then 'Ahora puede presentar con este certificado.' else 'Ahora puede verlo, pero no presentar.' end;
end $$;

-- ── Quién llama a qué ───────────────────────────────────────────────────────
-- Supabase da execute a authenticated en toda función nueva: se quita a mano.
revoke all on function public.conta_cert_guardar(uuid, uuid, jsonb, text), public.conta_cert_abrir(uuid, uuid),
  public.conta_cert_uso_terminar(uuid, text, text, text), public.conta_cert_es_admin(uuid, uuid),
  public.conta_cert_puede_usar(uuid, uuid), public.conta_cert_nombre(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.conta_cert_guardar(uuid, uuid, jsonb, text), public.conta_cert_abrir(uuid, uuid),
  public.conta_cert_uso_terminar(uuid, text, text, text) to service_role;
revoke all on function public.conta_cert_confirmar(uuid, text, uuid, uuid), public.conta_cert_quitar(uuid),
  public.conta_cert_permiso(uuid, uuid, text) from public, anon;
grant execute on function public.conta_cert_confirmar(uuid, text, uuid, uuid), public.conta_cert_quitar(uuid),
  public.conta_cert_permiso(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.conta_cert_custodia(text), public.conta_cert_cuenta_vault() to authenticated, service_role;
