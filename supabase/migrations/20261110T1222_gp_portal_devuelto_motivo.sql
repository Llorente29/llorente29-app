-- supabase/migrations/20261110T1222_gp_portal_devuelto_motivo.sql
-- cambia: public._conta_portal_devueltos · prueba: supabase/staging/sql/20261110_gp_portal_devuelto_motivo_prueba.sql
--
-- GP · nº 24, punto 6 (Code 3) · EL MOTIVO DEL DEVUELTO, EN EL PORTAL, como la
-- maqueta: «Tu banco lo devolvió el 7 de noviembre: no había saldo suficiente»
-- (Inicio) y «Devuelto el 7 de noviembre · sin saldo» (Pagos). Code 1 lo guarda
-- en conta_recibo.motivo_devolucion (la 1138, del #591) en palabras de oficina;
-- el portal lo dice al cliente de tú (portal/formato.ts, motivoParaTi).
-- Cambia en caliente una función propia del portal (la misma firma, con
-- respaldo): cada devuelto trae además su «motivo». Es la que leen Inicio y
-- Pagos; con eso basta. Los permisos no cambian (create or replace los guarda).
-- No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1222_gp_portal_devuelto_motivo.down.sql

select public._respaldar_funcion('public._conta_portal_devueltos(uuid, uuid)', '20261110T1222_gp_portal_devuelto_motivo');

create or replace function public._conta_portal_devueltos(p_account uuid, p_party uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'recibo_id', r.id, 'mes', r.mes, 'importe_cent', coalesce(r.cobrar_cent, r.total_cent),
           'devuelto_el', (select max(ev.cuando) from public.conta_recibo_evento ev where ev.recibo_id = r.id and ev.tipo in ('devuelto', 'retrocedido')),
           'gc_estado', r.gc_estado,
           -- nº 24 · 6 · Por qué lo devolvió el banco, en palabras de oficina (lo guarda Code 1); null si aún no se sabe.
           'motivo', nullif(btrim(r.motivo_devolucion), ''),
           'en_marcha', (select jsonb_build_object('tipo', o.tipo, 'estado', o.estado, 'url', o.externo_url, 'creada', o.created_at)
                           from public.conta_portal_operacion o
                          where o.recibo_id = r.id and o.estado in ('creada', 'esperando') order by o.created_at desc limit 1))
           order by r.mes), '[]'::jsonb)
    from public.conta_recibo r
   where r.account_id = p_account and r.party_id = p_party and r.estado in ('devuelto', 'retrocedido')
     and not public._conta_portal_devuelto_pagado(r.id)
$$;
