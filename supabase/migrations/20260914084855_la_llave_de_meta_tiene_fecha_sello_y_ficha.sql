-- ═══════════════════════════════════════════════════════════════════════════
-- LA LLAVE DE META TIENE FECHA, SELLO Y FICHA
-- 14/09/2026 · Foodint 51ad1792-6629-4ef7-833a-b57b09a86710
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── LA VIDA DE LA LLAVE ESTÁ MEDIDA, NO SUPUESTA ──────────────────────────
--
-- `vault.secrets` dice que `ig_token_foodint` se creó el 06/07/2026 a la
-- 01:17:29 de Madrid, que es el 05/07 a las 16:17:29 PDT. Y Meta, en el
-- mensaje de error que dejó tumbada la publicación `36b5a3fb`, dice:
--
--     «Error validating access token: Session has expired on
--      Thursday, 03-Sep-26 16:12:45 PDT»
--
-- Del 05/07 16:17:29 PDT al 03/09 16:12:45 PDT hay SESENTA DÍAS menos cuatro
-- minutos. La llave vive 60 días, y no hace falta creerse ninguna
-- documentación para saberlo: lo dice Meta con su propio reloj. Y encaja con
-- el `linked_at: 2026-07-05` que la cuenta lleva escrito desde julio.
--
-- ── LOS NUEVE DÍAS Y VEINTE HORAS EN QUE NADIE LO DIJO ────────────────────
--
-- Caducó el 04/09 a la 01:12 de Madrid. Julio la renovó a mano el 13/09 a las
-- 21:12:27 (también de `vault.secrets`). En medio: nueve días y veinte horas.
--
-- Lo único que quedó de la avería fueron cinco publicaciones en `error` con el
-- mensaje de Meta dentro, que hay que ir a buscar de una en una. La fila de la
-- cuenta seguía diciendo `linked`. Y --esto es lo que más pesa-- NO HABÍA
-- NINGUNA PANTALLA donde mirarlo: `SocialSettingsPage` sólo tiene la fase del
-- lanzamiento y el panel de imagen, y nada en el front lee `link_status`.
--
-- O sea que la ficha no mentía: es que no había ficha. Corrijo lo que dije al
-- empezar este encargo, que fue «la ficha decía linked durante nueve días».
-- La FILA lo decía. Ficha, ninguna.
--
-- ── EL RAÍL PARA AVISAR YA EXISTÍA, Y LA LLAVE NO ESTABA EN ÉL ────────────
--
-- `secret_expiry` la lee `edge_drift_salud_watchdog` todos los días a las
-- 06:10 y avisa a los `dias_aviso` y en rojo a los `dias_critico`. Llevaba UNA
-- sola llave desde el 27/08: el PAT de Supabase. La de Meta nunca subió, y por
-- eso caducó en silencio.
--
-- ── LO QUE HACE ESTA MIGRACIÓN, Y LO QUE NO ───────────────────────────────
--
-- HACE (dos de las tres cosas del encargo):
--   · AVISAR ANTES: la llave sube al raíl, con 14 días de aviso y 5 de rojo.
--     No 30 como la de Supabase: esta vive 60 días y avisar con 30 sería
--     gritar media vida.
--   · QUE LA FICHA DIGA LA VERDAD: cuatro sellos en `social_account` y la RPC
--     `social_estado_de_la_cuenta` que los sirve. La pantalla y la edge
--     function que los escribe van en el mismo commit.
--
-- NO HACE: renovarla sola. Y no por falta de ganas, sino porque no he podido
-- confirmar el endpoint desde aquí. Está explicado en el parte: el sondeo con
-- una llave inválida NO distingue una ruta buena de una que no existe --Meta
-- valida la llave antes que la ruta y devuelve el mismo 400/código 190 en los
-- tres casos, medido--; y llamarlo con la llave de verdad no es una prueba,
-- porque emite una llave nueva.
--
-- ── LA BANDA ──────────────────────────────────────────────────────────────
-- El `ALTER TABLE` toma ACCESS EXCLUSIVE sobre `social_account`. Contado:
-- 0 funciones de la base la leen, 0 disparadores, 0 crons, 0 del camino del
-- pedido. No está en el camino de un pedido ni de lejos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ① EL SELLO DE LA LLAVE EN LA CUENTA ───────────────────────────────────
ALTER TABLE public.social_account
  ADD COLUMN IF NOT EXISTS llave_ok_at        timestamptz,
  ADD COLUMN IF NOT EXISTS llave_fallo_at     timestamptz,
  ADD COLUMN IF NOT EXISTS llave_fallo_clase  text,
  ADD COLUMN IF NOT EXISTS llave_caduca_el    timestamptz;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.social_account'::regclass
                    AND conname = 'social_account_llave_fallo_clase_valid') THEN
    -- Las mismas cinco claves que ya usa `social_post.error_kind`. Se escriben
    -- las cinco contemplando lo que se va a escribir: ese fue el fallo de A3 el
    -- 11/09 (un CHECK sin el valor nuevo, 23514, y el pedido al suelo).
    ALTER TABLE public.social_account
      ADD CONSTRAINT social_account_llave_fallo_clase_valid
      CHECK (llave_fallo_clase IS NULL OR llave_fallo_clase IN
             ('esperando','llave_caducada','imagen_no_descargable','rechazado','otro'));
  END IF;
END
$chk$;

