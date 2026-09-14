-- ═══════════════════════════════════════════════════════════════════════════
-- #30 · GUARDAR LA LLAVE RENOVADA, EN UN SOLO PASO Y COMPROBÁNDOLO · 14/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── LO QUE DICE LA PÁGINA DE META, QUE AHORA SÍ TENEMOS ───────────────────
--
-- «Actualizar un identificador de acceso», actualizada el 17/07/2025:
--
--     GET https://graph.instagram.com/refresh_access_token
--         ?grant_type=ig_refresh_token
--         &access_token=<LONG_LIVED_ACCESS_TOKEN>
--
--     { "access_token": "...", "token_type": "bearer", "expires_in": 5183944 }
--
-- `expires_in` es un ENTERO en segundos. 5.183.944 s son 59,999 días: los
-- identificadores actualizados valen 60 días DESDE QUE SE ACTUALIZAN.
--
-- ── 🔴 LA PRECONDICIÓN QUE MANDA EN TODO EL DISEÑO ────────────────────────
--
-- Literal de Meta: «Actualiza un identificador de larga duración que tenga MÁS
-- DE 24 HORAS pero que NO HAYA CADUCADO».
--
-- Una llave caducada NO SE PUEDE RENOVAR. Si se pasa la fecha, el renovador
-- automático no sirve para nada nunca más y hay que generarla a mano en Meta,
-- como el 13/09. O sea que esto no es una comodidad: es lo único que impide
-- repetir los nueve días y veinte horas de silencio.
--
-- ── 🔴 Y LA CORRECCIÓN QUE CAMBIA DÓNDE VIVE EL RIESGO ────────────────────
--
-- Yo había escrito, y el PM me lo corrigió trayendo la página: «la llave vieja
-- sigue valiendo hasta su fecha original». **Meta no dice eso.** La página no
-- se pronuncia sobre qué pasa con la anterior.
--
-- O sea que NO se puede dar por hecho que si Meta devuelve una llave y nosotros
-- no la guardamos, la vieja sigue sirviendo. Ese es el único caso en que este
-- arreglo puede dejar la cuenta PEOR que antes.
--
-- Por eso esta RPC existe, y por eso hace las cuatro cosas en UNA transacción:
--
--   1. escribe la llave en el Vault
--   2. la LEE de vuelta y la compara --si no coincide, revienta--
--   3. mueve `secret_expiry.caduca_el`
--   4. mueve `social_account.llave_caduca_el`
--
-- Si cualquiera de las cuatro falla, se caen las cuatro. Dentro de la base,
-- «Meta dio llave y se perdió» no puede pasar: o está todo, o no está nada.
--
-- Lo que sí queda fuera, y por eso el que llama tiene que gritar: que Meta
-- devuelva llave y esta llamada no llegue (red, edge caída). Eso es un CRÍTICO
-- inmediato, y va en la edge function, no aquí.
--
-- ── Y ESO NO ES UNA PROMESA: SE PROBÓ SIN QUERER ──────────────────────────
--
-- El primer intento de aplicar esta migración falló por una tontería --una
-- constante del ensayo se llamaba `NOMBRE` y chocaba con la columna `nombre`,
-- error 42702-- PERO falló DESPUÉS de que el ensayo hubiera escrito la llave
-- falsa en el Vault de producción. Se comprobó al instante: la función no
-- existía, el Vault tenía 187 caracteres con forma de llave de Meta, la huella
-- md5 era la de siempre, `caduca_el` seguía en 2026-11-12 y `llave_ok_at`
-- seguía en NULL. Todo revertido. La atomicidad no es una suposición: se vio.
--
-- ── LA LLAVE NO SALE POR NINGÚN SITIO ─────────────────────────────────────
--
-- Ni entera, ni sus primeros caracteres, ni su longitud. Lo que devuelve son
-- banderas y fechas, y el ensayo lo comprueba con una llave de mentira que
-- tiene forma de llave de Meta a propósito.

