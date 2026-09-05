-- 20260812T1602_hubrise_matricula_sin_filtro_fuente.sql
-- Segunda mitad del arreglo de la 1601.
--
-- Tras normalizar el namespace, las lineas SEGUIAN sin casar. Causa verificada:
-- adapt_hubrise_order exige mi.external_source = 'hubrise', pero los productos
-- de Folvy se importaron de Last y tienen external_source = 'lastapp'.
--   Kebab de Falafel        -> external_source 'lastapp', external_id 61733146-...
--   HubRise devuelve sku_ref 'the-urban-kebab:61733146-...'
-- Es el MISMO id: HubRise solo lo publica con namespace. Exigir la fuente
-- 'hubrise' descarta todo el catalogo real.
--
-- SOLUCION: la matricula identifica al producto por si sola; no hace falta
-- filtrar por fuente. Se mantiene el desempate por brand_id cuando la matricula
-- casa con varias marcas (caso de los compartidos 'shr_').
--
-- Sustitucion QUIRURGICA con guard de ocurrencias sobre el cuerpo vivo.

do $$
declare v_src text; v_new text; v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='adapt_hubrise_order';

  if v_src is null then
    raise exception 'adapt_hubrise_order no existe';
  end if;

  v_hits := (length(v_src) - length(replace(v_src, 'mi.external_source = ''hubrise''', '')))
            / length('mi.external_source = ''hubrise''');
  if v_hits <> 9 then
    raise exception 'esperaba 9 ocurrencias del filtro de fuente, encontradas %', v_hits;
  end if;

  -- Neutraliza el filtro conservando la estructura del WHERE.
  v_new := replace(v_src, 'mi.external_source = ''hubrise''', 'true');
  execute v_new;
end $$;

do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='adapt_hubrise_order';
  if v_src ilike '%external_source = ''hubrise''%' then
    raise exception 'el filtro de fuente sigue presente';
  end if;
  if v_src not ilike '%hubrise_strip_ns%' then
    raise exception 'se perdio la normalizacion de namespace';
  end if;
end $$;