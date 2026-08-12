-- 20260812T1601_hubrise_matricula_namespaced.sql
-- Aplicada: 2026-08-12 por MCP (verificada: adapt_hubrise_order contiene hubrise_strip_ns)
--
-- (La 20260812T1600 se ABORTO sola: su guard esperaba 6 ocurrencias y hay 9.
--  El guard hizo su trabajo, no se aplico nada a medias. Esta es la corregida;
--  no existe fichero 1600 a proposito.)
--
-- ARREGLA: ningun pedido de HubRise casaba producto -> no descontaba stock.
--
-- CAUSA (verificada en produccion 12/08, pedido 4C6AA de The Urban Kebab):
-- HubRise devuelve sku_ref con NAMESPACE, tal y como lo publica Folvy:
--     "the-urban-kebab:61733146-cad7-4df8-a118-0eadc162e87f"   (por marca)
--     "shr_afa81c48-cc1c-4478-8578-b0e72c490b36"               (stock compartido)
-- pero adapt_hubrise_order buscaba menu_item.external_id = sku_ref LITERAL, y en
-- Folvy el external_id es solo el UUID. Resultado: 3 de 3 lineas 'unmapped'
-- (unmapped_reason='no_menu_item') y CERO consumo. 32 ventas asi en 7 dias.
-- Comprobado: quitando el prefijo casan 1 a 1; el compartido casa con 9 marcas y
-- desempata por brand_id del ticket (logica que la funcion YA tiene).
--
-- SOLUCION: normalizar la matricula ANTES de buscar. Se prueba primero el valor
-- literal (por si algun catalogo se publico sin namespace) y despues el UUID
-- limpio. Sustitucion QUIRURGICA sobre el cuerpo vivo: no se reescribe la funcion.
--
-- NO reejecutar contra produccion: ya esta aplicada (el guard de 9 ocurrencias
-- abortaria, porque el cuerpo vivo ya esta parcheado).

create or replace function public.hubrise_strip_ns(p_ref text)
returns text
language sql
immutable
as $$
  select case
    when p_ref is null then null
    when p_ref ~ '^shr_'   then regexp_replace(p_ref, '^shr_', '')
    when p_ref ~ '^[^:]+:' then regexp_replace(p_ref, '^[^:]+:', '')
    else p_ref
  end;
$$;

do $$
declare v_src text; v_new text; v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='adapt_hubrise_order';

  if v_src is null then
    raise exception 'adapt_hubrise_order no existe';
  end if;

  v_hits := (length(v_src) - length(replace(v_src, 'mi.external_id = v_matricula', '')))
            / length('mi.external_id = v_matricula');
  if v_hits <> 9 then
    raise exception 'esperaba 9 ocurrencias, encontradas %', v_hits;
  end if;

  v_new := replace(v_src,
    'mi.external_id = v_matricula',
    'mi.external_id in (v_matricula, public.hubrise_strip_ns(v_matricula))');

  execute v_new;
end $$;

do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='adapt_hubrise_order')
     not ilike '%hubrise_strip_ns%' then
    raise exception 'adapt_hubrise_order no quedo parcheada';
  end if;
end $$;
