-- 20260910175605_conteo_p16_el_packaging_es_almacen.sql
--
-- EL PACKAGING ES ALMACÉN (barrido, 10/09 por la noche)
--
-- Julio, mirando Alcalá después de la p14: «6.- Packaging · 0 art · 0 €. Si no
-- sale en almacén, ¿dónde se registra? Es muy chapuza.» Tiene razón, y no se
-- arregla función a función según vayan saliendo.
--
-- EL CRITERIO, escrito para que no haya que volver a discutirlo: el packaging
-- ES almacén, igual que un ingrediente. Entra, se cuenta, se descuenta y SE VE.
-- Solo se queda fuera donde no tenga sentido — alérgenos y fichas técnicas de
-- proveedor, que hablan de comida.
--
-- Estas cuatro son las de stock. Las demás van en el parte, una a una, con lo
-- que hace cada una y por qué entra o no.
--
-- LA CIFRA QUE SALE ES FALSA, Y SE ENSEÑA IGUAL (regla 11): el packaging de
-- Alcalá vale hoy 31.446,73 € en libros —las 149.250 bolsas— frente a 3.330 €
-- de ingredientes. Esconderla no arregla nada: es lo que Folvy cree hoy, y hasta
-- el recuento de apertura seguirá siéndolo.
--
-- MEDIDO, la cabecera de la zona en Alcalá:
--   antes   «6.- Packaging ·  0 art ·      0,00 €»
--   ahora   «6.- Packaging · 56 art · 31.446,73 €»
--
-- POR QUÉ ESTE FICHERO LLEVA LA TRANSFORMACIÓN Y NO EL CUERPO LITERAL, que es
-- lo contrario de lo que se hace en las demás: las cuatro se definen en
-- ficheros del formato VIEJO (20260617T1200, 20260617T2100, 20260810T1000),
-- que están entre los 739 que la reconstrucción del 05/09 no llegó a tocar.
-- Sacar de ahí un cuerpo literal sería copiar de una fuente que ya no es la
-- verdad. El md5 contra `pg_proc` es lo que fija el resultado:
--
--   negative_stock_report   4be0433c6e1c542b19877b9d84f1968f   4.295
--   stock_levels_overview   95d326874eea79eda16ff0ab313c0995   1.914
--   storage_coverage        65c96ff9153108e0361a338b2961976c   3.487
--   storage_orphans         74dba45644e0dac689a6495a6d99ce5a   2.144

BEGIN;

DO $patch$
DECLARE
  v_nombre text;
  v_def    text;
  v_viejo  text := 'ri.type = ''raw''';
  v_nuevo  text := 'ri.type IN (''raw'', ''packaging'')';
  v_n      integer;
BEGIN
  FOREACH v_nombre IN ARRAY ARRAY[
    'storage_coverage',       -- la cabecera de cada zona en Almacén
    'storage_orphans',        -- artículos sin zona asignada
    'stock_levels_overview',  -- niveles de stock por local
    'negative_stock_report'   -- el vigía de stock negativo
  ]
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_nombre;
    IF v_def IS NULL THEN RAISE EXCEPTION 'No existe %', v_nombre; END IF;

    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: esperaba 1 filtro de tipo, encontrados %', v_nombre, v_n;
    END IF;

    EXECUTE replace(v_def, v_viejo, v_nuevo);
  END LOOP;
END;
$patch$;

COMMIT;
