-- C9 · Lote 2 §5 (04/09/2026). La purga, que es lo que hace verdad la columna.
--
-- «Una columna de retencion que no purga es una mentira con nombre de columna»
-- (regla F12). Esto es lo que la cumple.
--
-- DOS PIEZAS, y estan separadas a proposito:
--   `capturas_a_purgar()`  dice QUE hay que borrar. Es de solo lectura, asi que
--                          se puede mirar sin miedo antes de borrar nada.
--   `purgar_capturas()`    borra el OBJETO por pg_net y marca `purged_at`.
--
-- LA FILA NO SE BORRA, se marca. Queda de recibo de que la foto existio y de
-- que se borro: si alguien pregunta «¿y la evidencia del pedido X?», la
-- respuesta «se purgo el dia Y por plazo de Z dias» es mejor que el silencio.
--
-- HOLD_UNTIL SE RESPETA. Una foto adjunta a una reclamacion abierta (L4) no se
-- purga aunque haya cumplido el plazo. Es la excepcion obligatoria del encargo.
--
-- SIN PLAZO NO SE PURGA NADA de esa cuenta, igual que sin plazo no se captura:
-- si nadie ha decidido el plazo, esta funcion no se lo inventa.

create or replace function public.capturas_a_purgar(p_limite int default 500)
returns table (
  id uuid, account_id uuid, image_path text,
  captured_at timestamptz, dias_de_plazo int, dias_cumplidos int
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id, c.account_id, c.image_path, c.captured_at,
         ks.photo_retention_days,
         floor(extract(epoch from (now() - c.captured_at)) / 86400)::int
    from public.sale_capture c
    join public.kitchen_settings ks on ks.account_id = c.account_id
   where c.purged_at is null
     and ks.photo_retention_days is not null
     and c.captured_at < now() - (ks.photo_retention_days || ' days')::interval
     and (c.hold_until is null or c.hold_until <= now())
   order by c.captured_at
   limit greatest(1, p_limite);
$function$;

comment on function public.capturas_a_purgar(int) is
  'C9 L2 §5: que capturas TOCA purgar. Solo lectura: se puede mirar antes de borrar. Excluye las que tienen hold_until en el futuro (reclamacion abierta) y las cuentas sin photo_retention_days.';

create or replace function public.purgar_capturas(p_limite int default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_url      text;
  v_clave    text;
  v_borradas int := 0;
  v_fallos   int := 0;
  v_retenidas int;
  v_sin_plazo int;
  r          record;
begin
  select decrypted_secret into v_url   from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_clave from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_clave is null then
    -- Fallar en voz alta, no degradar a warning: pg_cron cuenta un warning como
    -- exito y tendriamos una purga «que va bien» sin borrar nada (regla 8).
    raise exception 'C9 L2: faltan project_url o service_role_key en Vault; la purga no puede borrar objetos.';
  end if;

  for r in select * from public.capturas_a_purgar(p_limite) loop
    begin
      perform net.http_delete(
        url := v_url || '/storage/v1/object/order-evidence/' || r.image_path,
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_clave, 'apikey', v_clave)
      );
      update public.sale_capture set purged_at = now() where id = r.id;
      v_borradas := v_borradas + 1;
    exception when others then
      v_fallos := v_fallos + 1;
      raise warning 'C9 L2 purga: fallo con % (%): %', r.image_path, sqlstate, sqlerrm;
    end;
  end loop;

  select count(*) into v_retenidas from public.sale_capture
   where purged_at is null and hold_until is not null and hold_until > now();

  select count(*) into v_sin_plazo from public.sale_capture c
   where c.purged_at is null
     and not exists (select 1 from public.kitchen_settings k
                      where k.account_id = c.account_id and k.photo_retention_days is not null);

  -- Se DEVUELVE el recuento y ademas se deja en el log: «cuantas borro» es un
  -- requisito del encargo, no una curiosidad.
  raise notice 'C9 L2 purga: % borradas, % fallos, % retenidas por reclamacion, % sin plazo',
    v_borradas, v_fallos, v_retenidas, v_sin_plazo;

  return jsonb_build_object(
    'borradas', v_borradas,
    'fallos', v_fallos,
    'retenidas_por_reclamacion', v_retenidas,
    'sin_plazo_definido', v_sin_plazo,
    'cuando', now()
  );
end;
$function$;

comment on function public.purgar_capturas(int) is
  'C9 L2 §5: borra el objeto del bucket y marca purged_at. Devuelve cuantas borro. Falla en voz alta si faltan los secretos: un warning lo contaria pg_cron como exito y tendriamos una purga que no purga.';

revoke all on function public.capturas_a_purgar(int) from public, anon, authenticated;
revoke all on function public.purgar_capturas(int)  from public, anon, authenticated;
grant execute on function public.capturas_a_purgar(int) to service_role;
grant execute on function public.purgar_capturas(int)  to service_role;

do $verif$
begin
  if has_function_privilege('anon', 'public.purgar_capturas(int)', 'EXECUTE') then
    raise exception 'C9 L2: anon puede ejecutar purgar_capturas.';
  end if;
  if has_function_privilege('authenticated', 'public.purgar_capturas(int)', 'EXECUTE') then
    raise exception 'C9 L2: authenticated puede ejecutar purgar_capturas.';
  end if;
end
$verif$;
