-- cambia: public.conta_portal_quien_lleva · prueba: supabase/staging/sql/20261110_gb_sin_titulo_prueba.sql
-- supabase/migrations/20261110T1520_gb_sin_titulo.sql
--
-- GB · nº 29, 2 · «Te lleva: Sin título», NO. Si el responsable de la empresa en
-- Bitrix24 no tiene nombre (Bitrix24 lo enseña como «Sin título»), el portal no
-- dice quién lleva al cliente: conta_portal_quien_lleva devuelve null.
--
-- Cambia en caliente (declarado arriba, con su prueba) una sola función, con la
-- MISMA firma: conta_portal_quien_lleva(cliente). Lo único distinto de la 1403:
--   · Sin nombre (vacío, o «Sin título», «Sin titulo» o «Untitled», como venga
--     de Bitrix24): null, aunque tenga correo. Un correo solo no dice quién es.
-- La lectura del CRM (conta-bitrix-leer) ya no guarda «Sin título» como nombre
-- (ni el login en su lugar); esto cubre también lo que se guardó antes.
-- La de antes se guarda con _respaldar_funcion y la vuelta atrás la restaura
-- byte a byte. Nada en el camino del pedido. No toca datos.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1520_gb_sin_titulo.down.sql

select public._respaldar_funcion('public.conta_portal_quien_lleva(uuid)', '20261110T1520_gb_sin_titulo');

create or replace function public.conta_portal_quien_lleva(p_party uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, false); v jsonb; v_nombre text;
begin
  select g.ficha->'responsable' into v from public.conta_gestoria_cliente g where g.party_id = y.party_id and g.account_id = y.account_id;
  if v is null or jsonb_typeof(v) <> 'object' then return null; end if;
  v_nombre := nullif(btrim(v->>'nombre'), '');
  if v_nombre is null or lower(v_nombre) in ('sin título', 'sin titulo', 'untitled') then return null; end if;
  return jsonb_build_object('nombre', v_nombre, 'correo', nullif(btrim(v->>'correo'), ''));
end $$;
revoke all on function public.conta_portal_quien_lleva(uuid) from public, anon;
grant execute on function public.conta_portal_quien_lleva(uuid) to authenticated, service_role;

comment on function public.conta_portal_quien_lleva(uuid) is
  'GB (nº 24, el 7 de Code 3; nº 29, sin «Sin título») · Quién lleva al cliente, para el portal («Te lleva: Nombre · correo»): el responsable de su ficha del CRM (Bitrix24, ASSIGNED_BY_ID con user.get), que guarda la lectura del CRM en conta_gestoria_cliente.ficha. {nombre, correo}, o null si no tiene nombre («Sin título» incluido). Para la persona del portal de ese cliente (_conta_portal_yo), con cualquier permiso.';
