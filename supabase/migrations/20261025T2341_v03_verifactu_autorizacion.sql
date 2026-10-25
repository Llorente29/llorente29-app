-- supabase/migrations/20261025T2341_v03_verifactu_autorizacion.sql
--
-- V03 · Verifactu · E1 · EL CERTIFICADO DE LA EMPRESA SIN UNA PERSONA DELANTE,
-- SOLO PARA VERIFACTU (respuesta 2 de Julio, b). AÑADE: una tabla, una columna
-- que admite nulos en verifactu_envio (de la 2140) y cuatro funciones. No toca
-- datos ni nada del I01: presentar impuestos con el certificado sigue pidiendo
-- la confirmación de una persona cada vez (conta_cert_confirmar / conta_cert_abrir).
--
--   · La empresa autoriza UNA VEZ «usar mi certificado solo para enviar
--     Verifactu» (verifactu_autorizar_certificado): quien puede presentar con
--     ese certificado, escribiendo AUTORIZO. Queda quién y cuándo, y no se edita.
--   · Se retira cuando se quiera (verifactu_retirar_autorizacion): queda quién,
--     cuándo y por qué, y la empresa vuelve a la vía de colaborador social.
--   · Cada envío apunta con qué autorización salió (verifactu_envio.autorizacion_id):
--     «qué envíos».
--   · La función de envío abre el certificado con verifactu_cert_abrir: solo con
--     la clave de servicio, solo en real, solo por la vía del certificado, solo
--     con la autorización vigente y el certificado en vigor. Para nada más.
--   · La vía por defecto es la de colaborador social (preparada y apagada): la
--     2140 ya lo dice; aquí se pone también en lo que ya existe (staging).

create table if not exists public.verifactu_autorizacion (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  company_id             uuid not null references public.company(id) on delete cascade,
  certificate_id         uuid not null references public.tax_certificate(id) on delete restrict,
  autorizada_por         uuid not null,
  autorizada_por_nombre  text not null,
  autorizada_at          timestamptz not null default now(),
  retirada_at            timestamptz,
  retirada_por           uuid,
  retirada_por_nombre    text,
  retirada_motivo        text,
  check ((retirada_at is null) = (retirada_por is null)),
  check (retirada_at is null or retirada_at >= autorizada_at)
);
comment on table public.verifactu_autorizacion is
  'V03. La empresa autoriza usar su certificado SOLO para enviar Verifactu, sin una persona delante en cada envío: quién, cuándo, con qué certificado; retirable (quién, cuándo, por qué). No se edita: solo se retira. Cada envío apunta la suya (verifactu_envio.autorizacion_id). Presentar impuestos sigue pidiendo confirmación cada vez.';
create unique index if not exists verifactu_autorizacion_una_vigente on public.verifactu_autorizacion (company_id) where retirada_at is null;
create index if not exists verifactu_autorizacion_cuenta on public.verifactu_autorizacion (account_id, company_id);

alter table public.verifactu_autorizacion enable row level security;
drop policy if exists verifactu_autorizacion_leer on public.verifactu_autorizacion;
create policy verifactu_autorizacion_leer on public.verifactu_autorizacion for select using (public.belongs_to_account(account_id));
revoke insert, update, delete on public.verifactu_autorizacion from anon, authenticated;

-- No se edita: lo único que cambia, y una sola vez, es la retirada.
create or replace function public._verifactu_autorizacion_inalterable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Una autorización de Verifactu no se borra: se retira.' using errcode = '42501'; end if;
  if old.retirada_at is not null
     or (new.id, new.account_id, new.company_id, new.certificate_id, new.autorizada_por, new.autorizada_por_nombre, new.autorizada_at)
        is distinct from (old.id, old.account_id, old.company_id, old.certificate_id, old.autorizada_por, old.autorizada_por_nombre, old.autorizada_at) then
    raise exception 'Una autorización de Verifactu no se edita: solo se retira, una vez.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists verifactu_autorizacion_inalterable on public.verifactu_autorizacion;
create trigger verifactu_autorizacion_inalterable before update or delete on public.verifactu_autorizacion
  for each row execute function public._verifactu_autorizacion_inalterable();

