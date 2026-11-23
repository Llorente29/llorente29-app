-- supabase/migrations/20261123T0801_x28_banco_con_marca.sql
-- cambia: public._bank_casar_nucleo · prueba: supabase/staging/sql/20261123_x28_tesoreria_prueba.sql
--
-- X28 · Tesorería como ERP10 (respuesta X28 · 1, decisión 1): la línea de edición lleva local, marca y plataforma, y
-- la base las acepta igual que hoy el local. Marca y plataforma, solo en una empresa de hostelería (sector).
--
--   1. _bank_casar_nucleo: un trozo exacto (como el R08, 2040), sin cambiar su firma. Si el destino trae
--      «marca_id» o «canal_id», cada línea del asiento que propone las lleva (como ya lleva el local). Sin ellas,
--      el asiento sale igual que hoy, byte a byte.
--   El «a mano» con local, marca y plataforma es una función NUEVA (conta_tesoreria_a_mano, en la 0800): así
--   conta_banco_a_mano no cambia de firma, no hay DROP (la regla 2 no llega a aplicarse) y el front publicado, que la
--   lee (emitidas y bancos), sigue igual.
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: el trozo al revés.

-- 1 · _bank_casar_nucleo: marca y plataforma en las líneas, si el destino las trae ------------------------------------
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
  if strpos(v_def, 'X28 · marca y plataforma') = 0 then
    if (length(v_def) - length(replace(v_def, a_viejo, ''))) / length(a_viejo) <> 1 then
      raise exception 'X28 · 0801: _bank_casar_nucleo no es la medida (su trozo no está una sola vez): no se toca.';
    end if;
    execute replace(v_def, a_viejo, a_nuevo);
  end if;
end $do$;
revoke all on function public._bank_casar_nucleo(uuid, jsonb, text, text, jsonb, text, uuid) from public, anon, authenticated, service_role;
