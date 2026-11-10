-- supabase/migrations/20261110T0040_gb_bitrix_campos.sql
--
-- GB · nº 13, punto 1 · «Trabajadores» y «Estado del cobro» en la ficha de
-- Bitrix24, además de la «Cuota mensual», al guardar un cambio desde la pestaña.
--
-- Solo añade una función, y no cambia nada de lo que ya existe:
--   conta_bitrix_pestana_campos(cambio): solo el servidor (conta-bitrix-pestana),
--   después de un cambio hecho desde la pestaña. Dice, para la ficha de ese
--   cambio, qué campo de Bitrix24 es cada uno y lo último que escribió la
--   pestaña en él (para no pisar nunca un dato cambiado en Bitrix24):
--     · el campo, del mapa de la conexión (campo «trabajadores» o
--       «estado_cobro»); si el mapa aún no lo tiene (un mapa confirmado antes
--       del nº 13), el campo propio medido del portal que se llama así
--       («Trabajadores», «Nº de trabajadores», «Estado del cobro»);
--     · lo último escrito: conta_bitrix_pestana_cambio.bitrix → campos → <campo> → escrito.
-- No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0040_gb_bitrix_campos.down.sql

create or replace function public.conta_bitrix_pestana_campos(p_cambio uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_c public.conta_bitrix_pestana_cambio; v_crm public.conta_crm;
  v_out jsonb := '{}'::jsonb; v_campo text; v_patron text; v_codigo text; v_escrita text;
begin
  select * into v_c from public.conta_bitrix_pestana_cambio where id = p_cambio;
  if v_c.id is null then return v_out; end if;
  select * into v_crm from public.conta_crm where account_id = v_c.account_id and crm = 'bitrix24';
  for v_campo, v_patron in
    select * from (values ('trabajadores', '^(n(u|ú)mero de |nº de |no\.? de )?trabajadores$'), ('estado_cobro', '^estado del cobro$')) q(c, p)
  loop
    v_codigo := null; v_escrita := null;
    select x->>'codigo' into v_codigo from jsonb_array_elements(coalesce(v_crm.mapa->'campos', '[]'::jsonb)) x
     where x->>'campo' = v_campo and coalesce(x->>'codigo', '') <> '' limit 1;
    if v_codigo is null then
      select k into v_codigo from jsonb_each(coalesce(v_crm.campos_medidos, '{}'::jsonb)) m(k, f)
       where k like 'UF\_CRM\_%' and lower(trim(coalesce(nullif(f->>'formLabel', ''), nullif(f->>'listLabel', ''), f->>'title', ''))) ~ v_patron
       order by k limit 1;
    end if;
    select b.bitrix->'campos'->v_campo->>'escrito' into v_escrita from public.conta_bitrix_pestana_cambio b
     where b.account_id = v_c.account_id and b.tipo_ficha = v_c.tipo_ficha and b.id_externo = v_c.id_externo
       and (b.bitrix->'campos'->v_campo) ? 'escrito'
     order by b.bitrix_at desc nulls last limit 1;
    v_out := v_out || jsonb_build_object(v_campo, jsonb_build_object('campo', v_codigo, 'escrita', v_escrita));
  end loop;
  return v_out;
end $$;

revoke all on function public.conta_bitrix_pestana_campos(uuid) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_campos(uuid) to service_role;

comment on function public.conta_bitrix_pestana_campos(uuid) is
  'GB (nº 13) · Para un cambio hecho desde la pestaña de Bitrix24: qué campo de Bitrix24 es «Trabajadores» y «Estado del cobro» (del mapa de la conexión o, si aún no lo tiene, el medido que se llama así) y lo último que escribió la pestaña en cada uno. Solo el servidor (conta-bitrix-pestana).';
