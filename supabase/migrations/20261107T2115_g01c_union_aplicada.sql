-- supabase/migrations/20261107T2115_g01c_union_aplicada.sql
--
-- G01c · La unión aplicada se perdía al confirmar el mapa (Julio, 07/11,
-- comprobado en producción solo leyendo): la lectura de las 20:05 UTC dijo «31
-- clientes no se han guardado … Se unirá a su cliente cuando se aplique la
-- unión», con la unión aplicada a las 13:02 UTC. La marca vivía dentro del
-- mapa (mapa.union) y confirmar el mapa en «Qué es cada campo» lo reemplazaba
-- entero con el que manda la pantalla, que no la lleva (pasaba igual antes del
-- G01c). Ahora:
--
-- cambia: public.conta_crm · prueba: supabase/staging/sql/20261107_g01c_union_aplicada_prueba.sql
-- cambia: public.conta_crm_confirmar_mapa · prueba: supabase/staging/sql/20261107_g01c_union_aplicada_prueba.sql
-- cambia: public.conta_crm_aplicar_union · prueba: supabase/staging/sql/20261107_g01c_union_aplicada_prueba.sql
--
--   1. conta_crm.union_aplicada (nueva): la marca, con quién y cuándo, fuera
--      del mapa. La lectura la lee de aquí. Se rellena con la que tenga el mapa
--      y, si el mapa ya la perdió, con la primera lectura que unió (la que
--      lanzó «Aplicar la unión y leer»: su mensaje dice «En Sumied, … clientes»,
--      que solo sale con la unión), con su persona y su hora. También se
--      vuelve a poner en el mapa, para la función publicada hasta la fusión.
--   2. conta_crm_aplicar_union (la misma firma, con su respaldo): la escribe en
--      los dos sitios.
--   3. conta_crm_confirmar_mapa (la misma firma, con su respaldo): el mapa
--      confirmado conserva la unión aplicada.
-- No lee ni escribe nada en el CRM. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261107T2115_g01c_union_aplicada.down.sql

-- 1 · La marca, fuera del mapa.
alter table public.conta_crm add column if not exists union_aplicada jsonb;
comment on column public.conta_crm.union_aplicada is
  'G01c · La unión de las fichas aplicada (mismo NIF = un cliente): quién y cuándo. Fuera del mapa, para que confirmarlo no la quite. La lectura la lee de aquí.';

update public.conta_crm set union_aplicada = mapa->'union'
 where union_aplicada is null and jsonb_typeof(mapa->'union') = 'object';
-- La que se perdió: la primera lectura de esa cuenta y ese CRM que unió.
update public.conta_crm c set union_aplicada = jsonb_build_object('quien', l.quien_name,
         'cuando', to_char(l.empezada_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'repuesta', 'La quitó confirmar el mapa; repuesta con la primera lectura que unió.')
  from (select distinct on (account_id) account_id, quien_name, empezada_at from public.conta_gestoria_lectura
         where origen = 'bitrix' and estado = 'bien' and mensaje like '%En Sumied, %clientes:%' order by account_id, empezada_at) l
 where c.union_aplicada is null and c.crm = 'bitrix24' and l.account_id = c.account_id;
update public.conta_crm set mapa = mapa || jsonb_build_object('union', union_aplicada)
 where union_aplicada is not null and mapa is not null and mapa->'union' is distinct from union_aplicada;

-- 2 y 3 · Las dos funciones. Las de antes, guardadas (_respaldar_funcion).
select public._respaldar_funcion('public.conta_crm_aplicar_union(uuid,text)', '20261107T2115_g01c_union_aplicada');
select public._respaldar_funcion('public.conta_crm_confirmar_mapa(uuid,text,text,jsonb)', '20261107T2115_g01c_union_aplicada');
create or replace function public.conta_crm_aplicar_union(p_account uuid, p_crm text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.conta_crm; v_quien text := public.conta_nombre_actor(); v_union jsonb; v_nombre text := public._conta_crm_nombre(p_crm);
begin
  if not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo un administrador o un encargado de la cuenta aplica la unión de las fichas de %.', v_nombre using errcode = '42501';
  end if;
  select * into v_b from public.conta_crm where account_id = p_account and crm = p_crm for update;
  if v_b.account_id is null then raise exception 'Esta cuenta no tiene conectado %.', v_nombre using errcode = 'P0002'; end if;
  if v_b.mapa->'confirmado' is null or v_b.mapa->'confirmado' = 'null'::jsonb then
    raise exception 'Primero hay que confirmar el mapa en «Qué es cada campo».' using errcode = '22023';
  end if;
  v_union := jsonb_build_object('quien', v_quien, 'cuando', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  update public.conta_crm set union_aplicada = v_union, mapa = mapa || jsonb_build_object('union', v_union), updated_at = now() where account_id = p_account and crm = p_crm;
  return jsonb_build_object('frase', format('Unión aplicada por %s: la próxima lectura une las fichas de %s con el mismo NIF en un solo cliente.',
    coalesce(v_quien, 'una persona de la cuenta'), v_nombre), 'union', v_union);
end $$;
revoke all on function public.conta_crm_aplicar_union(uuid, text) from public, anon;
grant execute on function public.conta_crm_aplicar_union(uuid, text) to authenticated, service_role;

create or replace function public.conta_crm_confirmar_mapa(p_account uuid, p_crm text, p_tipo_ficha text, p_mapa jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.conta_crm; v_medidos jsonb; v_cod text; v_faltan text[] := '{}'; v_sit jsonb; v_it jsonb; v_op text; v_sin_op text[] := '{}';
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
