-- B53 §3 · 03/09/2026 — EL COSECHADOR. CIERRA LOS PENDIENTES ANTES DE LA PURGA.
-- ===========================================================================
-- pg_net guarda la respuesta en net._http_response y la PURGA: medido el 03/09,
-- la fila mas antigua tenia 6 horas. El cosechador corre cada 3 minutos y cruza
-- los pendientes con esa tabla mientras la respuesta sigue viva. Con 3 min contra
-- una ventana de 6 h el margen es de sobra, incluso perdiendo varias pasadas.
--
-- ⚠️ `no_procede` NO ES UN FALLO. Es el `completed` de un pedido de reparto por
--    plataforma, que A PROPOSITO no se empuja porque Glovo cierra en su sistema
--    (empujar DELIVERED daria INVALID_STATUS_CHANGE). El 03/09 fueron 23 de 44.
--    Si se contara como error, el indicador nacería roto y volveriamos a discutir
--    con Cloudtown sobre un numero mal construido — que es como empezo todo esto.
--
-- LAS FORMAS QUE DEVUELVE order-advance, que son las que se leen aqui:
--   {"ok":true, "push":{"attempted":true, "ok":true}}    -> aceptado
--   {"ok":true, "push":{"attempted":false,"reason":...}} -> no_procede
--   {"ok":false,"error":"faltan token/tab/location"}     -> 200 sin `attempted` -> rechazado
--   401 unauthorized                                     -> rechazado
--   sin respuesta / timeout                              -> sin_respuesta
--
-- SEGUNDA PASADA: sin ella los pendientes se acumulan para siempre y el indice
--   parcial ix_sse_pendiente deja de servir para lo que se creo.

begin;

create or replace function public.cosechar_acuses_push()
returns table (cerrados integer, caducados integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cerrados  integer := 0;
  v_caducados integer := 0;
begin
  -- (1) Los que todavia tienen su respuesta viva en pg_net.
  with cerrados as (
    update public.sale_step_event e
       set push_http_status = r.status_code,
           push_estado = case
             when r.status_code between 200 and 299
                  and r.content like '%"attempted":true%'
                  and r.content like '%"ok":true%'            then 'aceptado'
             when r.status_code between 200 and 299
                  and r.content like '%"attempted":false%'    then 'no_procede'
             when r.status_code between 200 and 299            then 'rechazado'
             when r.status_code is null                        then 'sin_respuesta'
             else 'rechazado'
           end,
           push_detalle = left(coalesce(r.error_msg, r.content), 500),
           push_resuelto_en = now()
      from net._http_response r
     where r.id = e.push_request_id
       and e.push_estado = 'pendiente'
    returning 1
  )
  select count(*)::integer into v_cerrados from cerrados;

  -- (2) Los que ya no se pueden cosechar: llevan mas de 2 h pendientes y pg_net
  --     ya purgo su respuesta. Se sellan para que no se acumulen.
  with caducados as (
    update public.sale_step_event e
       set push_estado = 'sin_respuesta',
           push_detalle = coalesce(e.push_detalle,
             'pg_net purgo la respuesta antes de cosecharla (>2 h pendiente)'),
           push_resuelto_en = now()
     where e.push_estado = 'pendiente'
       and e.ocurrido_en < now() - interval '2 hours'
       and not exists (
         select 1 from net._http_response r where r.id = e.push_request_id
       )
    returning 1
  )
  select count(*)::integer into v_caducados from caducados;

  return query select v_cerrados, v_caducados;
end;
$function$;

revoke all on function public.cosechar_acuses_push() from public, anon, authenticated;
grant execute on function public.cosechar_acuses_push() to service_role;

-- ── Cron cada 3 minutos (patron de la casa: unschedule defensivo + schedule) ──
do $$
begin
  perform cron.unschedule('b53-cosechar-acuses');
exception when others then
  null;
end $$;

select cron.schedule(
  'b53-cosechar-acuses',
  '*/3 * * * *',
  $cron$ select public.cosechar_acuses_push(); $cron$
);

commit;
