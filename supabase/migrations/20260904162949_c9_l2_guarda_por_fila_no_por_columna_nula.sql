-- C9 · Lote 2 §5/§6, guarda corregida (04/09/2026).
--
-- EL FALLO: yo escribi la guarda como «si photo_retention_days es nula, no se
-- captura». Esa columna es `integer NOT NULL DEFAULT 180` -- comprobado en
-- information_schema -- asi que NUNCA puede serlo. La condicion era imposible
-- y el codigo mentia sobre lo que hacia.
--
-- Lo que de verdad decide es OTRA COSA: que exista la fila. Sin fila en
-- kitchen_settings no hay plazo decidido por nadie, y por eso no se captura.
-- Es una diferencia que importa: la version anterior parecia comprobar un
-- valor y en realidad comprobaba una existencia por accidente, a traves del
-- `join`. Funcionaba por el motivo equivocado, que es la peor forma de
-- funcionar -- el dia que alguien tocara el join, la guarda se habria caido
-- sin que ninguna condicion se pusiera roja.
--
-- Se corrige en los dos sitios de SQL y en la edge function (fuera de esta
-- migracion, en el mismo commit).

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
  -- El `join` (no `left join`) ES la guarda: una cuenta sin fila en
  -- kitchen_settings no tiene plazo decidido, asi que sus capturas no se
  -- purgan. Dicho aqui para que se lea como intencion y no como casualidad.
  -- Ya no se comprueba que el plazo sea nulo: la columna es NOT NULL DEFAULT
  -- 180 y esa condicion era imposible de cumplir.
  select c.id, c.account_id, c.image_path, c.captured_at,
         ks.photo_retention_days,
         floor(extract(epoch from (now() - c.captured_at)) / 86400)::int
    from public.sale_capture c
    join public.kitchen_settings ks on ks.account_id = c.account_id
   where c.purged_at is null
     and c.captured_at < now() - (ks.photo_retention_days || ' days')::interval
     and (c.hold_until is null or c.hold_until <= now())
   order by c.captured_at
   limit greatest(1, p_limite);
$function$;

comment on function public.capturas_a_purgar(int) is
  'C9 L2 §5: que capturas TOCA purgar. Solo lectura: se puede mirar antes de borrar. Excluye las que tienen hold_until en el futuro (reclamacion abierta) y las cuentas SIN FILA en kitchen_settings, que son las que no tienen plazo decidido.';

create or replace function public.capturas_estado_purga()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'vivas',                     (select count(*) from public.sale_capture where purged_at is null),
    'purgadas',                  (select count(*) from public.sale_capture where purged_at is not null),
    'retenidas_por_reclamacion', (select count(*) from public.sale_capture
                                   where purged_at is null and hold_until is not null and hold_until > now()),
    -- Antes se llamaba `sin_plazo_definido` y contaba una condicion imposible.
    -- Ahora cuenta lo que de verdad deja una foto sin fecha de caducidad: que
    -- su cuenta no tenga fila.
    'sin_fila_en_kitchen_settings',
                                 (select count(*) from public.sale_capture c
                                   where c.purged_at is null
                                     and not exists (select 1 from public.kitchen_settings k
                                                      where k.account_id = c.account_id)),
    'pendientes_de_purgar',      (select count(*) from public.capturas_a_purgar(100000))
  );
$function$;

comment on function public.capturas_estado_purga() is
  'C9 L2 §5: el estado completo, no solo «cuantas borre». Incluye las retenidas por reclamacion abierta y las de cuentas sin fila en kitchen_settings, que son las dos formas de que una foto se quede para siempre sin que nadie se entere.';

revoke all on function public.capturas_a_purgar(int) from public, anon, authenticated;
revoke all on function public.capturas_estado_purga() from public, anon, authenticated;
grant execute on function public.capturas_a_purgar(int) to service_role;
grant execute on function public.capturas_estado_purga() to service_role;

do $verif$
declare v_def text; v_estado jsonb;
begin
  -- Se busca la forma CON ALIAS, que solo aparece en codigo: la primera version
  -- de esta guarda buscaba la frase suelta y se disparo contra el comentario
  -- que explica que la condicion se habia quitado.
  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname='capturas_a_purgar' and pronamespace='public'::regnamespace;
  if v_def ilike '%ks.photo_retention_days is not null%' then
    raise exception 'C9 L2: capturas_a_purgar sigue comprobando una columna NOT NULL contra NULL.';
  end if;

  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname='capturas_estado_purga' and pronamespace='public'::regnamespace;
  if v_def ilike '%''sin_plazo_definido''%' then
    raise exception 'C9 L2: capturas_estado_purga conserva el contador viejo.';
  end if;

  -- Y que devuelva la clave nueva de verdad, no solo que compile.
  select public.capturas_estado_purga() into v_estado;
  if not (v_estado ? 'sin_fila_en_kitchen_settings') then
    raise exception 'C9 L2: capturas_estado_purga no devuelve sin_fila_en_kitchen_settings.';
  end if;
end
$verif$;
