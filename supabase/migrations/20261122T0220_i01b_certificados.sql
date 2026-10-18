-- supabase/migrations/20261122T0220_i01b_certificados.sql
--
-- I01b · P4 · CERTIFICADOS Y ACCESOS (tablero 10). Solo añade funciones.
--
--   conta_impuesto_certificados_ver(empresa)                     [la persona]
--     Lo que pinta el tablero: quién presenta (la empresa con su certificado,
--     o su asesoría y desde cuándo); los certificados de la cuenta (la ficha:
--     titular, tipo, caducidad, la última prueba con Hacienda; quién puede
--     presentar y quién solo ver); cada uso, con quién, qué y cómo acabó (y el
--     justificante si fue una presentación); el texto de custodia de su
--     almacén; las personas de la cuenta (para los permisos); y si quien mira
--     puede subir uno y, si no, por qué (el mismo motivo con que se para la
--     subida). Nada del certificado sale de aquí: ni el material, ni el NIF
--     entero, ni la huella.
--   conta_impuesto_certificado_presenta(empresa, certificado)    [la persona]
--     «La propia empresa, con su certificado»: la empresa presenta con ese
--     certificado de su cuenta (vivo y sin caducar). Solo un administrador.
--
-- Vuelta atrás: supabase/vuelta-atras/20261122T0220_i01b_certificados.down.sql

create or replace function public.conta_impuesto_certificados_ver(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.company; pr public.company_tax_presenter; v_admin boolean; v_no text;
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_ver(p_company) then
    raise exception 'No puedes ver los impuestos de esta empresa.' using errcode = '42501';
  end if;
  select * into pr from public.company_tax_presenter where company_id = p_company;
  v_admin := public.current_user_is_admin_of(c.account_id);
  -- Por qué no puede subir uno: lo mismo, y en el mismo orden, que conta_cert_guardar.
  v_no := case
    when not v_admin then 'Solo un administrador de la cuenta puede subir un certificado.'
    when c.account_id <> public.conta_cert_cuenta_vault() then
      'Todavía no se pueden guardar certificados en esta cuenta: falta el almacén con clave externa (KMS), y hasta que esté solo se admite la cuenta de Foodint. No se ha guardado nada.'
  end;
  return jsonb_build_object(
    'cuenta', c.account_id,
    'es_admin', v_admin,
    'puede_subir', v_no is null,
    'por_que_no_subir', v_no,
    'presentador', jsonb_build_object(
      'modo', coalesce(pr.mode, 'company'),
      'certificado', pr.certificate_id,
      'asesoria', (select a.name from public.accounts a where a.id = pr.advisor_account_id),
      'base', pr.advisor_basis,
      'consentida_por', pr.consented_by_name, 'consentida_el', pr.consented_at,
      'retirada_el', pr.revoked_at, 'desde', pr.since),
    'certificados', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'titular', t.subject_name, 'nif_cola', t.subject_tax_id_tail, 'tipo', t.kind, 'emisor', t.issuer,
               'desde', t.valid_from, 'caduca', t.valid_to, 'estado', t.status, 'almacen', t.storage,
               'custodia', public.conta_cert_custodia(t.storage),
               'subido', t.uploaded_at, 'subido_por', t.uploaded_by_name,
               'quitado', t.removed_at, 'quitado_por', t.removed_by_name,
               'probado', t.last_test_at, 'prueba', t.last_test_result, 'prueba_mensaje', t.last_test_message,
               'presenta', t.id = pr.certificate_id and coalesce(pr.mode, 'company') = 'company',
               'permisos', (select coalesce(jsonb_agg(jsonb_build_object('persona', g.user_id, 'nombre', public.conta_cert_nombre(g.user_id, t.owner_account_id),
                                                                        'permiso', g.permission) order by g.permission, g.granted_at), '[]')
                              from public.tax_certificate_grant g where g.certificate_id = t.id and g.revoked_at is null))
             order by (t.status = 'active') desc, t.uploaded_at desc), '[]')
        from public.tax_certificate t
       where t.owner_account_id = c.account_id and (t.status <> 'removed' or t.removed_at > now() - interval '90 days')),
    'usos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'cuando', u.at, 'quien', u.user_name, 'accion', u.action, 'resultado', u.result, 'mensaje', u.message,
               'declaracion', case when r.id is null then null else jsonb_build_object(
                 'id', r.id, 'modelo', r.form_code, 'ejercicio', r.fiscal_year, 'periodo', r.period, 'justificante_pdf', r.receipt_document_path) end)
             order by u.at desc), '[]')
        from (select * from public.tax_certificate_use u0
               where u0.owner_account_id = c.account_id
                 and exists (select 1 from public.tax_certificate t0 where t0.id = u0.certificate_id and t0.owner_account_id = c.account_id)
               order by u0.at desc limit 50) u
        left join public.tax_return r on r.id = u.tax_return_id and r.company_id = p_company),
    'personas', case when not v_admin then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.user_id, 'nombre', coalesce(nullif(trim(p.display_name), ''), 'Sin nombre'), 'papel', p.role)
                                order by p.display_name), '[]')
        from public.user_profiles p where p.account_id = c.account_id and p.active) end);
end $$;

comment on function public.conta_impuesto_certificados_ver(uuid) is
  'I01b. Lo que pinta Certificados y accesos: quién presenta, los certificados (solo la ficha), permisos, usos, custodia y si se puede subir uno. Nada del material.';

create or replace function public.conta_impuesto_certificado_presenta(p_company uuid, p_certificate uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.company; t public.tax_certificate;
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(c.account_id) then
    raise exception 'Solo un administrador de la empresa decide quién presenta sus impuestos.' using errcode = '42501';
  end if;
  select * into t from public.tax_certificate where id = p_certificate and owner_account_id = c.account_id;
  if t.id is null then raise exception 'Ese certificado no es de esta cuenta.' using errcode = '42501'; end if;
  if t.status <> 'active' or t.valid_to <= now() then
    raise exception 'Ese certificado no se puede usar: está %.', case when t.status = 'removed' then 'quitado' else 'caducado' end using errcode = '22023';
  end if;
  insert into public.company_tax_presenter (company_id, account_id, mode, certificate_id, since)
  values (p_company, c.account_id, 'company', t.id, current_date)
  on conflict (company_id) do update set mode = 'company', certificate_id = t.id, advisor_account_id = null, advisor_basis = null,
    consented_by = null, consented_by_name = null, consented_at = null, revoked_by = null, revoked_at = null, since = current_date, updated_at = now();
  return jsonb_build_object('ok', true, 'mensaje', format('Presenta la propia empresa, con el certificado de %s (válido hasta el %s).',
                            t.subject_name, to_char(t.valid_to at time zone 'Europe/Madrid', 'DD/MM/YYYY')));
end $$;

revoke all on function public.conta_impuesto_certificados_ver(uuid), public.conta_impuesto_certificado_presenta(uuid, uuid) from public, anon;
grant execute on function public.conta_impuesto_certificados_ver(uuid), public.conta_impuesto_certificado_presenta(uuid, uuid) to authenticated, service_role;
