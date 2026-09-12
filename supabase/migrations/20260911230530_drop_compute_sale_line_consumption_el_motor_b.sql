-- ════════════════════════════════════════════════════════════════════════
-- FUERA EL MOTOR B · `compute_sale_line_consumption`
--
-- APLICADA el 12/09/2026 a las 01:05:30 (Madrid, reloj de la base), detrás de
-- A4a. Versión registrada: 20260911230530.
--
-- Era el escritor por LINEA (`source_id = sale_line.id`), el que convivia con
-- el escritor por VENTA y producia los duplicados: los 516 que quedan hoy
-- nacieron asi el 25/08, un reproceso escribiendo el motor A encima de un
-- motor B que sobrevivio a la limpieza del 15/08. Con A4a el escritor unico
-- se lleva el motor viejo de cada venta que regenera, y con el corte delante;
-- dejar la funcion viva seria dejar la puerta por la que volvio a entrar.
--
-- BARRIDO (regla 18), rehecho tras aplicar A4a: no la llama NADIE — ni
-- funcion (`pg_proc.prosrc`) ni disparador (`pg_trigger`). El front tampoco:
-- solo aparece en `src/types/database.ts`, que es generado.
--
-- Postgres NO registra que una funcion nombre a otra dentro de su cuerpo, asi
-- que un `DROP` a secas no protege de nada: la dependencia se comprueba aqui,
-- a mano, y si aparece alguien la migracion se deshace entera.
-- ════════════════════════════════════════════════════════════════════════
DO $guarda$
DECLARE v_quien text; v_trg text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_quien
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname <> 'compute_sale_line_consumption'
     AND p.prosrc LIKE '%compute_sale_line_consumption%';
  IF v_quien IS NOT NULL THEN
    RAISE EXCEPTION 'DROP abortado: todavia la nombran -> %', v_quien;
  END IF;

  SELECT string_agg(t.tgname, ', ') INTO v_trg
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND p.prosrc LIKE '%compute_sale_line_consumption%';
  IF v_trg IS NOT NULL THEN
    RAISE EXCEPTION 'DROP abortado: disparadores que la nombran -> %', v_trg;
  END IF;

  -- Y que el escritor unico este realmente puesto antes de quitarle la
  -- alternativa. Quitar el motor B con el motor viejo vivo seria dejar el
  -- sistema en un estado que nadie ha ensayado.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='generate_sale_consumption'
                    AND md5(p.prosrc) = '6c04a3e1abaa035549d286315f6c893f') THEN
    RAISE EXCEPTION 'DROP abortado: A4a no esta puesta, el escritor unico no es el esperado';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public.compute_sale_line_consumption(uuid);

DO $verifica$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'compute_sale_line_consumption';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'El motor B sigue ahi: % firma(s)', v_n;
  END IF;
  RAISE NOTICE 'compute_sale_line_consumption fuera. Queda un solo escritor.';
END
$verifica$;
