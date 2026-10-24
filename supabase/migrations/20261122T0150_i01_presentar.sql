-- supabase/migrations/20261122T0150_i01_presentar.sql
--
-- I01a · 6 · PRESENTAR, COMPROBAR CON HACIENDA Y «YA LO PRESENTÉ FUERA».
-- Solo añade funciones. Las llama la función conta-hacienda (con la clave de
-- servicio y la persona sacada de su sesión) y, las que dicen «la persona», el
-- front del I01b.
--
--   conta_impuesto_gestiona(persona, empresa)                    [solo service_role]
--     Lo mismo que conta_impuesto_puede_gestionar, para una persona dada:
--     administrador o encargado de la empresa, o de su asesoría con
--     consentimiento vivo.
--   conta_impuesto_revisar(declaración)                          [la persona]
--     «Revisado»: sin ninguna comprobación en error. Es el paso antes de
--     presentar: el programa enseña los datos y la persona da su conformidad
--     (Especificaciones v3.0: «el propio envío supone la aceptación»).
--   conta_impuesto_aviso_aceptar(comprobación, motivo)           [la persona]
--     Dar por bueno un aviso, con motivo («Julio la dio por buena el 09/10»).
--   conta_impuesto_303_preparar(declaración, persona, token)     [solo service_role]
--     Antes de abrir el certificado: que el token es de esa persona, para
--     PRESENTAR ESA declaración y está vivo; que está «Revisado» y sin errores.
--     Devuelve lo que necesita el fichero (conta_impuesto_303_fichero).
--   conta_impuesto_presentada(…)                                 [solo service_role]
--     Hacienda ha dado CSV: la declaración pasa a «Presentado», con su CSV, su
--     justificante, quién y con qué certificado. Solo con un uso del
--     certificado de esa persona, para esa declaración y «presentar».
--   conta_impuesto_fuera(…)                                      [solo service_role]
--     «Ya lo presenté fuera»: con su CSV. Si se ha comprobado con Hacienda
--     (consulta de declaraciones presentadas), con su justificante y fecha; si
--     no, queda dicho que no se ha comprobado.
--   conta_impuesto_hacienda_apunte(…)                            [solo service_role]
--     Cada llamada a Hacienda, en el registro de la declaración (tax_return_event).
--   conta_impuesto_justificante_guardar(declaración, ruta, huella, tamaño)
--                                                                [la persona y service_role]
--     El PDF del justificante, ya subido a conta-documentos en
--     <cuenta>/impuestos/<declaración>/<huella>.pdf. Uno por declaración: no se cambia.
--
-- Nunca se guarda el CSV entero en el registro (tax_return_event ni
-- tax_certificate_use): solo en la declaración, que es donde tiene que estar.

-- ── Quién gestiona, para una persona dada ──────────────────────────────────
create or replace function public.conta_impuesto_gestiona(p_user uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from public.company c join public.user_profiles me on me.account_id = c.account_id
             where c.id = p_company and me.user_id = p_user and me.active and me.role in ('admin', 'manager'))
    or exists (select 1 from public.company_tax_presenter t join public.user_profiles me on me.account_id = t.advisor_account_id
                where t.company_id = p_company and t.mode = 'advisor' and t.consented_at is not null and t.revoked_at is null
                  and me.user_id = p_user and me.active and me.role in ('admin', 'manager')))
$$;

create or replace function public.conta_impuesto_nombre_de(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(display_name), '') from public.user_profiles where user_id = p_user and active order by display_name limit 1), 'Sumied')
$$;

-- ── Revisado ────────────────────────────────────────────────────────────────
create or replace function public.conta_impuesto_revisar(p_return uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tax_return; v_n int; v_avisos int;
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(r.company_id) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, revisa sus impuestos.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'Solo se revisa un borrador, y esta declaración está «%».', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  select count(*) into v_n from public.tax_return_check where tax_return_id = r.id and result = 'error';
  if v_n > 0 then
    raise exception 'Tiene % % que Sumied no sabe resolver: no se puede dar por revisada.', v_n, case when v_n = 1 then 'cosa' else 'cosas' end using errcode = '22023';
  end if;
  select count(*) into v_avisos from public.tax_return_check where tax_return_id = r.id and result = 'warning' and accepted_at is null;
  update public.tax_return set status = 'reviewed', reviewed_at = now(), reviewed_by = auth.uid(), reviewed_by_name = public.conta_impuesto_quien(), updated_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true, 'avisos_sin_aceptar', v_avisos,
    'mensaje', 'Revisado por ' || public.conta_impuesto_quien() || case when v_avisos > 0 then '. Quedan ' || v_avisos || ' avisos sin dar por buenos.' else '.' end);
