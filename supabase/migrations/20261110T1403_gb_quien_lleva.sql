-- supabase/migrations/20261110T1403_gb_quien_lleva.sql
--
-- GB · nº 24 (el 7 de Code 3) · QUIÉN LLEVA AL CLIENTE, para que el portal diga
-- «Te lleva: Nombre · correo». Lo trae la lectura del CRM (conta-bitrix-leer):
-- el responsable de la ficha de Bitrix24 (ASSIGNED_BY_ID) con su nombre y su
-- correo (user.get), guardado en la ficha del cliente como un dato más
-- (conta_gestoria_cliente.ficha → «responsable»), sin tocar cómo se guarda.
--
-- Solo añade una función de lectura:
--   conta_portal_quien_lleva(cliente): para la persona que entra al portal de
--   ese cliente (cualquier permiso: también «solo facturas y documentos»),
--   {nombre, correo} de quien lo lleva; null si el CRM no lo dice o aún no se
--   ha leído. La persona, con _conta_portal_yo, como las demás del portal.
-- No toca nada del camino del pedido. No cambia ningún dato.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1403_gb_quien_lleva.down.sql

create or replace function public.conta_portal_quien_lleva(p_party uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, false); v jsonb;
begin
  select g.ficha->'responsable' into v from public.conta_gestoria_cliente g where g.party_id = y.party_id and g.account_id = y.account_id;
  if v is null or jsonb_typeof(v) <> 'object' or coalesce(nullif(v->>'nombre', ''), nullif(v->>'correo', '')) is null then return null; end if;
  return jsonb_build_object('nombre', nullif(v->>'nombre', ''), 'correo', nullif(v->>'correo', ''));
end $$;
revoke all on function public.conta_portal_quien_lleva(uuid) from public, anon;
grant execute on function public.conta_portal_quien_lleva(uuid) to authenticated, service_role;

comment on function public.conta_portal_quien_lleva(uuid) is
  'GB (nº 24, el 7 de Code 3) · Quién lleva al cliente, para el portal («Te lleva: Nombre · correo»): el responsable de su ficha del CRM (Bitrix24, ASSIGNED_BY_ID con user.get), que guarda la lectura del CRM en conta_gestoria_cliente.ficha. {nombre, correo} o null. Para la persona del portal de ese cliente (_conta_portal_yo), con cualquier permiso.';
