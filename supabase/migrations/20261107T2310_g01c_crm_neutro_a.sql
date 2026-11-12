-- supabase/migrations/20261107T2310_g01c_crm_neutro_a.sql
--
-- G01c · PR A de la clave neutra (Julio, 07/11): lo publicado deja de usar lo
-- de Bitrix24 en la base. Esta tanda solo AÑADE lo neutro que les falta a las
-- funciones y al front, y amplía dos CHECK; el PR B quita lo de antes.
--
-- cambia: public.conta_gestoria_diferencia · prueba: supabase/staging/sql/20261107_g01c_crm_neutro_a_prueba.sql
-- cambia: public.conta_gestoria_lectura · prueba: supabase/staging/sql/20261107_g01c_crm_neutro_a_prueba.sql
-- cambia: public.conta_crm_confirmar_mapa · prueba: supabase/staging/sql/20261107_g01c_crm_neutro_a_prueba.sql
--
--   1. _conta_crm_campo_sensible(código, campo) (nueva): ¿un campo del CRM
--      guarda una contraseña, un certificado o datos bancarios? Por su tipo,
--      su código (BANKING_DETAILS) o su etiqueta (también IBAN y «Detalles del
--      pago»), como el adaptador (conta-bitrix-leer/sensibles.ts).
--   2. conta_crm_confirmar_mapa (la misma firma, con su respaldo): vuelve a
--      parar un mapa que elija un campo así, en las empresas y en los
--      contactos. La de la 1110 lo hacía y la neutra del G01c lo perdió.
--   3. conta_crm_secreto(cuenta, crm) y conta_crm_guardar_conexion(cuenta,
--      crm, …) (nuevas): lo de conta_bitrix_secreto y
--      conta_bitrix_guardar_conexion, con el CRM. El secreto nuevo se llama
--      «conta_crm:<crm>:<cuenta>»; el de antes sigue valiendo por su id.
--   4. «Pendiente de revisar» admite los tres tipos neutros de GoCardless
--      (crm_sin_cobro, nif_repetido_en_crm, correo_repetido_en_crm) y las
--      lecturas, el origen «crm». Los CHECK solo amplían.
-- No lee ni escribe nada en el CRM. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261107T2310_g01c_crm_neutro_a.down.sql

-- 1 · ¿Un campo del CRM que no se lee nunca?
create or replace function public._conta_crm_campo_sensible(p_codigo text, p_campo jsonb)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_codigo, '') in ('BANKING_DETAILS')
      or coalesce(p_campo->>'type', '') in ('file', 'password')
      or exists (select 1 from unnest(array[p_campo->>'formLabel', p_campo->>'listLabel', p_campo->>'title']) t
                  where t is not null and regexp_replace(translate(upper(t), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), '\s+', ' ', 'g')
                    ~ '(^|[^A-Z0-9@])(CLAVE|CLAVES|CONTRASENA|CONTRASENAS|PASSWORD|PASSWD|PASS|PIN|USUARIO|USER|LOGIN|CREDENCIAL|CREDENCIALES|TOKEN|SECRETO|CL@VE|IBAN|DETALLES DEL PAGO)($|[^A-Z0-9])')
$$;
comment on function public._conta_crm_campo_sensible(text, jsonb) is
  'G01c · ¿Un campo del CRM guarda una contraseña, un certificado o datos bancarios? Por su tipo, su código o su etiqueta. No se lee nunca.';
revoke all on function public._conta_crm_campo_sensible(text, jsonb) from public, anon;

