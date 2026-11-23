-- supabase/migrations/20261123T0801_x28_banco_con_marca.sql
-- cambia: public._bank_casar_nucleo · prueba: supabase/staging/sql/20261123_x28_tesoreria_prueba.sql
-- cambia: public.conta_banco_a_mano · prueba: supabase/staging/sql/20261123_x28_tesoreria_prueba.sql
--
-- X28 · Tesorería como ERP10 (respuesta X28 · 1, decisión 1): la línea de edición lleva local, marca y plataforma, y
-- la base las acepta igual que hoy el local. Marca y plataforma, solo en una empresa de hostelería (sector).
--
--   1. _bank_casar_nucleo: un trozo exacto (como el R08, 2040), sin cambiar su firma. Si el destino trae
--      «marca_id» o «canal_id», cada línea del asiento que propone las lleva (como ya lleva el local). Sin ellas,
--      el asiento sale igual que hoy, byte a byte.
--   2. conta_banco_a_mano: la MISMA firma (sin DROP: la regla 2 no llega a aplicarse) y sin lógica propia. Llama a
--      conta_tesoreria_a_mano (0800) con el local, la marca y la plataforma vacíos: contabilizar a mano se hace en un
--      solo sitio (respuesta X28 · 2, punto 1). El front publicado, que la lee (emitidas y bancos), sigue igual: la
--      misma frase y el mismo asiento. Se borra cuando emitidas y bancos dejen de llamarla, en dos pasos.
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: el trozo al revés y conta_banco_a_mano con su cuerpo de antes.

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

-- 2 · conta_banco_a_mano: la misma firma, sin lógica propia: llama a conta_tesoreria_a_mano ------------------------------
-- La de antes, guardada (la vuelta atrás la restaura de aquí, con su huella).
select public._respaldar_funcion('public.conta_banco_a_mano(uuid,date,text,text,numeric,text)', '20261123T0801_x28_banco_con_marca');
create or replace function public.conta_banco_a_mano(p_banco uuid, p_fecha date, p_cuenta text, p_concepto text, p_importe numeric, p_quien_nombre text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public'
as $function$
  select public.conta_tesoreria_a_mano(p_banco, p_fecha, p_cuenta, p_concepto, p_importe, p_quien_nombre, null, null, null)
$function$;
comment on function public.conta_banco_a_mano(uuid, date, text, text, numeric, text) is
  'E05 · X28 · «Escribir uno a mano» de siempre: llama a conta_tesoreria_a_mano sin analítica (común), que es donde se contabiliza a mano. Se borra cuando emitidas y bancos dejen de llamarla.';