alter table public.verifactu_envio add column if not exists autorizacion_id uuid references public.verifactu_autorizacion(id) on delete restrict;
comment on column public.verifactu_envio.autorizacion_id is
  'V03. Con qué autorización del certificado salió este envío (en real, por la vía del certificado). Nulo en pruebas y por la vía de colaborador social.';

alter table public.verifactu_empresa alter column via set default 'colaborador';

-- ── Autorizar ───────────────────────────────────────────────────────────────
create or replace function public.verifactu_autorizar_certificado(p_company uuid, p_certificate uuid, p_confirmacion text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_co public.company; c public.tax_certificate; v_nif text; v_ant public.verifactu_autorizacion; v_id uuid;
  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
begin
  if auth.uid() is null then raise exception 'Tienes que entrar con tu usuario.' using errcode = '42501'; end if;
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_co.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta autoriza el certificado.' using errcode = '42501';
  end if;
  if p_confirmacion is distinct from 'AUTORIZO' then
    raise exception 'Para autorizar, escribe AUTORIZO: el certificado se usará, sin preguntarte cada vez, solo para enviar a Hacienda los registros de Verifactu.' using errcode = '23514';
  end if;
  select * into c from public.tax_certificate where id = p_certificate and owner_account_id = v_co.account_id;
  if c.id is null then raise exception 'Ese certificado no está en esta cuenta.' using errcode = 'P0002'; end if;
  if c.status <> 'active' then raise exception 'Ese certificado no está en uso (%): sube uno en vigor.', c.status using errcode = '22023'; end if;
  if c.valid_to <= now() then raise exception 'Ese certificado caducó el %: sube uno nuevo.', to_char(c.valid_to at time zone 'Europe/Madrid', 'DD/MM/YYYY') using errcode = '22023'; end if;
  if not public.conta_cert_puede_usar(auth.uid(), c.id) then
    raise exception 'No tienes permiso para presentar con este certificado: lo autoriza quien puede presentar con él.' using errcode = '42501';
  end if;
  v_nif := regexp_replace(upper(coalesce(v_co.tax_id, '')), '^ES', '');
  if c.subject_tax_id_hash is distinct from encode(sha256(convert_to(v_nif, 'UTF8')), 'hex') then
    raise exception 'Ese certificado es de otro NIF (acaba en %), no del de %.', c.subject_tax_id_tail, coalesce(v_co.trade_name, v_co.legal_name) using errcode = '23514';
  end if;
  -- Una vigente por empresa: la de antes (otro certificado, o la misma renovada) se retira.
  select * into v_ant from public.verifactu_autorizacion where company_id = p_company and retirada_at is null for update;
  if v_ant.id is not null then
    update public.verifactu_autorizacion set retirada_at = now(), retirada_por = auth.uid(), retirada_por_nombre = v_quien,
           retirada_motivo = 'Sustituida por una autorización nueva.'
     where id = v_ant.id;
  end if;
  insert into public.verifactu_autorizacion (account_id, company_id, certificate_id, autorizada_por, autorizada_por_nombre)
  values (v_co.account_id, p_company, c.id, auth.uid(), v_quien) returning id into v_id;
  insert into public.verifactu_empresa (company_id, account_id, via, certificate_id, updated_by_name)
  values (p_company, v_co.account_id, 'certificado', c.id, v_quien)
  on conflict (company_id) do update set via = 'certificado', certificate_id = c.id, updated_at = now(), updated_by_name = v_quien;
  return jsonb_build_object('id', v_id, 'certificado_acaba_en', c.subject_tax_id_tail, 'caduca', c.valid_to, 'sustituye', v_ant.id);
end $$;
revoke all on function public.verifactu_autorizar_certificado(uuid, uuid, text, text) from public, anon;
grant execute on function public.verifactu_autorizar_certificado(uuid, uuid, text, text) to authenticated;
comment on function public.verifactu_autorizar_certificado(uuid, uuid, text, text) is
  'V03. La empresa autoriza, una vez y escribiendo AUTORIZO, usar su certificado solo para enviar Verifactu. Lo hace quien puede presentar con ese certificado; tiene que ser del NIF de la empresa. Sustituye a la vigente, si la hay, y pone la vía del certificado.';

-- ── Retirar ─────────────────────────────────────────────────────────────────
create or replace function public.verifactu_retirar_autorizacion(p_company uuid, p_motivo text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co public.company; v_a public.verifactu_autorizacion; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
begin
  if auth.uid() is null then raise exception 'Tienes que entrar con tu usuario.' using errcode = '42501'; end if;
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_co.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta retira la autorización.' using errcode = '42501';
  end if;
  select * into v_a from public.verifactu_autorizacion where company_id = p_company and retirada_at is null for update;
  if v_a.id is null then return jsonb_build_object('retirada', false, 'mensaje', 'No había ninguna autorización vigente.'); end if;
  update public.verifactu_autorizacion set retirada_at = now(), retirada_por = auth.uid(), retirada_por_nombre = v_quien,
         retirada_motivo = nullif(btrim(coalesce(p_motivo, '')), '')
   where id = v_a.id;
  update public.verifactu_empresa set via = 'colaborador', certificate_id = null, updated_at = now(), updated_by_name = v_quien where company_id = p_company;
  return jsonb_build_object('retirada', true, 'id', v_a.id);
end $$;
revoke all on function public.verifactu_retirar_autorizacion(uuid, text, text) from public, anon;
grant execute on function public.verifactu_retirar_autorizacion(uuid, text, text) to authenticated;
comment on function public.verifactu_retirar_autorizacion(uuid, text, text) is
  'V03. Retira la autorización vigente del certificado para Verifactu (quién, cuándo, por qué). La empresa vuelve a la vía de colaborador social; lo que quede en la cola espera.';

-- ── Abrir, solo para un envío de Verifactu ──────────────────────────────────
-- Solo la clave de servicio (conta-verifactu). Devuelve el material o por qué
-- no; y deja apuntada la autorización en el envío.
create or replace function public.verifactu_cert_abrir(p_envio uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.verifactu_envio; v_emp public.verifactu_empresa; v_a public.verifactu_autorizacion; c public.tax_certificate; v_material text; v_motivo text;
begin
  select * into v_e from public.verifactu_envio where id = p_envio for update;
  if v_e.id is null then return jsonb_build_object('ok', false, 'mensaje', 'Ese envío no está.'); end if;
  select * into v_emp from public.verifactu_empresa where company_id = v_e.company_id;
  select * into v_a from public.verifactu_autorizacion where company_id = v_e.company_id and retirada_at is null;
  select * into c from public.tax_certificate where id = v_a.certificate_id;
  v_motivo := case
    when v_e.entorno <> 'real' then 'Solo se abre el certificado de la empresa para enviar en real.'
    when v_emp.via is distinct from 'certificado' then 'La empresa envía por la vía de colaborador social, que todavía no está abierta.'
    when v_a.id is null then 'La empresa no ha autorizado usar su certificado para Verifactu (o lo ha retirado).'
    when c.id is null or c.status = 'removed' then 'El certificado autorizado se ha quitado: autoriza uno nuevo.'
    when c.valid_to <= now() then 'El certificado autorizado ha caducado: sube uno nuevo y autorízalo.'
    when c.storage <> 'vault' then 'El certificado está en el almacén con clave externa (KMS), que todavía no está preparado.'
    else null end;
  if v_motivo is not null then return jsonb_build_object('ok', false, 'mensaje', v_motivo); end if;
  select decrypted_secret into v_material from vault.decrypted_secrets where id = c.vault_secret_id;
  if v_material is null then return jsonb_build_object('ok', false, 'mensaje', 'El certificado no está en el almacén: vuelve a subirlo.'); end if;
  update public.verifactu_envio set autorizacion_id = v_a.id where id = p_envio;
  return jsonb_build_object('ok', true, 'material', v_material, 'autorizacion_id', v_a.id);
end $$;
revoke all on function public.verifactu_cert_abrir(uuid) from public, anon, authenticated;
comment on function public.verifactu_cert_abrir(uuid) is
  'V03. Solo la clave de servicio (conta-verifactu): abre el certificado de la empresa para UN envío de Verifactu en real, si la empresa lo ha autorizado y sigue en vigor, y apunta la autorización en el envío. Para nada más.';