end $$;

create or replace function public.conta_impuesto_aviso_aceptar(p_check uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.tax_return_check; r public.tax_return;
begin
  select * into k from public.tax_return_check where id = p_check for update;
  if k.id is null then raise exception 'Esa comprobación no está.' using errcode = 'P0002'; end if;
  select * into r from public.tax_return where id = k.tax_return_id;
  if not public.conta_impuesto_puede_gestionar(r.company_id) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, da por bueno un aviso.' using errcode = '42501';
  end if;
  if k.result <> 'warning' then raise exception 'Solo se da por bueno un aviso; un error no.' using errcode = '22023'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'Para dar por bueno un aviso hace falta decir por qué.' using errcode = '22023'; end if;
  if r.status not in ('draft', 'reviewed') then raise exception 'Esta declaración ya está «%».', public.conta_impuesto_estado_texto(r.status) using errcode = '22023'; end if;
  update public.tax_return_check set accepted_by = auth.uid(), accepted_by_name = public.conta_impuesto_quien(), accepted_at = now(), accepted_reason = btrim(p_motivo)
   where id = k.id;
  return jsonb_build_object('ok', true, 'mensaje', public.conta_impuesto_quien() || ' lo dio por bueno el ' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM') || ': ' || btrim(p_motivo));
end $$;

-- ── Antes de abrir el certificado ──────────────────────────────────────────
create or replace function public.conta_impuesto_303_preparar(p_return uuid, p_user uuid, p_confirmation uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tax_return; t public.tax_certificate_confirmation;
begin
  select * into r from public.tax_return where id = p_return and form_code = '303';
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_gestiona(p_user, r.company_id) then
    raise exception 'No puedes presentar los impuestos de esta empresa.' using errcode = '42501';
  end if;
  select * into t from public.tax_certificate_confirmation where id = p_confirmation;
  if t.id is null or t.user_id is distinct from p_user or t.action <> 'file' or t.tax_return_id is distinct from r.id then
    raise exception 'Esa confirmación no es para presentar esta declaración. Vuelve a pulsar y confirmar.' using errcode = '42501';
  end if;
  if t.used_at is not null or t.expires_at <= now() then
    raise exception 'Esa confirmación ya se usó o ha caducado (dura 5 minutos). Vuelve a pulsar y confirmar.' using errcode = '22023';
  end if;
  if r.status <> 'reviewed' then
    raise exception 'Antes de presentar, alguien tiene que revisarla: está «%».', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  return public.conta_impuesto_303_fichero(r.id) || jsonb_build_object('declaracion', r.id, 'empresa', r.company_id, 'cuenta', r.account_id);
end $$;

-- ── Presentada desde Sumied ─────────────────────────────────────────────────
create or replace function public.conta_impuesto_presentada(p_return uuid, p_user uuid, p_use uuid, p_csv text, p_justificante text,
                                                            p_expediente text, p_fecha timestamptz, p_respuesta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tax_return; u public.tax_certificate_use; c public.tax_certificate; v_nombre text := public.conta_impuesto_nombre_de(p_user);
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  select * into u from public.tax_certificate_use where id = p_use;
  if u.id is null or u.user_id is distinct from p_user or u.action <> 'file' or u.tax_return_id is distinct from r.id then
    raise exception 'Ese uso del certificado no es de esta persona para presentar esta declaración.' using errcode = '42501';
  end if;
  if p_csv is null or p_csv !~ '^[A-Z0-9]{16}$' then raise exception 'Hacienda no ha dado un CSV válido: no se apunta como presentada.' using errcode = '22023'; end if;
  if r.status <> 'reviewed' then raise exception 'Esta declaración está «%».', public.conta_impuesto_estado_texto(r.status) using errcode = '22023'; end if;
  select * into c from public.tax_certificate where id = u.certificate_id;
  update public.tax_return
     set status = 'filed', filed_at = coalesce(p_fecha, now()), filed_by = p_user, filed_by_name = v_nombre, filed_via = 'sumied',
         presenter_kind = case when c.owner_account_id = r.account_id then 'company' else 'advisor' end, certificate_id = c.id,
         aeat_csv = p_csv, aeat_receipt_number = p_justificante, updated_at = now()
   where id = r.id;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, aeat_service, result, message, detail)
  values (r.id, r.account_id, r.company_id, p_user, v_nombre, 'aeat_call', 'present', 'ok',
          'Presentado. Justificante ' || coalesce(p_justificante, '—') || '.',
          jsonb_build_object('expediente', p_expediente, 'csv_cola', right(p_csv, 4), 'respuesta', coalesce(p_respuesta, '{}')));
  return jsonb_build_object('ok', true, 'mensaje', 'Presentado el ' || r.form_code || ' del ' || r.period || '/' || r.fiscal_year ||
                            '. Justificante ' || coalesce(p_justificante, '—') || ', CSV ' || p_csv || '.');
end $$;

-- ── «Ya lo presenté fuera» ──────────────────────────────────────────────────
create or replace function public.conta_impuesto_fuera(p_return uuid, p_user uuid, p_csv text, p_comprobada boolean,
                                                       p_justificante text, p_fecha timestamptz, p_use uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.tax_return; v_csv text := upper(regexp_replace(coalesce(p_csv, ''), '\s', '', 'g')); v_nombre text := public.conta_impuesto_nombre_de(p_user);
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_gestiona(p_user, r.company_id) then
    raise exception 'No puedes apuntar los impuestos de esta empresa.' using errcode = '42501';
  end if;
  if v_csv !~ '^[A-Z0-9]{16}$' then
    raise exception 'Ese CSV no tiene la forma de los de Hacienda: son 16 letras y números, como aparecen en el justificante.' using errcode = '22023';
  end if;
  if r.status not in ('draft', 'reviewed') then
    raise exception 'Esta declaración está «%»: solo se apunta como presentada fuera un borrador o una revisada.', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if p_comprobada and not exists (select 1 from public.tax_certificate_use u where u.id = p_use and u.user_id = p_user and u.action = 'query' and u.tax_return_id = r.id) then
    raise exception 'Para darla por comprobada con Hacienda hace falta el uso del certificado con el que se consultó.' using errcode = '42501';
  end if;
  -- Sin calcular, Sumied no sabe qué se presentó (la consulta de Hacienda no da el importe): no se inventa un resultado.
  if r.result_kind is null then
    raise exception 'Antes de apuntarla como presentada, calcúlala en Sumied: así queda qué se presentó.' using errcode = '22023';
  end if;
  update public.tax_return
     set status = 'filed', filed_at = coalesce(p_fecha, now()), filed_by = p_user, filed_by_name = v_nombre, filed_via = 'outside',
         aeat_csv = v_csv, aeat_receipt_number = p_justificante, outside_csv_pasted_at = now(), updated_at = now()
   where id = r.id;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, aeat_service, result, message, detail)
  values (r.id, r.account_id, r.company_id, p_user, v_nombre,
          case when p_comprobada then 'aeat_call' else 'note' end, case when p_comprobada then 'outside_check' end, case when p_comprobada then 'ok' end,
          case when p_comprobada then 'Presentado fuera de Sumied: Hacienda lo confirma (justificante ' || coalesce(p_justificante, '—') || ').'
               else 'Presentado fuera de Sumied, según ' || v_nombre || '. No se ha comprobado con Hacienda.' end,
          jsonb_build_object('csv_cola', right(v_csv, 4), 'comprobada', p_comprobada));
  return jsonb_build_object('ok', true, 'comprobada', p_comprobada,
    'mensaje', case when p_comprobada then 'Apuntado como presentado fuera: Hacienda lo confirma, justificante ' || coalesce(p_justificante, '—') || '.'
                    else 'Apuntado como presentado fuera, con el CSV que has pegado. No se ha podido comprobar con Hacienda.' end);
end $$;

-- ── Cada llamada a Hacienda, en el registro de la declaración ──────────────
create or replace function public.conta_impuesto_hacienda_apunte(p_return uuid, p_user uuid, p_service text, p_result text,
                                                                 p_codes text[], p_message text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.tax_return;
begin
  select * into r from public.tax_return where id = p_return;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if p_message is null or btrim(p_message) = '' then raise exception 'Falta cómo acabó, en palabras.' using errcode = '22023'; end if;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, aeat_service, result, aeat_codes, message, detail)
  values (r.id, r.account_id, r.company_id, p_user, public.conta_impuesto_nombre_de(p_user), 'aeat_call', p_service, p_result, p_codes,
          btrim(p_message), coalesce(p_detail, '{}'));
end $$;

-- ── El justificante (PDF) ───────────────────────────────────────────────────
create or replace function public.conta_impuesto_justificante_guardar(p_return uuid, p_ruta text, p_huella text, p_tamano bigint)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare r public.tax_return; v_tam bigint; v_tipo text;
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_gestionar(r.company_id) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, guarda el justificante.' using errcode = '42501';
  end if;
  if r.status not in ('filed', 'booked', 'paid', 'offset', 'refunded') then
    raise exception 'El justificante va con una declaración presentada, y esta está «%».', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if p_ruta is null or p_ruta <> r.account_id::text || '/impuestos/' || r.id::text || '/' || p_huella || '.pdf' or p_huella !~ '^[0-9a-f]{64}$' then
    raise exception 'El justificante tiene que estar en la carpeta de esta declaración, con su huella de nombre.' using errcode = '22023';
  end if;
  if r.receipt_document_path is not null then
    if r.receipt_document_path = p_ruta then return jsonb_build_object('ok', true, 'ruta', p_ruta, 'mensaje', 'El justificante ya estaba guardado.'); end if;
    raise exception 'Esta declaración ya tiene su justificante: no se cambia.' using errcode = '22023';
  end if;
  select (o.metadata->>'size')::bigint, o.metadata->>'mimetype' into v_tam, v_tipo
    from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_tam is null then raise exception 'El justificante no ha llegado: vuelve a subirlo.' using errcode = 'P0002'; end if;
  if v_tam <> p_tamano or coalesce(v_tipo, 'application/pdf') <> 'application/pdf' then
    raise exception 'El fichero subido no es el justificante que se esperaba (tamaño o tipo distintos).' using errcode = '22023';
  end if;
  update public.tax_return set receipt_document_path = p_ruta, updated_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'ruta', p_ruta, 'mensaje', 'Guardado el justificante del ' || r.form_code || ' del ' || r.period || '/' || r.fiscal_year || '.');
end $$;

-- ── Quién llama a qué ───────────────────────────────────────────────────────
revoke all on function public.conta_impuesto_gestiona(uuid, uuid), public.conta_impuesto_nombre_de(uuid),
                       public.conta_impuesto_303_preparar(uuid, uuid, uuid),
                       public.conta_impuesto_presentada(uuid, uuid, uuid, text, text, text, timestamptz, jsonb),
                       public.conta_impuesto_fuera(uuid, uuid, text, boolean, text, timestamptz, uuid),
                       public.conta_impuesto_hacienda_apunte(uuid, uuid, text, text, text[], text, jsonb)
  from public, anon, authenticated;
grant execute on function public.conta_impuesto_gestiona(uuid, uuid), public.conta_impuesto_nombre_de(uuid),
                          public.conta_impuesto_303_preparar(uuid, uuid, uuid),
                          public.conta_impuesto_presentada(uuid, uuid, uuid, text, text, text, timestamptz, jsonb),
                          public.conta_impuesto_fuera(uuid, uuid, text, boolean, text, timestamptz, uuid),
                          public.conta_impuesto_hacienda_apunte(uuid, uuid, text, text, text[], text, jsonb)
  to service_role;
revoke all on function public.conta_impuesto_revisar(uuid), public.conta_impuesto_aviso_aceptar(uuid, text),
                       public.conta_impuesto_justificante_guardar(uuid, text, text, bigint)
  from public, anon;
grant execute on function public.conta_impuesto_revisar(uuid), public.conta_impuesto_aviso_aceptar(uuid, text),
                          public.conta_impuesto_justificante_guardar(uuid, text, text, bigint)
  to authenticated, service_role;
