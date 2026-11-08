-- supabase/migrations/20261108T2308_g04_pantalla_rapida.sql
--
-- G04 · La pantalla de Clientes en UNA sola llamada, en menos de 1 s (Julio,
-- nº 21, 08/11: regla para todas las pantallas, medido en el navegador con
-- datos reales). SOLO AÑADE: tres funciones nuevas.
--
-- Por qué: con la 2209 la lista ya va en 61 ms, pero la pantalla seguía
-- tardando 4–5 s en el navegador de Julio con QBO. Leía además, enteras y por
-- páginas de 1.000, cuatro tablas con la RLS fila a fila (belongs_to_account,
-- 0,24 ms por fila leída). Medido en producción el 08/11 como authenticated
-- con el administrador de QBO:
--   · conta_gc_cobro (2.855): 3 páginas de ~690 ms, unos 2,1 s seguidos.
--   · conta_gc_mandato (2.099): 3 páginas de ~500 ms, unos 1,5 s.
--   · conta_gestoria_cliente (1.535, solo la ficha): 2 páginas de ~385 ms.
--   · conta_gc_suscripcion (2.636, 412 activas): ~100 ms.
-- Y de todo eso la pantalla solo pinta unas pocas cifras por fila y por
-- empresa.
--
-- Arreglo, con el patrón de la 2209 (SECURITY DEFINER, el permiso de la cuenta
-- comprobado UNA vez con belongs_to_account y cada tabla filtrada por la
-- cuenta; si no es de la cuenta, nada) y ya agregado en la base:
--   · conta_pantalla_clientes(p_cuenta): todo lo que pinta Clientes al abrir
--     (y lo que usa «Tarifa y paquetes»), en un jsonb:
--       clientes      las filas de conta_lista_clientes, y por fila: los
--                     nombres de sus suscripciones activas de GoCardless
--                     (servicios_gc) y su último cargo (estado, fecha, importe);
--       cuotas_gc     por empresa: lo que cobra GoCardless al mes, las altas y
--                     las bajas de este mes (Madrid);
--       proximos      por empresa y día: cuántos cobros y cuánto (el próximo
--                     cobro de cada suscripción activa);
--       cargos, que_hacer, asignaciones, precios, servicios, niveles,
--       paquetes, lineas_de_paquete, ajustes, crm: lo de antes, de la cuenta.
--   · conta_pantalla_ficha(p_cuenta, p_cliente): lo que solo hace falta al
--     abrir un cliente: su ficha del CRM, sus mandatos, sus cobros de los
--     últimos 13 meses (la ficha enseña 12), sus suscripciones, lo pendiente
--     de revisar y sus personas de contacto.
--   · conta_pantalla_asignar(p_cuenta): «Asignar a un cliente»: las
--     suscripciones activas y los clientes de GoCardless que las pagan.
-- Las tablas, las vistas y su RLS no se tocan; la versión publicada del front
-- las sigue leyendo.
--
-- No toca datos. No lee ni escribe en GoCardless ni en el CRM. Nada en el
-- camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261108T2308_g04_pantalla_rapida.down.sql

