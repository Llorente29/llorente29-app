-- supabase/vuelta-atras/20261123T0801_x28_banco_con_marca.down.sql
--
-- X28 · Vuelta atrás de la 0801: _bank_casar_nucleo sin el trozo de la marca y la plataforma (el trozo al revés).
-- Los asientos ya escritos con marca o plataforma se quedan como están.

do $do$
declare
  v_def text;
  a_viejo text := $v$    v_res := public._journal_entry_proponer(v_m.company_id,$v$;
  a_nuevo text := $n$    -- X28 · marca y plataforma: en cada línea, si el destino las trae (solo una empresa de hostelería).
    if nullif(p_destino->>'marca_id', '') is not null or nullif(p_destino->>'canal_id', '') is not null then
      if (select c.sector from public.company c where c.id = v_m.company_id) is distinct from 'hosteleria' then
        raise exception 'La marca y la plataforma son de una empresa de hostelería: esta no lo es.' using errcode = '22023';
      end if;
      select jsonb_agg(x || jsonb_strip_nulls(jsonb_build_object('marca_id', nullif(p_destino->>'marca_id', ''), 'canal_id', nullif(p_destino->>'canal_id', '')))
                       order by n)
        into v_lineas from jsonb_array_elements(v_lineas) with ordinality t(x, n);
    end if;
    v_res := public._journal_entry_proponer(v_m.company_id,$n$;
begin
  v_def := pg_get_functiondef('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)'::regprocedure);
  if strpos(v_def, 'X28 · marca y plataforma') > 0 then
    if (length(v_def) - length(replace(v_def, a_nuevo, ''))) / length(a_nuevo) <> 1 then
      raise exception 'X28 · vuelta atrás de la 0801: el trozo de _bank_casar_nucleo no está una sola vez: no se toca.';
    end if;
    execute replace(v_def, a_nuevo, a_viejo);
  end if;
end $do$;
revoke all on function public._bank_casar_nucleo(uuid, jsonb, text, text, jsonb, text, uuid) from public, anon, authenticated, service_role;