-- 2 · Confirmar el mapa vuelve a parar los campos que no se leen nunca. La de antes, guardada (_respaldar_funcion).
select public._respaldar_funcion('public.conta_crm_confirmar_mapa(uuid,text,text,jsonb)', '20261107T2310_g01c_crm_neutro_a');
create or replace function public.conta_crm_confirmar_mapa(p_account uuid, p_crm text, p_tipo_ficha text, p_mapa jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.conta_crm; v_medidos jsonb; v_cod text; v_faltan text[] := '{}'; v_sensibles text[] := '{}'; v_sit jsonb; v_it jsonb; v_op text; v_sin_op text[] := '{}';
        v_quien text := public.conta_nombre_actor(); v_mapa jsonb; v_n int; v_frase text; v_nombre text := public._conta_crm_nombre(p_crm);
        v_validas constant text[] := array['activo', 'baja', 'moroso', 'solo_renta', 'sin_clasificar'];
        v_cuando text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo un administrador o un encargado de la cuenta confirma el mapa de %.', v_nombre using errcode = '42501';
  end if;
  if p_tipo_ficha not in ('empresa', 'contacto') then raise exception 'El mapa es de las empresas o de los contactos.' using errcode = '22023'; end if;
  select * into v_b from public.conta_crm where account_id = p_account and crm = p_crm for update;
  if v_b.account_id is null then raise exception 'Esta cuenta no tiene conectado %.', v_nombre using errcode = 'P0002'; end if;
  v_medidos := case p_tipo_ficha when 'empresa' then v_b.campos_medidos else v_b.campos_medidos_contactos end;
  if v_medidos is null then
    raise exception '%', case p_tipo_ficha when 'empresa' then format('Faltan los campos medidos del portal: vuelve a conectar %s.', v_nombre)
      else format('Aún no se han medido los campos de contacto del portal: lee %s y vuelve a confirmarlo.', v_nombre) end using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_mapa) is distinct from 'object' then raise exception 'El mapa no trae sus campos.' using errcode = '22023'; end if;

  if p_tipo_ficha = 'contacto' then
    for v_cod in
      select x from (values (p_mapa->>'nif'), (p_mapa->>'cuota'), (p_mapa->>'tipoCliente'), (p_mapa->'direccion'->>'calle'), (p_mapa->'direccion'->>'cp'),
                            (p_mapa->'direccion'->>'poblacion'), (p_mapa->'direccion'->>'provincia')) v(x) where coalesce(x, '') <> ''
    loop
      if not (v_medidos ? v_cod) then v_faltan := v_faltan || v_cod; end if;
    end loop;
    if cardinality(v_faltan) > 0 then
      raise exception 'Los contactos de este % no tienen estos campos: %.', v_nombre, array_to_string(v_faltan, ', ') using errcode = '22023';
    end if;
    -- G01c (07/11) · Un campo con una contraseña, un certificado o datos bancarios no se lee nunca, aunque se elija por error.
    select coalesce(array_agg(x order by x), '{}') into v_sensibles from (
      select distinct coalesce(nullif(trim(v_medidos->k->>'formLabel'), ''), nullif(trim(v_medidos->k->>'listLabel'), ''), v_medidos->k->>'title', k) x
        from (values (p_mapa->>'nif'), (p_mapa->>'cuota'), (p_mapa->>'tipoCliente'), (p_mapa->'direccion'->>'calle'), (p_mapa->'direccion'->>'cp'),
                     (p_mapa->'direccion'->>'poblacion'), (p_mapa->'direccion'->>'provincia')) v(k)
       where coalesce(k, '') <> '' and public._conta_crm_campo_sensible(k, v_medidos->k)) s;
    if cardinality(v_sensibles) > 0 then
      raise exception 'Estos campos guardan contraseñas, certificados o datos bancarios y no se leen nunca: %.', array_to_string(v_sensibles, ', ') using errcode = '22023';
    end if;
    v_mapa := jsonb_build_object('nif', p_mapa->'nif', 'direccion', p_mapa->'direccion', 'cuota', p_mapa->'cuota', 'tipoCliente', p_mapa->'tipoCliente',
      'textosTipo', coalesce(p_mapa->'textosTipo', '{}'::jsonb), 'confirmado', jsonb_build_object('quien', v_quien, 'cuando', v_cuando));
    update public.conta_crm set mapa_contactos = v_mapa, updated_at = now() where account_id = p_account and crm = p_crm;
    v_frase := format('Mapa de los contactos de %s confirmado por %s. Los contactos entran en Sumied desde la próxima lectura.', v_nombre, coalesce(v_quien, 'una persona de la cuenta'));
    return jsonb_build_object('frase', v_frase, 'confirmado', v_mapa->'confirmado');
  end if;

  -- Las empresas: lo de siempre (G01b · 0915).
  if jsonb_typeof(p_mapa->'campos') is distinct from 'array' then raise exception 'El mapa no trae sus campos.' using errcode = '22023'; end if;
  for v_cod in
    select c->>'codigo' from jsonb_array_elements(p_mapa->'campos') c where coalesce(c->>'codigo', '') <> ''
    union all
    select x from jsonb_array_elements(coalesce(p_mapa->'direcciones', '[]'::jsonb)) d,
           lateral (values (d->>'calle'), (d->>'cp'), (d->>'poblacion'), (d->>'provincia')) v(x) where coalesce(x, '') <> ''
  loop
    if not (v_medidos ? v_cod) then v_faltan := v_faltan || v_cod; end if;
  end loop;
  if cardinality(v_faltan) > 0 then
    raise exception 'Este % no tiene estos campos: %.', v_nombre, array_to_string(v_faltan, ', ') using errcode = '22023';
  end if;
  -- G01b (1110) · Un campo con una contraseña, un certificado o datos bancarios no se lee nunca, aunque se elija por error.
  select coalesce(array_agg(x order by x), '{}') into v_sensibles from (
    select distinct coalesce(nullif(trim(m->>'formLabel'), ''), nullif(trim(m->>'listLabel'), ''), m->>'title', k) x
      from jsonb_each(v_medidos) e(k, m)
     where k in (select c->>'codigo' from jsonb_array_elements(p_mapa->'campos') c
                 union all
                 select y from jsonb_array_elements(coalesce(p_mapa->'direcciones', '[]'::jsonb)) d,
                   lateral (values (d->>'calle'), (d->>'cp'), (d->>'poblacion'), (d->>'provincia')) v(y))
       and public._conta_crm_campo_sensible(k, m)) s;
  if cardinality(v_sensibles) > 0 then
    raise exception 'Estos campos guardan contraseñas, certificados o datos bancarios y no se leen nunca: %.', array_to_string(v_sensibles, ', ') using errcode = '22023';
  end if;
  select count(*) into v_n from jsonb_array_elements(p_mapa->'campos') c where c->>'campo' = 'situacion' and coalesce(c->>'codigo', '') <> '';
  if v_n <> 1 then raise exception 'Falta decir qué campo de % es la situación del cliente.', v_nombre using errcode = '22023'; end if;
  select c into v_sit from jsonb_array_elements(p_mapa->'campos') c where c->>'campo' = 'situacion' and coalesce(c->>'codigo', '') <> '';
  for v_it in select * from jsonb_array_elements(coalesce(v_medidos->(v_sit->>'codigo')->'items', '[]'::jsonb)) loop
    v_op := v_sit->'opciones'->>(v_it->>'ID');
    if v_op is null or not (v_op = any (v_validas)) then v_sin_op := v_sin_op || (v_it->>'VALUE'); end if;
  end loop;
  if cardinality(v_sin_op) > 0 then
    raise exception 'Falta decir qué es en Sumied: %.', array_to_string(v_sin_op, ', ') using errcode = '22023';
  end if;
  -- G01c (07/11, 20:05 UTC) · La unión aplicada no es del mapa: confirmar el mapa no la quita (la que manda es conta_crm.union_aplicada).
  v_mapa := (p_mapa - 'dudas' - 'union' - 'confirmado') || jsonb_build_object('dudas', '[]'::jsonb, 'confirmado', jsonb_build_object('quien', v_quien, 'cuando', v_cuando))
    || case when v_b.union_aplicada is not null then jsonb_build_object('union', v_b.union_aplicada) else '{}'::jsonb end;
  update public.conta_crm set mapa = v_mapa, updated_at = now() where account_id = p_account and crm = p_crm;
  select count(*) into v_n from jsonb_array_elements(p_mapa->'campos') c where coalesce(c->>'codigo', '') <> '';
  v_frase := format('Mapa de %s confirmado por %s: %s campos y %s fuentes de la dirección. La situación se guarda desde la próxima lectura.',
    v_nombre, coalesce(v_quien, 'una persona de la cuenta'), v_n, jsonb_array_length(coalesce(p_mapa->'direcciones', '[]'::jsonb)));
  return jsonb_build_object('frase', v_frase, 'confirmado', v_mapa->'confirmado');
