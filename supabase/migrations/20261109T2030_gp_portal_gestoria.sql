-- supabase/migrations/20261109T2030_gp_portal_gestoria.sql
-- cambia: public._conta_portal_proximo · prueba: supabase/staging/sql/20261109_gp_portal_gestoria_prueba.sql
--
-- GP · Tarea 4 · LA PARTE DE LA GESTORÍA Y LOS AVISOS POR CORREO, la base
-- (Code 3; Julio, nº 9 y nº 10 del 09/11). AÑADE funciones nuevas y un cron, y
-- CAMBIA EN CALIENTE una función propia del portal (la misma firma, con
-- respaldo):
--
--   1. Hacer o rechazar lo que pide el cliente (alta o baja de un trabajador):
--      conta_portal_solicitud_hacer llama a la misma función que el botón
--      «Alta de un trabajador» de la ficha (conta_gestoria_alta_empleado, G01)
--      o a la de la baja (conta_gestoria_baja_linea), deja la línea del recibo
--      con su origen («solicitud») y la petición como hecha. Así cambia el
--      recibo (06/11: el cliente pide y la gestoría hace).
--   2. Los avisos por correo al cliente (los cinco del encargo: factura nueva,
--      recibo próximo con su desglose el día de aviso, devuelto, mensaje nuevo y
--      petición de la gestoría): conta_portal_avisos_pendientes dice qué falta
--      por mandar y a quién; lo manda conta-portal-avisos (con la puerta de las
--      demos y el freno de Julio) y lo apunta. Nunca dos veces lo mismo: cada
--      aviso tiene su clave por persona en conta_portal_aviso.
--   3. El despertador: cada 10 minutos, si hay algo que avisar, llama a
--      conta-portal-avisos. Solo donde está el cron_secret (producción), como
--      el de Verifactu de la G05.
--   4. «Tu próximo recibo» dice de qué cuenta se carga (los últimos dígitos de
--      Code 1, conta_gc_mandato.cuenta_final): _conta_portal_proximo, la misma
--      firma, con dos claves más. Lo pedía la maqueta.
--
-- Lo de otros, solo se lee: conta_recibo, customer_invoice, conta_gc_mandato y
-- conta_gestoria_ajustes (Code 1). Las funciones de G01 (alta y baja) se
-- llaman, no se cambian. Nada en el camino del pedido. No toca datos.
-- Vuelta atrás: supabase/vuelta-atras/20261109T2030_gp_portal_gestoria.down.sql