create or replace function public.social_llave_renovada(
  p_nombre   text,
  p_llave    text,
  p_segundos int default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_id       uuid;
  v_leida    text;
  v_caduca   timestamptz;
  v_filas_se int := 0;
  v_filas_sa int := 0;
begin
  if p_llave is null or length(p_llave) = 0 then
    raise exception 'no se guarda una llave vacia' using errcode = '22023';
  end if;

  select s.id into v_id from vault.secrets s where s.name = p_nombre;
  if v_id is null then
    raise exception 'no hay ningun secreto llamado % en el Vault', p_nombre using errcode = '42704';
  end if;

  -- 1 · se escribe
  perform vault.update_secret(v_id, new_secret := p_llave);

  -- 2 · y se COMPRUEBA leyendola de vuelta. Sin esto, «guardada» es una
  --     suposicion, que es justo lo que no puede ser aqui.
  select d.decrypted_secret into v_leida from vault.decrypted_secrets d where d.id = v_id;
  if v_leida is distinct from p_llave then
    raise exception 'la llave se escribio pero no se lee igual: el Vault no la ha guardado'
      using errcode = '25000';
  end if;

  -- 3 y 4 · las fechas, solo si Meta dijo cuanto dura. Si no vino un numero,
  --         no se inventa: se deja la fecha vieja y se dice que no se movio.
  if p_segundos is not null and p_segundos > 0 then
    v_caduca := now() + make_interval(secs => p_segundos);

    update public.secret_expiry se
       set caduca_el = (v_caduca at time zone 'Europe/Madrid')::date,
           actualizado_at = now()
     where se.nombre = p_nombre;
    get diagnostics v_filas_se = row_count;

    update public.social_account sa
       set llave_caduca_el = v_caduca,
           llave_ok_at     = now(),
           updated_at      = now()
     where sa.config->>'token_vault_name' = p_nombre;
    get diagnostics v_filas_sa = row_count;
  end if;

  return jsonb_build_object(
    'guardada',           true,
    'comprobada',         true,
    'caduca_actualizada', (p_segundos is not null and p_segundos > 0),
    'caduca_el',          v_caduca,
    'segundos',           p_segundos,
    'filas_secret_expiry',  v_filas_se,
    'filas_social_account', v_filas_sa);
end;
$fn$;

revoke all on function public.social_llave_renovada(text, text, int) from public;
revoke execute on function public.social_llave_renovada(text, text, int) from anon, authenticated;
grant execute on function public.social_llave_renovada(text, text, int) to service_role;

-- ── ENSAYO · por el CAMINO DE ESCRITURA, contra el Vault de verdad ────────
do $ensayo$
declare
  v_nom   constant text := 'ig_token_foodint';
  v_falsa constant text := 'IG' || repeat('Qx7_', 46);   -- forma de llave de Meta, a proposito
  v_md5_antes text;
  v_res    jsonb;
  v_leida  text;
  v_cad_se date;
  v_cad_sa timestamptz;
  v_ok     boolean;
begin
  select md5(d.decrypted_secret) into v_md5_antes
    from vault.decrypted_secrets d where d.name = v_nom;
  if v_md5_antes is null then
    raise exception 'ENSAYO ABORTADO: no se encuentra % en el Vault', v_nom;
  end if;

  -- ── A · el camino entero, con los segundos que da Meta en su ejemplo.
  v_res := public.social_llave_renovada(v_nom, v_falsa, 5183944);

  if (v_res->>'guardada')::boolean is not true or (v_res->>'comprobada')::boolean is not true then
    raise exception 'A · deberia decir guardada y comprobada, y dice %', v_res;
  end if;

  -- ── B · esta de verdad en el Vault, no solo dicho.
  select d.decrypted_secret into v_leida from vault.decrypted_secrets d where d.name = v_nom;
  if v_leida <> v_falsa then
    raise exception 'B · el Vault no tiene lo que se le escribio';
  end if;

  -- ── C · las dos fechas se han movido a ~60 dias.
  select se.caduca_el into v_cad_se from public.secret_expiry se where se.nombre = v_nom;
  select sa.llave_caduca_el into v_cad_sa from public.social_account sa
   where sa.config->>'token_vault_name' = v_nom;
  if v_cad_se is distinct from ((now() + interval '5183944 seconds') at time zone 'Europe/Madrid')::date then
    raise exception 'C · secret_expiry no se movio a 60 dias: %', v_cad_se;
  end if;
  if v_cad_sa is null or v_cad_sa < now() + interval '59 days' then
    raise exception 'C · social_account.llave_caduca_el no se movio: %', v_cad_sa;
  end if;
  if (v_res->>'filas_secret_expiry')::int <> 1 or (v_res->>'filas_social_account')::int <> 1 then
    raise exception 'C · deberia tocar una fila de cada y toco %', v_res;
  end if;

  -- ── D · 🔴 LA LLAVE NO SALE EN LO QUE DEVUELVE. La falsa tiene forma de
  --        llave de Meta justamente para que esta comprobacion valga algo.
  if v_res::text ~ '(IG|EAA)[A-Za-z0-9_-]{20,}' or position(v_falsa in v_res::text) > 0 then
    raise exception 'D · LA LLAVE SE HA COLADO EN LA RESPUESTA';
  end if;

  -- ── E · sin segundos NO se inventa fecha, pero la llave SI se guarda: que
  --        Meta no diga cuanto dura no es motivo para tirar una llave buena.
  update public.secret_expiry se set caduca_el = date '2026-11-12' where se.nombre = v_nom;
  v_res := public.social_llave_renovada(v_nom, v_falsa || 'zz', null);
  if (v_res->>'guardada')::boolean is not true then
    raise exception 'E · sin segundos deberia guardar igual y dice %', v_res;
  end if;
  if (v_res->>'caduca_actualizada')::boolean is not false then
    raise exception 'E · sin segundos NO deberia mover la fecha y dice %', v_res;
  end if;
  select se.caduca_el into v_cad_se from public.secret_expiry se where se.nombre = v_nom;
  if v_cad_se <> date '2026-11-12' then
    raise exception 'E · se ha inventado una fecha: %', v_cad_se;
  end if;

  -- ── F · un nombre que no existe revienta y no escribe nada.
  begin
    v_ok := false;
    perform public.social_llave_renovada('no_existe_este_secreto', v_falsa, 100);
    v_ok := true;
  exception when others then
    if sqlstate <> '42704' then raise; end if;
  end;
  if v_ok then raise exception 'F · un secreto inexistente deberia reventar y no reviento'; end if;

  -- ── G · una llave vacia tampoco pasa.
  begin
    v_ok := false;
    perform public.social_llave_renovada(v_nom, '', 100);
    v_ok := true;
  exception when others then
    if sqlstate <> '22023' then raise; end if;
  end;
  if v_ok then raise exception 'G · una llave vacia deberia reventar y no reviento'; end if;

  raise notice 'ENSAYO OK · A,B,C (escribe, comprueba, mueve fechas) D (no sale la llave) E (sin segundos no inventa) F,G (guardas)';
  raise exception 'FIN DEL ENSAYO';
exception
  when others then
    if sqlerrm = 'FIN DEL ENSAYO' then
      raise notice 'ensayo revertido';
    else
      raise;
    end if;
end;
$ensayo$;

-- ── LA LLAVE BUENA SIGUE AHÍ. Se comprueba DESPUÉS del rollback, porque la
--    aserción que importa no es «el ensayo pasó» sino «no me he cargado la
--    llave de producción ensayando».
do $despues$
declare v_md5 text; v_cad date; v_ok_at timestamptz;
begin
  select md5(d.decrypted_secret) into v_md5 from vault.decrypted_secrets d where d.name = 'ig_token_foodint';
  select se.caduca_el into v_cad from public.secret_expiry se where se.nombre = 'ig_token_foodint';
  select sa.llave_ok_at into v_ok_at from public.social_account sa
   where sa.config->>'token_vault_name' = 'ig_token_foodint';

  if v_md5 is null then
    raise exception 'EL ENSAYO SE HA LLEVADO LA LLAVE POR DELANTE';
  end if;
  if v_md5 = md5('IG' || repeat('Qx7_', 46)) then
    raise exception 'EL VAULT SE HA QUEDADO CON LA LLAVE FALSA DEL ENSAYO';
  end if;
  if v_cad <> date '2026-11-12' then
    raise exception 'la fecha de caducidad no ha vuelto a su sitio: %', v_cad;
  end if;
  if v_ok_at is not null then
    raise exception 'el ensayo ha dejado sellada la llave, y no se ha publicado nada: %', v_ok_at;
  end if;
  raise notice 'la llave de produccion intacta (huella %), caduca %, sin sello falso', left(v_md5, 8), v_cad;
end;
$despues$;
