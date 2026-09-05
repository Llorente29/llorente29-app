-- 20260812T1138_tpv_pos_item_config_disponibilidad_real.sql
-- ENCARGO CODE — TPV: leer la disponibilidad de donde debe.
--
-- SINTOMA (Julio): "el TPV tiene muchas cosas agotadas y es falso". Confirmado.
-- pos_item_config filtraba por mi.is_available (columna muerta, importada de
-- Last: su 'enabled' significa "fuera de esta carta", NO "agotado"). Y ademas
-- el filtro era GLOBAL, sin location_id.
--
-- MEDIDO EN PRODUCCION (12/08): 521 productos activos, 149 bloqueados por el
-- filtro viejo, 3 agotados reales -> ~146 productos que el camarero NO PODIA
-- ABRIR (la funcion devuelve null, no los pinta en gris).
-- Con el predicado nuevo: Alcala 149 -> 3 · Carabanchel 138 -> 0 (aislamiento
-- por local confirmado).
--
-- Los 3 de Alcala: Nachos con Todo, Nachos con Guacamole y Totopos con
-- Guacamole. El tercero es de OTRA marca y comparte recipe_item_id con el
-- segundo: mismo guacamole agotado, luego bloquearlo es correcto. (El encargo
-- decia 2; Code lo corrigio a 3 validando contra datos reales.)
--
-- Sustitucion QUIRURGICA sobre el cuerpo vivo con guard de ocurrencia unica.

do $$
declare v_src text; v_new text; v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='pos_item_config';

  if v_src is null then
    raise exception 'pos_item_config no existe';
  end if;

  v_hits := (length(v_src) - length(replace(v_src, 'and mi.is_available is not false', '')))
            / length('and mi.is_available is not false');
  if v_hits <> 1 then
    raise exception 'esperaba 1 ocurrencia del filtro, encontradas %', v_hits;
  end if;

  v_new := replace(v_src,
    'and mi.is_available is not false',
    'and not exists (
       select 1 from product_availability pa
        where pa.account_id = mi.account_id
          and pa.is_available = false
          and (pa.available_until is null or pa.available_until > now())
          and (pa.location_id = p_location_id or pa.location_id is null)
          and ((mi.external_id is not null and pa.external_id = mi.external_id)
            or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id))
     )');

  execute v_new;
end $$;

do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='pos_item_config';
  if v_src ilike '%is_available is not false%' then
    raise exception 'el filtro viejo sigue presente';
  end if;
  if v_src not ilike '%product_availability%' then
    raise exception 'no quedo la fuente correcta';
  end if;
end $$;

notify pgrst, 'reload schema';