create or replace function public.conta_pantalla_clientes(p_cuenta uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with permiso as (
    -- La única comprobación: si quien llama no es de la cuenta, «cuenta» sale vacía y todo sale vacío.
    select p_cuenta as cuenta where public.belongs_to_account(p_cuenta)
  ), hoy as (
    select (now() at time zone 'Europe/Madrid')::date as d, to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM') as mes
  ), subs as (
    select s.company_id, s.gc_id, s.gc_cliente_id, s.nombre, s.al_mes, s.estado, s.inicio, s.fin, s.proximo_cobro_fecha, s.proximo_cobro_importe
      from public.conta_gc_suscripcion s where s.account_id = (select cuenta from permiso)
  ), servicios_gc as (
    select s.company_id, s.gc_cliente_id, string_agg(s.nombre, ' · ' order by s.gc_id) as nombres
      from subs s where s.estado = 'active' and s.gc_cliente_id is not null group by s.company_id, s.gc_cliente_id
  ), cargo as (
    select m.company_id, m.gc_cliente_id, b.fecha, b.estado, b.gc_id, b.importe
      from public.conta_gc_cobro b join public.conta_gc_mandato m on m.company_id = b.company_id and m.gc_id = b.mandato_gc_id
     where b.account_id = (select cuenta from permiso) and m.account_id = (select cuenta from permiso) and b.fecha is not null
  ), ultimo_cargo as (
    -- El más reciente; dos el mismo día: el cobrado, y si no, el gc_id mayor (como la 2209).
    select distinct on (k.company_id, k.gc_cliente_id) k.company_id, k.gc_cliente_id, k.estado, k.fecha, k.importe from cargo k
     order by k.company_id, k.gc_cliente_id, k.fecha desc, (k.estado in ('paid_out', 'confirmed')) desc, k.gc_id desc
  ), lista as (
    -- Solo lo que lee la pantalla (sin la cuenta, el nombre de la empresa ni lo que no pinta): 1.661 filas en QBO.
    select jsonb_build_object('cliente_id', l.cliente_id, 'empresa_id', l.empresa_id, 'cliente', l.cliente, 'nif', l.nif, 'situacion', l.situacion, 'crm', l.crm,
             'tipo_ficha', l.tipo_ficha, 'ficha_en_el_crm', l.ficha_en_el_crm, 'telefonos', l.telefonos, 'correos', l.correos, 'forma_de_cobro', l.forma_de_cobro,
             'cliente_en_gocardless', l.cliente_en_gocardless, 'mandato', l.mandato, 'gocardless_al_mes', l.gocardless_al_mes, 'ultimo_cobro_fecha', l.ultimo_cobro_fecha,
             'pendientes', l.pendientes, 'trabajadores', l.trabajadores,
             'servicios_gc', sg.nombres, 'ultimo_cargo_estado', uc.estado, 'ultimo_cargo_fecha', uc.fecha, 'ultimo_cargo_importe', uc.importe) as fila,
           l.cliente_id, l.empresa_id
      from public.conta_lista_clientes(p_cuenta) l
      left join servicios_gc sg on sg.company_id = l.empresa_id and sg.gc_cliente_id = l.cliente_en_gocardless
      left join ultimo_cargo uc on uc.company_id = l.empresa_id and uc.gc_cliente_id = l.cliente_en_gocardless
  )
  select jsonb_build_object(
    'clientes', coalesce((select jsonb_agg(jsonb_strip_nulls(x.fila) order by x.cliente_id, x.empresa_id nulls first) from lista x), '[]'::jsonb),
    'cuotas_gc', coalesce((select jsonb_agg(to_jsonb(c) order by c.empresa_id) from (
        select s.company_id as empresa_id,
               coalesce(sum(s.al_mes) filter (where s.estado = 'active'), 0) as al_mes,
               count(*) filter (where s.estado = 'active' and to_char(s.inicio, 'YYYY-MM') = (select mes from hoy)) as altas_n,
               coalesce(sum(s.al_mes) filter (where s.estado = 'active' and to_char(s.inicio, 'YYYY-MM') = (select mes from hoy)), 0) as altas_euros,
               count(*) filter (where s.estado is distinct from 'active' and to_char(s.fin, 'YYYY-MM') = (select mes from hoy)) as bajas_n,
               coalesce(sum(s.al_mes) filter (where s.estado is distinct from 'active' and to_char(s.fin, 'YYYY-MM') = (select mes from hoy)), 0) as bajas_euros
          from subs s group by s.company_id) c), '[]'::jsonb),
    'proximos', coalesce((select jsonb_agg(p order by p.empresa_id, p.fecha nulls first) from (
        select s.company_id as empresa_id, s.proximo_cobro_fecha as fecha, count(*) as n, coalesce(sum(s.proximo_cobro_importe), 0) as euros
          from subs s where s.estado = 'active' group by s.company_id, s.proximo_cobro_fecha) p), '[]'::jsonb),
    'cargos', coalesce((select jsonb_agg(to_jsonb(c) - 'cuenta_id' order by c.empresa_id, c.gc_id) from public.conta_consulta_cargo_devuelto c where c.cuenta_id = (select cuenta from permiso)), '[]'::jsonb),
    'que_hacer', coalesce((select jsonb_agg(to_jsonb(q) order by q.empresa_id, q.tipo) from public.conta_lista_que_hacer(p_cuenta) q), '[]'::jsonb),
    'asignaciones', coalesce((select jsonb_agg(to_jsonb(a) - 'cuenta_id' order by a.cliente_id, a.id) from public.conta_consulta_asignacion a where a.cuenta_id = (select cuenta from permiso)), '[]'::jsonb),
    'precios', coalesce((select jsonb_agg(to_jsonb(p) - 'cuenta_id' order by p.id) from public.conta_consulta_tarifa_precio p where p.cuenta_id = (select cuenta from permiso)), '[]'::jsonb),
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'company_id', x.company_id, 'clave', x.clave, 'nombre', x.nombre, 'forma', x.forma, 'activo', x.activo) order by x.id)
        from public.conta_servicio x where x.account_id = (select cuenta from permiso)), '[]'::jsonb),
    'niveles', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'servicio_id', x.servicio_id, 'nombre', x.nombre, 'orden', x.orden, 'incluye', x.incluye, 'mas_elegido', x.mas_elegido, 'activo', x.activo) order by x.id)
        from public.conta_servicio_nivel x where x.account_id = (select cuenta from permiso)), '[]'::jsonb),
    'paquetes', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'company_id', x.company_id, 'nombre', x.nombre, 'descripcion', x.descripcion, 'exceso_por_trabajador', x.exceso_por_trabajador, 'activo', x.activo) order by x.id)
        from public.conta_paquete x where x.account_id = (select cuenta from permiso)), '[]'::jsonb),
    'lineas_de_paquete', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'paquete_id', x.paquete_id, 'servicio_id', x.servicio_id, 'nivel_id', x.nivel_id, 'limite_trabajadores', x.limite_trabajadores, 'orden', x.orden) order by x.id)
        from public.conta_paquete_linea x where x.account_id = (select cuenta from permiso)), '[]'::jsonb),
    'ajustes', coalesce((select jsonb_agg(jsonb_build_object('company_id', x.company_id, 'mitad_de_mes', x.mitad_de_mes, 'cambios_de_tarifa', x.cambios_de_tarifa) order by x.company_id)
        from public.conta_gestoria_ajustes x where x.account_id = (select cuenta from permiso)), '[]'::jsonb),
    'crm', coalesce((select jsonb_agg(jsonb_build_object('crm', x.crm, 'portal', x.portal) order by x.crm)
        from public.conta_crm x where x.account_id = (select cuenta from permiso)), '[]'::jsonb))
