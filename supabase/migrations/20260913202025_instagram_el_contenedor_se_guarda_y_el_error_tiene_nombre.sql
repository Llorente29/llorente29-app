-- ==========================================================================
-- INSTAGRAM: EL CONTENEDOR SE GUARDA, Y EL ERROR TIENE NOMBRE
--
-- Encargo de Julio, 13/09 21:30, con su correccion de las 21:55.
--
-- EL FALLO, medido: 10 publicaciones caidas con `error_subcode 2207027`
-- --«The media is not ready for publishing»-- desde el 17/07. Nueve acabaron
-- descartadas. No es el token: eso fueron otras cinco, del 07 al 12/09.
--
-- La causa esta en `social-publish/index.ts`: el paso 2 (`media_publish`) se
-- dispara justo despues del paso 1 (`/media`), sin esperar y sin preguntar
-- nada. Entre los dos, Instagram tiene que descargar y preparar la imagen. Es
-- una carrera, y unas veces se gana y otras no.
--
-- ESTA MIGRACION NO ARREGLA NADA POR SI SOLA: pone las dos columnas que el
-- arreglo necesita. La funcion va aparte y no esta desplegada todavia.
--
-- ── `ig_creation_id` ──────────────────────────────────────────────────────
-- La pieza que faltaba, y es la que hace que no se pierda NINGUNA. Hoy cada
-- reintento crea un contenedor NUEVO y abandona el anterior --que a lo mejor
-- ya estaba listo-- asi que a los 15 minutos se vuelve a correr contra el
-- mismo reloj. Guardado el identificador, la pasada siguiente no crea nada:
-- pregunta por ESE contenedor y lo publica si ya esta. Viven 24 h, o sea 96
-- pasadas del trabajo de cada cuarto de hora.
--
-- ── `error_kind` ──────────────────────────────────────────────────────────
-- Hoy la pantalla le enseña al dueño del negocio el volcado en bruto de Meta:
--
--   IG publish: {"message":"Media ID is not available","type":"OAuthException",
--   "code":9007,"error_subcode":2207027,...,"fbtrace_id":"ALRlpRLSwaI4ndtlU9LeWVv"}
--
-- Eso no se puede enseñar a un cliente, y ademas no dice que hacer. La
-- columna guarda una CLAVE --no una frase-- y la pantalla escribe la frase.
-- `last_error` se queda con el volcado tecnico, que pasa a vivir detras de un
-- «ver detalle»: que exista para quien lo arregla, no delante de sus ojos.
--
-- Las claves, y por que estas cinco: son las cuatro situaciones del encargo
-- mas la que no es un error.
--   esperando            · el contenedor aun no esta listo. NO es un fallo:
--                          se reintenta solo en la pasada siguiente, no gasta
--                          intento y no deja la publicacion en «error».
--   llave_caducada       · hay que renovar la conexion con Instagram.
--   imagen_no_descargable· Instagram no ha podido bajarse la foto.
--   rechazado            · Instagram dice que no, por otra cosa.
--   otro                 · lo que no encaje. Existe para no mentir con una
--                          etiqueta que no toca.
--
-- BANDA (regla nueva de Julio, 13/09 22:0x): a la madrugada solo va lo que
-- toma cierre exclusivo sobre una tabla DEL PEDIDO, contado. Esto toma
-- ACCESS EXCLUSIVE sobre `social_post`, y `social_post` no la lee ni la
-- escribe nada del camino del pedido: cero disparadores, cero funciones del
-- pedido, y sus dos crons son los de RRSS. Contado abajo, no supuesto.
-- ==========================================================================

BEGIN;

-- Un contenedor sin publicar, para no volver a empezar la carrera.
ALTER TABLE public.social_post
  ADD COLUMN IF NOT EXISTS ig_creation_id text;

COMMENT ON COLUMN public.social_post.ig_creation_id IS
  'Contenedor de Instagram ya creado y aun sin publicar. Vive 24 h. Si esta '
  'puesto, la pasada siguiente NO crea otro: pregunta por este. Se pone a NULL '
  'al publicar, y tambien cuando Instagram dice ERROR o EXPIRED.';

-- El nombre del problema, en clave. La frase la escribe la pantalla.
ALTER TABLE public.social_post
  ADD COLUMN IF NOT EXISTS error_kind text;

ALTER TABLE public.social_post
  DROP CONSTRAINT IF EXISTS social_post_error_kind_check;
ALTER TABLE public.social_post
  ADD CONSTRAINT social_post_error_kind_check
  CHECK (error_kind IS NULL OR error_kind = ANY (ARRAY[
    'esperando', 'llave_caducada', 'imagen_no_descargable', 'rechazado', 'otro'
  ]));

COMMENT ON COLUMN public.social_post.error_kind IS
  'CLAVE, no frase (las frases viven en el front). esperando · llave_caducada '
  '· imagen_no_descargable · rechazado · otro. `esperando` NO es un fallo: la '
  'publicacion sigue en cola y no ha gastado intento.';

-- -- HUELLA: las dos columnas, el candado, y que `social_post` no esta en el
-- -- camino del pedido. Se CUENTA, no se supone.
DO $huella$
DECLARE v_n int; v_trg int; v_fn int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='social_post'
     AND column_name IN ('ig_creation_id','error_kind');
  IF v_n <> 2 THEN RAISE EXCEPTION 'faltan columnas: hay %, no 2', v_n; END IF;

  -- El candado muerde: una clave inventada no entra.
  BEGIN
    UPDATE public.social_post SET error_kind = 'loquesea'
     WHERE id = (SELECT id FROM public.social_post LIMIT 1);
    RAISE EXCEPTION 'el candado de error_kind ha dejado pasar una clave inventada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Y la medida de la banda, contada: nada del pedido toca esta tabla.
  SELECT count(*) INTO v_trg FROM pg_trigger t
   WHERE t.tgrelid = 'public.social_post'::regclass AND NOT t.tgisinternal;
  SELECT count(*) INTO v_fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosrc ILIKE '%social_post%'
     AND p.proname IN ('compute_sale_line_cost','_sale_line_raw_consumption',
                       'close_sale','set_order_status','apply_sale_consumption');
  IF v_trg <> 0 OR v_fn <> 0 THEN
    RAISE EXCEPTION 'social_post SI esta en el camino del pedido: % disparadores, % funciones. Esto tenia que haber esperado a la madrugada.', v_trg, v_fn;
  END IF;

  RAISE NOTICE 'dos columnas puestas, el candado muerde, y social_post no esta en el camino del pedido (0 disparadores, 0 funciones)';
END;
$huella$;

COMMIT;