COMMENT ON COLUMN public.social_account.llave_ok_at IS
  'Ultima vez que la llave funciono DE VERDAD contra Meta (se publico algo, o se leyo el estado de un contenedor). Es la unica prueba de que esta viva.';
COMMENT ON COLUMN public.social_account.llave_fallo_at IS
  'Ultima vez que Meta rechazo la llave.';
COMMENT ON COLUMN public.social_account.llave_fallo_clase IS
  'Que clase de fallo fue, con las mismas claves que social_post.error_kind.';
COMMENT ON COLUMN public.social_account.llave_caduca_el IS
  'Cuando caduca la llave, EN UTC. Derivado de la vida MEDIDA de 60 dias, no supuesto: ver la cabecera de la migracion.';

-- La llave de hoy: renovada a mano el 13/09 a las 19:12:27 UTC (vault.secrets,
-- 21:12:27 de Madrid) y 60 dias de vida MEDIDOS. 12/11/2026 19:12:27 UTC.
--
-- Va en UTC a proposito (regla 4). La primera version de esta linea decia
-- «+02», que es el desfase de Madrid en SEPTIEMBRE; el 12 de noviembre Madrid
-- ya esta en +01. El instante salia bien por llevar el desfase escrito, pero la
-- etiqueta habria hecho creer a quien la leyera que son las 21:12 de Madrid, y
-- son las 20:12.
UPDATE public.social_account
   SET llave_caduca_el = timestamptz '2026-11-12 19:12:27+00'
 WHERE network = 'instagram' AND link_status = 'linked'
   AND config->>'token_vault_name' = 'ig_token_foodint';

-- ── ② LA LLAVE SUBE AL RAIL QUE YA EXISTE ─────────────────────────────────
--
-- OJO: `caduca_el` es un `date`, no un instante. El rail trabaja por DIAS. Por
-- eso aqui va la fecha y en la ficha el instante, y el ensayo compara la fecha
-- con la fecha. Lo descubrio el propio ensayo, comparando los dos sitios: el
-- primer intento de esta migracion aborto con «El rail y la ficha no dicen la
-- misma fecha» y no escribio nada.
INSERT INTO public.secret_expiry
  (nombre, descripcion, caduca_el, dias_aviso, dias_critico, donde_renovar)
VALUES (
  'ig_token_foodint',
  'Llave de Instagram de Foodint (Vault). La usa social-publish para crear el contenedor, preguntar su estado y publicar. Vive 60 dias: MEDIDO, no supuesto (creada 05/07 16:17 PDT, Meta dijo que caduco el 03/09 16:12:45 PDT).',
  date '2026-11-12',
  14, 5,
  'Meta -> app Folvy Social -> generar una llave de larga duracion nueva y guardarla en el Vault con el nombre ig_token_foodint. Despues: UPDATE public.secret_expiry SET caduca_el = <la fecha de renovacion + 60 dias> WHERE nombre = ''ig_token_foodint''; y UPDATE public.social_account SET llave_caduca_el = <el mismo instante> WHERE config->>''token_vault_name'' = ''ig_token_foodint'';'
)
ON CONFLICT (nombre) DO UPDATE
   SET caduca_el = EXCLUDED.caduca_el,
       descripcion = EXCLUDED.descripcion,
       dias_aviso = EXCLUDED.dias_aviso,
       dias_critico = EXCLUDED.dias_critico,
       donde_renovar = EXCLUDED.donde_renovar;

-- ── ③ LA FICHA, QUE HOY NO EXISTE EN NINGUNA PANTALLA ─────────────────────
--
-- Devuelve CLAVES, no frases: el castellano vive en `lib/`. Y no devuelve la
-- llave ni un trozo de ella: lo unico que se dice de ella es si funciona,
-- cuando fallo y cuando caduca.
CREATE OR REPLACE FUNCTION public.social_estado_de_la_cuenta(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  v jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'red',            sa.network,
           'enlazada',       (sa.link_status = 'linked'),
           'enlazada_el',    sa.config->>'linked_at',
           'usuario',        sa.config->>'ig_user_id',
           -- Nunca la llave. Solo su NOMBRE en el Vault, que no es un secreto
           -- y es lo que hace falta para ir a renovarla.
           'llave_nombre',   sa.config->>'token_vault_name',
           'llave_ok_at',    sa.llave_ok_at,
           'llave_fallo_at', sa.llave_fallo_at,
           'llave_fallo_clase', sa.llave_fallo_clase,
           'llave_caduca_el',   sa.llave_caduca_el,
           -- Se cuentan aqui para que la pantalla no tenga que restar fechas:
           -- una cuenta hecha en dos sitios se despega en uno de los dos.
           'dias_para_caducar', case when sa.llave_caduca_el is null then null
                                     else (sa.llave_caduca_el::date - current_date) end,
           -- Lo ultimo que se publico de verdad. Es la otra mitad de la prueba:
           -- una llave «sin fallos» que no ha publicado nunca no dice nada.
           'ultima_publicacion', (
             select max(sp.published_at) from social_post sp
              where sp.account_id = p_account and sp.social_account_id = sa.id
                and sp.status = 'published')
         ) order by sa.network), '[]'::jsonb)
    into v
    from social_account sa
   where sa.account_id = p_account;

  return jsonb_build_object('cuentas', v);
end;
$fn$;

REVOKE ALL ON FUNCTION public.social_estado_de_la_cuenta(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.social_estado_de_la_cuenta(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.social_estado_de_la_cuenta(uuid) TO authenticated, service_role;