-- ── 1 · Hacer o rechazar lo que pide el cliente ────────────────────────────────
create or replace function public.conta_portal_solicitud_hacer(p_solicitud uuid, p_servicio uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.conta_solicitud; r jsonb; v_linea uuid; v_mes date; v_quien text := public.conta_nombre_actor();
begin
  select * into s from public.conta_solicitud where id = p_solicitud for update;
  if s.id is null or not public.current_user_is_admin_or_manager_of(s.account_id) then
    raise exception 'Esa petición no es de esta cuenta.' using errcode = '42501';
  end if;
  if s.estado <> 'pedida' then raise exception 'Esa petición ya está %.', s.estado using errcode = '22023'; end if;
  v_mes := date_trunc('month', coalesce(s.fecha_efecto, s.mes))::date;
  if s.tipo = 'alta' then
    if p_servicio is null then raise exception 'Elige en qué servicio se cobra el trabajador.' using errcode = '22023'; end if;
    r := public.conta_gestoria_alta_empleado(s.company_id, s.party_id, p_servicio, s.empleado_nombre, v_mes);
    v_linea := (r ->> 'id')::uuid;
    update public.conta_linea set origen = 'solicitud', solicitud_id = s.id where id = v_linea;
  else
    select l.id into v_linea from public.conta_linea l
     where l.account_id = s.account_id and l.party_id = s.party_id and upper(l.empleado_nombre) = upper(s.empleado_nombre)
       and (l.hasta is null or l.hasta >= v_mes)
     order by l.desde desc limit 1;
    if v_linea is null then raise exception '% no está de alta en el recibo de este cliente.', s.empleado_nombre using errcode = 'P0002'; end if;
    r := public.conta_gestoria_baja_linea(v_linea, v_mes);
  end if;
  update public.conta_solicitud set estado = 'hecha', resuelta_at = now(), resuelta_por_name = v_quien where id = s.id;
  return jsonb_build_object('id', s.id, 'linea_id', v_linea,
    'frase', coalesce(r ->> 'frase', 'Hecho.') || ' Al cliente le sale como hecha en su portal.');
end $$;

create or replace function public.conta_portal_solicitud_rechazar(p_solicitud uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.conta_solicitud;
begin
  select * into s from public.conta_solicitud where id = p_solicitud for update;
  if s.id is null or not public.current_user_is_admin_or_manager_of(s.account_id) then
    raise exception 'Esa petición no es de esta cuenta.' using errcode = '42501';
  end if;
  if s.estado <> 'pedida' then raise exception 'Esa petición ya está %.', s.estado using errcode = '22023'; end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then raise exception 'Escribe por qué no se hace: el cliente lo lee.' using errcode = '22023'; end if;
  update public.conta_solicitud set estado = 'rechazada', motivo_rechazo = trim(p_motivo), resuelta_at = now(), resuelta_por_name = public.conta_nombre_actor()
   where id = s.id;
  return jsonb_build_object('id', s.id, 'frase', format('No se hace %s de %s. El cliente ve el motivo en su portal.',
    case s.tipo when 'alta' then 'el alta' else 'la baja' end, s.empleado_nombre));
end $$;

-- ── 2 · Los avisos por correo que faltan por mandar ──────────────────────────────
-- Una fila por aviso y persona: {tipo, clave, account_id, party_id, acceso_id, para, nombre, permiso, datos}.
-- La clave lleva el correo: nunca se manda dos veces lo mismo a la misma persona.
create or replace function public.conta_portal_avisos_pendientes(p_limite int default 200)
returns jsonb language sql stable security definer set search_path = public as $$
  with personas as (
    select a.id as acceso_id, a.account_id, a.party_id, lower(a.correo) as para, a.nombre, a.permiso
      from public.conta_portal_acceso a where a.revocado_at is null
  ), hoy as (select (now() at time zone 'Europe/Madrid')::date as d),
  todo as (
    -- Factura nueva (las de los tres últimos días), a todos los que la ven.
    select 'factura' as tipo, 'factura:' || f.id || ':' || p.para as clave, p.*,
           jsonb_build_object('id', f.id, 'numero', f.number_text, 'total', f.total, 'fecha', f.issue_date) as datos, f.issued_at as orden
      from public.customer_invoice f join personas p on p.account_id = f.account_id and p.party_id = f.party_id
     where f.status = 'emitida' and f.issued_at > now() - interval '3 days'
    union all
    -- Recibo próximo, desde el día de aviso de su empresa (sin ponerlo, el 2), solo a quien tiene «todo».
    select 'recibo_proximo', 'recibo_proximo:' || r.id || ':' || p.para, p.*,
           jsonb_build_object('id', r.id, 'mes', r.mes, 'total_cent', coalesce(r.cobrar_cent, r.total_cent), 'anterior_cent', r.anterior_cent,
                              'lineas', r.lineas, 'cambios', r.cambios, 'cargo_el', r.cargo_el), r.preparado_at
      from public.conta_recibo r join personas p on p.account_id = r.account_id and p.party_id = r.party_id and p.permiso = 'todo'
      left join public.conta_gestoria_ajustes j on j.company_id = r.company_id
     where r.estado in ('preparado', 'enviado', 'en_el_banco') and r.decision <> 'este_mes_no'
       and r.mes = to_char((select d from hoy), 'YYYY-MM')
       and extract(day from (select d from hoy)) >= coalesce(j.dia_aviso, 2)
    union all
    -- Devuelto sin pagar, solo a quien tiene «todo».
    select 'devuelto', 'devuelto:' || r.id || ':' || p.para, p.*,
           jsonb_build_object('id', r.id, 'mes', r.mes, 'importe_cent', coalesce(r.cobrar_cent, r.total_cent)), r.updated_at
      from public.conta_recibo r join personas p on p.account_id = r.account_id and p.party_id = r.party_id and p.permiso = 'todo'
     where r.estado in ('devuelto', 'retrocedido') and not public._conta_portal_devuelto_pagado(r.id)
    union all
    -- Mensajes nuevos de la gestoría (los de hace más de 2 minutos, juntos): uno por cliente y persona.
    select 'mensaje', 'mensaje:' || m.ultimo || ':' || p.para, p.*,
           jsonb_build_object('ids', m.ids, 'cuantos', m.n, 'autor', m.autor, 'texto', left(m.texto, 300)), m.cuando
      from (select party_id, account_id, count(*) n, max(created_at) cuando, (array_agg(id order by created_at desc))[1] ultimo,
                   (array_agg(autor_nombre order by created_at desc))[1] autor, (array_agg(texto order by created_at desc))[1] texto,
                   jsonb_agg(id) ids
              from public.conta_portal_mensaje
             where de = 'gestoria' and avisado_at is null and leido_at is null and created_at < now() - interval '2 minutes'
             group by party_id, account_id) m
      join personas p on p.account_id = m.account_id and p.party_id = m.party_id and p.permiso = 'todo'
    union all
    -- Lo que pide la gestoría, solo a quien tiene «todo».
    select 'peticion', 'peticion:' || q.id || ':' || p.para, p.*,
           jsonb_build_object('id', q.id, 'tipo', q.tipo, 'titulo', q.titulo, 'detalle', q.detalle, 'fecha_limite', q.fecha_limite), q.created_at
      from public.conta_portal_peticion q join personas p on p.account_id = q.account_id and p.party_id = q.party_id and p.permiso = 'todo'
     where q.estado = 'pendiente' and q.avisado_at is null
  )
  select coalesce(jsonb_agg(to_jsonb(x) - 'orden' order by x.orden), '[]'::jsonb)
    from (select * from todo t where not exists (select 1 from public.conta_portal_aviso v where v.clave = t.clave)
           order by t.orden limit greatest(1, least(coalesce(p_limite, 200), 500))) x
$$;

-- Lo que ya se ha avisado de mensajes y peticiones (para no volver a juntarlo).
create or replace function public.conta_portal_avisos_hechos(p_mensajes uuid[], p_peticiones uuid[])
returns void language sql security definer set search_path = public as $$
  update public.conta_portal_mensaje set avisado_at = now() where id = any (coalesce(p_mensajes, '{}')) and avisado_at is null;
  update public.conta_portal_peticion set avisado_at = now() where id = any (coalesce(p_peticiones, '{}')) and avisado_at is null;
$$;

-- ── 3 · El despertador ─────────────────────────────────────────────────────────
create or replace function public.conta_portal_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text;
begin
  if jsonb_array_length(public.conta_portal_avisos_pendientes(1)) = 0 then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-portal-avisos.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := public._project_url() || '/functions/v1/conta-portal-avisos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $$;
comment on function public.conta_portal_despertar() is
  'GP · Cada 10 minutos (cron portal-avisos, solo en producción): si hay avisos del portal por mandar, llama a conta-portal-avisos. Si falta el secreto, falla (cron lo apunta), no calla.';

-- ── 4 · «Tu próximo recibo», con la cuenta de cargo ─────────────────────────────
select public._respaldar_funcion('public._conta_portal_proximo(uuid,uuid)', '20261109T2030_gp_portal_gestoria');

create or replace function public._conta_portal_proximo(p_account uuid, p_party uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'recibo_id', r.id, 'mes', r.mes, 'estado', r.estado, 'estado_texto', public._conta_portal_estado_recibo(r.estado),
           'total_cent', coalesce(r.cobrar_cent, r.total_cent), 'anterior_cent', r.anterior_cent,
           'lineas', r.lineas, 'cambios', r.cambios, 'cargo_el', r.cargo_el, 'parado', to_jsonb(r.parado),
           'cuenta_final', m.cuenta_final, 'cuenta_pais', m.cuenta_pais,
           'incidencia', (select jsonb_build_object('id', i.id, 'texto', i.texto, 'creada', i.created_at, 'parado', i.recibo_parado)
                            from public.conta_portal_incidencia i
                           where i.recibo_id = r.id and i.tipo = 'no_de_acuerdo' and i.estado = 'abierta' limit 1))
    from public.conta_recibo r
    left join lateral (select g.cuenta_final, g.cuenta_pais from public.conta_gc_mandato g
                        where g.company_id = r.company_id
                          and g.gc_id = coalesce(r.mandato_gc_id, (select g2.gc_id from public.conta_gc_mandato g2
                                join public.conta_cobro_cliente cc on cc.company_id = g2.company_id and cc.gc_cliente_id = g2.gc_cliente_id
                               where cc.company_id = r.company_id and cc.party_id = r.party_id
                                 and g2.estado not in ('cancelled', 'failed', 'expired', 'consumed', 'blocked')
                               order by g2.creado desc nulls last limit 1))) m on true
   where r.account_id = p_account and r.party_id = p_party
     and r.estado in ('preparado', 'enviado', 'en_el_banco') and r.decision <> 'este_mes_no'
   order by r.mes desc limit 1
$$;

-- ── 5 · Permisos ───────────────────────────────────────────────────────────────
-- Supabase da EXECUTE por defecto a anon y authenticated: se quita a todos y se da solo a quien toca
-- (la regla de la prueba de la 1720, que ahora también mira estas).
revoke all on function public.conta_portal_solicitud_hacer(uuid, uuid), public.conta_portal_solicitud_rechazar(uuid, text),
  public.conta_portal_avisos_pendientes(int), public.conta_portal_avisos_hechos(uuid[], uuid[]), public.conta_portal_despertar(),
  public._conta_portal_proximo(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.conta_portal_solicitud_hacer(uuid, uuid), public.conta_portal_solicitud_rechazar(uuid, text) to authenticated;
grant execute on function public.conta_portal_avisos_pendientes(int), public.conta_portal_avisos_hechos(uuid[], uuid[]),
  public._conta_portal_proximo(uuid, uuid) to service_role;

-- El cron, solo donde está el secreto de los vigías (producción); en staging se llama a mano.
-- (Sin pg_cron o sin el Vault, como en una base local, no hace nada.)
do $$
declare v_hay boolean := false;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and to_regclass('vault.secrets') is not null then
    execute 'select exists (select 1 from vault.secrets where name = ''cron_secret'')' into v_hay;
  end if;
  if v_hay then
    execute $q$select cron.unschedule('portal-avisos') from cron.job where jobname = 'portal-avisos'$q$;
    execute $q$select cron.schedule('portal-avisos', '*/10 * * * *', 'select public.conta_portal_despertar()')$q$;
  end if;
end $$;
