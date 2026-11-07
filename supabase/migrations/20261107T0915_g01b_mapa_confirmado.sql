-- supabase/migrations/20261107T0915_g01b_mapa_confirmado.sql
--
-- G01b · Parte 2 (07/11/2026) · El mapa de Bitrix24, confirmado por una
-- persona en «Qué es cada campo» (Ajustes › Cobros › Bitrix24). Decisiones de
-- Julio tras el recuento (run 42358085266, 1.437 fichas):
--   · Sin confirmar, no se guarda la situación de nadie (lo hace la función
--     conta-bitrix-leer, que lee el «confirmado» del mapa).
--   · GRAVE DESAPARECIDO y las tres «Vzla» son «Sin clasificar», con su texto
--     de Bitrix24.
--
-- cambia: public.conta_gestoria_cliente · prueba: supabase/staging/sql/20261107_g01b_mapa_confirmado_prueba.sql
--
--   1. conta_gestoria_cliente.situacion admite «sin_clasificar» (el CHECK
--      solo amplía: lo de antes sigue valiendo). Medido el 07/11 en
--      producción: 1.437 filas, todas con la situación vacía.
--   2. conta_bitrix_confirmar_mapa (nueva): una persona administradora o
--      encargada de la cuenta guarda el mapa que ha revisado, con quién y
--      cuándo. Comprueba que cada código existe en lo medido del portal
--      (campos_medidos) y que cada opción de la situación dice qué es en
--      Sumied. Quita las dudas (ya las ha decidido una persona) y devuelve su
--      frase (regla 8). No lee Bitrix24: la lectura nueva la lanza la persona
--      después.
-- Vuelta atrás: supabase/vuelta-atras/20261107T0915_g01b_mapa_confirmado.down.sql

alter table public.conta_gestoria_cliente drop constraint if exists conta_gestoria_cliente_situacion_check;
alter table public.conta_gestoria_cliente add constraint conta_gestoria_cliente_situacion_check
  check (situacion is null or situacion in ('activo', 'baja', 'moroso', 'solo_renta', 'sin_clasificar'));

create or replace function public.conta_bitrix_confirmar_mapa(p_account uuid, p_mapa jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.conta_crm_bitrix; v_c jsonb; v_cod text; v_faltan text[] := '{}'; v_sit jsonb; v_it jsonb; v_op text;
        v_sin_op text[] := '{}'; v_quien text := public.conta_nombre_actor(); v_mapa jsonb; v_n int; v_frase text;
        v_validas constant text[] := array['activo', 'baja', 'moroso', 'solo_renta', 'sin_clasificar'];
begin
  if not public.current_user_is_admin_or_manager_of(p_account) then
    raise exception 'Solo un administrador o un encargado de la cuenta confirma el mapa de Bitrix24.' using errcode = '42501';
  end if;
  select * into v_b from public.conta_crm_bitrix where account_id = p_account for update;
  if v_b.account_id is null then raise exception 'Esta cuenta no tiene conectado Bitrix24.' using errcode = 'P0002'; end if;
  if v_b.campos_medidos is null then raise exception 'Faltan los campos medidos del portal: vuelve a conectar Bitrix24.' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_mapa) is distinct from 'object' or jsonb_typeof(p_mapa->'campos') is distinct from 'array' then
    raise exception 'El mapa no trae sus campos.' using errcode = '22023';
  end if;

  -- Cada código del mapa (campos y fuentes de la dirección) tiene que existir en lo medido del portal.
  for v_cod in
    select c->>'codigo' from jsonb_array_elements(p_mapa->'campos') c where coalesce(c->>'codigo', '') <> ''
    union all
    select x from jsonb_array_elements(coalesce(p_mapa->'direcciones', '[]'::jsonb)) d,
           lateral (values (d->>'calle'), (d->>'cp'), (d->>'poblacion'), (d->>'provincia')) v(x) where coalesce(x, '') <> ''
  loop
    if not (v_b.campos_medidos ? v_cod) then v_faltan := v_faltan || v_cod; end if;
  end loop;
  if cardinality(v_faltan) > 0 then
    raise exception 'Este Bitrix24 no tiene estos campos: %.', array_to_string(v_faltan, ', ') using errcode = '22023';
  end if;

  -- La situación: un solo campo, y cada opción suya dice qué es en Sumied.
  select count(*) into v_n from jsonb_array_elements(p_mapa->'campos') c where c->>'campo' = 'situacion' and coalesce(c->>'codigo', '') <> '';
  if v_n <> 1 then raise exception 'Falta decir qué campo de Bitrix24 es la situación del cliente.' using errcode = '22023'; end if;
  select c into v_sit from jsonb_array_elements(p_mapa->'campos') c where c->>'campo' = 'situacion' and coalesce(c->>'codigo', '') <> '';
  for v_it in select * from jsonb_array_elements(coalesce(v_b.campos_medidos->(v_sit->>'codigo')->'items', '[]'::jsonb)) loop
    v_op := v_sit->'opciones'->>(v_it->>'ID');
    if v_op is null or not (v_op = any (v_validas)) then v_sin_op := v_sin_op || (v_it->>'VALUE'); end if;
  end loop;
  if cardinality(v_sin_op) > 0 then
    raise exception 'Falta decir qué es en Sumied: %.', array_to_string(v_sin_op, ', ') using errcode = '22023';
  end if;

  v_mapa := (p_mapa - 'dudas') || jsonb_build_object('dudas', '[]'::jsonb,
    'confirmado', jsonb_build_object('quien', v_quien, 'cuando', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  update public.conta_crm_bitrix set mapa = v_mapa, updated_at = now() where account_id = p_account;

  select count(*) into v_n from jsonb_array_elements(p_mapa->'campos') c where coalesce(c->>'codigo', '') <> '';
  v_frase := format('Mapa de Bitrix24 confirmado por %s: %s campos y %s fuentes de la dirección. La situación se guarda desde la próxima lectura.',
    coalesce(v_quien, 'una persona de la cuenta'), v_n, jsonb_array_length(coalesce(p_mapa->'direcciones', '[]'::jsonb)));
  return jsonb_build_object('frase', v_frase, 'confirmado', v_mapa->'confirmado');
end $$;
comment on function public.conta_bitrix_confirmar_mapa(uuid, jsonb) is
  'G01b · «Qué es cada campo»: una persona administradora o encargada confirma el mapa de Bitrix24 de la cuenta (con quién y cuándo). Sin confirmar, la lectura no guarda la situación de nadie.';
revoke all on function public.conta_bitrix_confirmar_mapa(uuid, jsonb) from public, anon;
grant execute on function public.conta_bitrix_confirmar_mapa(uuid, jsonb) to authenticated, service_role;
