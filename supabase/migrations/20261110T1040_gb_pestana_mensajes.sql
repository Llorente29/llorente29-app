-- supabase/migrations/20261110T1040_gb_pestana_mensajes.sql
--
-- GB · nº 17, C · «Su portal» en la pestaña «Sumied» de Bitrix24, como la
-- maqueta «Trabajar desde Bitrix24»: los mensajes del cliente CON SU TEXTO, para
-- contestar desde la ficha. «Invitar» y «Contestar» son de Code 3 (2345:
-- conta_portal_bitrix_invitar, por conta-portal «bitrix_invitar», y
-- conta_portal_bitrix_contestar); aquí solo se lee.
--
-- Solo añade una función, solo el servidor, DESPUÉS de comprobar con Bitrix24 al
-- usuario y la aplicación:
--   conta_bitrix_pestana_mensajes(portal, correo, tipo, ficha): quién mira y el
--   cliente de la ficha con la de Code 3 (_conta_portal_bitrix_quien), y, como
--   la persona, los últimos 6 mensajes de conta_portal_ficha (la misma lectura
--   que «Su portal» en Sumied), con su texto (hasta 600 letras) y si están
--   leídos. No marca nada como leído: eso lo hace «Contestar».
-- No toca nada del camino del pedido. No cambia ningún dato.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1040_gb_pestana_mensajes.down.sql

create or replace function public.conta_bitrix_pestana_mensajes(p_portal text, p_correo text, p_tipo text, p_id text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_q jsonb; v_f jsonb; v_todos jsonb;
begin
  v_q := public._conta_portal_bitrix_quien(p_portal, p_correo, p_tipo, p_id);
  if v_q->>'estado' <> 'ok' then return v_q; end if;
  begin
    v_f := public.conta_portal_ficha((v_q->>'cliente')::uuid);
  exception when sqlstate '42501' then
    return jsonb_build_object('estado', 'sin_acceso', 'frase', 'No puedes ver el portal de este cliente.');
  end;
  v_todos := coalesce(v_f->'mensajes', '[]'::jsonb);
  return jsonb_build_object('estado', 'ok',
    'total', jsonb_array_length(v_todos),
    'mensajes', coalesce((select jsonb_agg(jsonb_build_object('id', m->>'id', 'de', m->>'de', 'autor', m->>'autor',
                   'texto', left(coalesce(m->>'texto', ''), 600), 'adjuntos', jsonb_array_length(coalesce(m->'adjuntos', '[]'::jsonb)),
                   'cuando', m->>'cuando', 'leido', m->>'leido' is not null) order by o)
                 from (select m, o from jsonb_array_elements(v_todos) with ordinality x(m, o) order by o desc limit 6) u), '[]'::jsonb));
end $$;

revoke all on function public.conta_bitrix_pestana_mensajes(text, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_mensajes(text, text, text, text) to service_role;

comment on function public.conta_bitrix_pestana_mensajes(text, text, text, text) is
  'GB · nº 17, C · Los últimos 6 mensajes del portal del cliente de la ficha de Bitrix24, con su texto, para «Contestar» desde la pestaña. Solo el servidor, DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación. Como la persona, con conta_portal_ficha (Code 3). Solo lee.';