end $$;
revoke all on function public.conta_crm_confirmar_mapa(uuid, text, text, jsonb) from public, anon;
grant execute on function public.conta_crm_confirmar_mapa(uuid, text, text, jsonb) to authenticated, service_role;

-- 3 · La conexión con el CRM, con el CRM.
create or replace function public.conta_crm_secreto(p_account uuid, p_crm text)
returns table(entorno text, url text, mapa jsonb) language sql stable security definer set search_path = public as $$
  select b.entorno, s.decrypted_secret, b.mapa
    from public.conta_crm b join vault.decrypted_secrets s on s.id = b.url_ref
   where b.account_id = p_account and b.crm = p_crm
$$;
comment on function public.conta_crm_secreto(uuid, text) is 'G01c · La conexión con el CRM de una cuenta (entorno, dirección de Vault y mapa). Solo el servidor.';
revoke all on function public.conta_crm_secreto(uuid, text) from public, anon, authenticated;
grant execute on function public.conta_crm_secreto(uuid, text) to service_role;

create or replace function public.conta_crm_guardar_conexion(p_account uuid, p_crm text, p_entorno text, p_url text, p_portal text, p_quien text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ref uuid; v_nombre text := 'conta_crm:' || p_crm || ':' || p_account::text; v_crm text := public._conta_crm_nombre(p_crm);
begin
  if not exists (select 1 from public.accounts where id = p_account) then raise exception 'La cuenta no existe.' using errcode = 'P0002'; end if;
  if p_entorno not in ('real', 'pruebas') then raise exception 'Entorno: real o pruebas.' using errcode = '22023'; end if;
  -- Cómo es la dirección de cada CRM (otro CRM, otra línea).
  if p_crm = 'bitrix24' and coalesce(trim(p_url), '') !~ '^https://[A-Za-z0-9.-]+/rest/[0-9]+/[A-Za-z0-9]+/?$' then
    raise exception 'La dirección de Bitrix24 es como https://<tu portal>/rest/<número>/<clave>/ (Bitrix24 › Aplicaciones › Webhooks › Webhook entrante).' using errcode = '22023';
  elsif p_crm <> 'bitrix24' then
    raise exception 'Sumied aún no sabe conectar %.', v_crm using errcode = '22023';
  end if;
  select url_ref into v_ref from public.conta_crm where account_id = p_account and crm = p_crm for update;
  if v_ref is null or not exists (select 1 from vault.secrets where id = v_ref) then
    select id into v_ref from vault.secrets where name = v_nombre;
  end if;
  if v_ref is not null then
    perform vault.update_secret(v_ref, trim(p_url), v_nombre, 'Dirección de lectura del CRM de una cuenta de Sumied');
  else
    v_ref := vault.create_secret(trim(p_url), v_nombre, 'Dirección de lectura del CRM de una cuenta de Sumied');
  end if;
  insert into public.conta_crm (account_id, crm, entorno, url_ref, portal, conectada_at, conectada_por_name, updated_at)
  values (p_account, p_crm, p_entorno, v_ref, p_portal, now(), p_quien, now())
  on conflict (account_id, crm) do update set entorno = excluded.entorno, url_ref = excluded.url_ref, portal = excluded.portal,
    conectada_at = excluded.conectada_at, conectada_por_name = excluded.conectada_por_name, updated_at = now();
end $$;
comment on function public.conta_crm_guardar_conexion(uuid, text, text, text, text, text) is
  'G01c · Guarda la conexión con el CRM de una cuenta: la dirección en Vault («conta_crm:<crm>:<cuenta>») y la fila de conta_crm. Solo el servidor.';
revoke all on function public.conta_crm_guardar_conexion(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_crm_guardar_conexion(uuid, text, text, text, text, text) to service_role;

-- 4 · Los tipos neutros de «Pendiente de revisar» y el origen «crm» de las lecturas (los CHECK solo amplían).
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'bitrix_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos',
  'crm_sin_cobro', 'nif_repetido_en_crm', 'correo_repetido_en_crm']));
alter table public.conta_gestoria_lectura drop constraint if exists conta_gestoria_lectura_origen_check;
alter table public.conta_gestoria_lectura add constraint conta_gestoria_lectura_origen_check check (origen = any (array['bitrix', 'gocardless', 'crm']));