$$;

create or replace function public.conta_pantalla_ficha(p_cuenta uuid, p_cliente uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with permiso as (
    select p_cuenta as cuenta where public.belongs_to_account(p_cuenta)
  ), gc as (
    -- Sus clientes de GoCardless, por empresa (los mismos de los que sale cliente_en_gocardless en la lista).
    select k.company_id, k.gc_cliente_id from public.conta_cobro_cliente k
     where k.account_id = (select cuenta from permiso) and k.party_id = p_cliente and k.gc_cliente_id is not null
  ), mandatos as (
    select m.company_id, m.gc_id, m.gc_cliente_id, m.estado, m.creado from public.conta_gc_mandato m
     where m.account_id = (select cuenta from permiso) and (m.company_id, m.gc_cliente_id) in (select company_id, gc_cliente_id from gc)
  )
  select jsonb_build_object(
    'ficha', (select c.ficha from public.conta_gestoria_cliente c where c.account_id = (select cuenta from permiso) and c.party_id = p_cliente),
    'leido_at', (select c.leido_at from public.conta_gestoria_cliente c where c.account_id = (select cuenta from permiso) and c.party_id = p_cliente),
    'mandatos', coalesce((select jsonb_agg(to_jsonb(m) order by m.company_id, m.gc_id) from mandatos m), '[]'::jsonb),
    -- La ficha enseña 12 meses y los filtra ella; aquí 13, para no cortar de más en ningún caso.
    'cobros', coalesce((select jsonb_agg(jsonb_build_object('company_id', b.company_id, 'gc_id', b.gc_id, 'mandato_gc_id', b.mandato_gc_id, 'suscripcion_gc_id', b.suscripcion_gc_id,
        'estado', b.estado, 'fecha', b.fecha, 'importe', b.importe, 'motivo', b.motivo) order by b.fecha desc, b.gc_id)
        from public.conta_gc_cobro b
       where b.account_id = (select cuenta from permiso) and (b.company_id, b.mandato_gc_id) in (select company_id, gc_id from mandatos)
         and b.fecha >= ((now() at time zone 'Europe/Madrid')::date - interval '13 months')::date), '[]'::jsonb),
    'suscripciones', coalesce((select jsonb_agg(jsonb_build_object('company_id', s.company_id, 'gc_id', s.gc_id, 'gc_cliente_id', s.gc_cliente_id, 'nombre', s.nombre, 'importe', s.importe,
        'al_mes', s.al_mes, 'estado', s.estado, 'inicio', s.inicio, 'fin', s.fin) order by s.company_id, s.gc_id)
        from public.conta_gc_suscripcion s
       where s.account_id = (select cuenta from permiso) and (s.company_id, s.gc_cliente_id) in (select company_id, gc_cliente_id from gc)), '[]'::jsonb),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'company_id', d.company_id, 'tipo', d.tipo, 'porque', d.porque) order by d.id)
        from public.conta_gestoria_diferencia d where d.account_id = (select cuenta from permiso) and d.party_id = p_cliente and d.vigente), '[]'::jsonb),
    'personas', coalesce((select jsonb_agg(jsonb_build_object('party_id', f.party_id, 'id_externo', f.id_externo, 'ficha', f.ficha) order by f.id_externo)
        from public.conta_gestoria_ficha f where f.account_id = (select cuenta from permiso) and f.party_id = p_cliente and f.tipo_ficha = 'contacto' and f.de_empresa <> ''), '[]'::jsonb))
