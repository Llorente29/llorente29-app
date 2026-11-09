-- supabase/migrations/20261109T1720_gp_portal_cuenta.sql
-- cambia: public.conta_portal_cuenta · prueba: supabase/staging/sql/20261109_gp_portal_cuenta_prueba.sql
--
-- GP · Tarea 2b · «Tu cuenta» lee la cuenta de cargo con los nombres de Code 1
-- (G05 T4, la 1344: conta_gc_mandato.cuenta_final, cuenta_pais y banco). La
-- 1530 los buscaba como cuenta_ultimos y cuenta_banco, que no existen: salían
-- vacíos. CAMBIA EN CALIENTE una función (la misma firma, el mismo resultado
-- salvo esas tres claves) y AÑADE permisos: las funciones de dentro y las del
-- servidor del portal, a service_role de forma explícita (las llaman
-- conta-portal y conta-portal-entrar con la clave de servicio; hasta hoy las
-- tenía por el permiso por defecto de Supabase, y eso no se deja a la suerte).
-- Nada en el camino del pedido. No toca datos.
--
-- Lo de otros, solo se lee: conta_gc_mandato (Code 1).
-- Vuelta atrás: supabase/vuelta-atras/20261109T1720_gp_portal_cuenta.down.sql

-- La de antes, guardada (funcion_respaldo): la vuelta atrás la restaura comprobando su huella.
select public._respaldar_funcion('public.conta_portal_cuenta(uuid)', '20261109T1720_gp_portal_cuenta');

create or replace function public.conta_portal_cuenta(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, true); e uuid;
begin
  e := public._conta_portal_empresa(y.account_id, y.party_id);
  return jsonb_build_object(
    'domiciliacion', (select jsonb_build_object('estado', m.estado, 'firmada', m.creado,
                        'cuenta_final', m.cuenta_final, 'cuenta_pais', m.cuenta_pais, 'banco', m.banco)
                        from public.conta_gc_mandato m
                        join public.conta_cobro_cliente cc on cc.company_id = m.company_id and cc.gc_cliente_id = m.gc_cliente_id
                       where cc.account_id = y.account_id and cc.party_id = y.party_id and m.estado not in ('cancelled', 'failed', 'expired', 'consumed', 'blocked')
                       order by m.creado desc nulls last limit 1),
    'cambio_en_marcha', (select jsonb_build_object('estado', o.estado, 'url', o.externo_url, 'creada', o.created_at)
                           from public.conta_portal_operacion o where o.party_id = y.party_id and o.tipo = 'cambiar_cuenta'
                            and o.estado in ('creada', 'esperando') order by o.created_at desc limit 1),
    'datos', (select jsonb_build_object('razon_social', coalesce(cf.legal_name, p.name), 'nif', p.tax_id,
                'direccion', concat_ws(' · ', cf.fiscal_street, nullif(concat_ws(' ', cf.fiscal_postal_code, cf.fiscal_city), '')),
                'correo_facturas', (select f.email_to from public.customer_invoice f where f.party_id = p.id and f.email_to is not null order by f.issue_date desc limit 1))
                from public.party p left join public.customer_fiscal cf on cf.party_id = p.id where p.id = y.party_id),
    'cambio_datos_abierto', exists (select 1 from public.conta_portal_incidencia i where i.party_id = y.party_id and i.tipo = 'cambio_datos' and i.estado = 'abierta'),
    'personas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', coalesce(x.nombre, x.correo), 'correo', x.correo,
        'permiso', x.permiso, 'soy_yo', x.id = y.id, 'ha_entrado', x.entro_at is not null) order by x.invitado_at)
      from public.conta_portal_acceso x where x.party_id = y.party_id and x.revocado_at is null), '[]'::jsonb),
    'contratado', coalesce((public._conta_portal_proximo(y.account_id, y.party_id)) -> 'lineas',
                           (select r.lineas from public.conta_recibo r where r.account_id = y.account_id and r.party_id = y.party_id order by r.mes desc limit 1),
                           '[]'::jsonb),
    'empresa_id', e);
end $$;

grant execute on function public._conta_portal_yo(uuid, boolean), public._conta_portal_empresa(uuid, uuid), public._conta_portal_marca(uuid, uuid),
  public._conta_portal_estado_recibo(text), public._conta_portal_devuelto_pagado(uuid), public._conta_portal_devueltos(uuid, uuid),
  public._conta_portal_proximo(uuid, uuid), public._conta_portal_cuenta_propia(uuid, uuid),
  public.conta_portal_acceso_usuario(uuid, uuid), public.conta_portal_firma_pedir(uuid, uuid, text, text), public.conta_portal_firma_pdf(uuid, text, text),
  public.conta_portal_incidencia_parada(uuid, boolean, text), public.conta_portal_archivo(uuid, text, uuid, int)
  to service_role;