$$;

create or replace function public.conta_pantalla_asignar(p_cuenta uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with permiso as (
    select p_cuenta as cuenta where public.belongs_to_account(p_cuenta)
  ), activas as (
    select s.company_id, s.gc_id, s.gc_cliente_id, s.nombre, s.al_mes, s.estado from public.conta_gc_suscripcion s
     where s.account_id = (select cuenta from permiso) and s.estado = 'active'
  )
  select jsonb_build_object(
    'suscripciones', coalesce((select jsonb_agg(to_jsonb(a) order by a.company_id, a.gc_id) from activas a), '[]'::jsonb),
    'gc_clientes', coalesce((select jsonb_agg(jsonb_build_object('company_id', g.company_id, 'gc_id', g.gc_id, 'nombre', g.nombre, 'correo', g.correo, 'nif', g.nif) order by g.company_id, g.gc_id)
        from public.conta_gc_cliente g
       where g.account_id = (select cuenta from permiso) and (g.company_id, g.gc_id) in (select company_id, gc_cliente_id from activas)), '[]'::jsonb))
$$;

revoke all on function public.conta_pantalla_clientes(uuid) from public, anon;
revoke all on function public.conta_pantalla_ficha(uuid, uuid) from public, anon;
revoke all on function public.conta_pantalla_asignar(uuid) from public, anon;
grant execute on function public.conta_pantalla_clientes(uuid) to authenticated, service_role;
grant execute on function public.conta_pantalla_ficha(uuid, uuid) to authenticated, service_role;
grant execute on function public.conta_pantalla_asignar(uuid) to authenticated, service_role;

comment on function public.conta_pantalla_clientes(uuid) is
  'G04 · Todo lo que pinta Clientes al abrir, en una sola llamada y ya agregado (la lista, las cuotas, el próximo cobro, los devueltos, «Lo que tienes que hacer» y la tarifa). SECURITY DEFINER con una sola comprobación de la cuenta (belongs_to_account) y cada tabla filtrada por ella.';
comment on function public.conta_pantalla_ficha(uuid, uuid) is
  'G04 · Lo que solo hace falta al abrir un cliente: su ficha del CRM, sus mandatos, sus cobros de 13 meses, sus suscripciones, lo pendiente y sus personas. Con una sola comprobación de la cuenta.';
comment on function public.conta_pantalla_asignar(uuid) is
  'G04 · «Asignar a un cliente»: las suscripciones activas de GoCardless y los clientes de GoCardless que las pagan. Con una sola comprobación de la cuenta.';
