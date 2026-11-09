-- supabase/migrations/20261109T1344_g05_t4_incluye_y_cuenta.sql
-- cambia: public.conta_pantalla_clientes · prueba: supabase/staging/sql/20261109_g05_t4_prueba.sql
--
-- G05 · Tarea 4 · Lo que necesita el modelo de factura «Sumied» (Julio, nº 41).
-- AÑADE dos cosas y CAMBIA una (declarada arriba, con su respaldo):
--   1. conta_servicio.incluye: el «Qué incluye» de cada servicio (cada nivel ya
--      tiene el suyo), editable en «Tarifa y paquetes»; la factura lo pone
--      debajo del nombre de la línea. Sin poner, la factura usa el de
--      siempre del catálogo de gestoría (laboral: «Nóminas y seguros
--      sociales»); no se rellena ninguna fila que exista.
--   2. conta_gc_mandato.cuenta_final, cuenta_pais y banco: lo que GoCardless da
--      de la cuenta del mandato (customer_bank_accounts: los últimos dígitos, 2
--      en euros, el país y el banco). Lo guarda la lectura; la factura lo
--      enseña enmascarado («ES•• •••• •••• •••• •••• ••21») y, más adelante, el portal.
--   3. conta_tarifa_servicio_incluye: guardar el «Qué incluye» de un servicio
--      (ensaya por defecto, como las demás de la tarifa).
--   4. conta_pantalla_clientes (CAMBIA, misma firma): los servicios llevan su
--      «incluye». Nada más cambia.
-- Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261109T1344_g05_t4_incluye_y_cuenta.down.sql

alter table public.conta_servicio add column if not exists incluye text;
comment on column public.conta_servicio.incluye is 'G05 · Qué incluye el servicio, en una frase («Nóminas y seguros sociales»): la factura lo pone debajo del nombre. Sin poner, el de siempre del catálogo de gestoría.';

alter table public.conta_gc_mandato add column if not exists cuenta_final text;
alter table public.conta_gc_mandato add column if not exists cuenta_pais text;
alter table public.conta_gc_mandato add column if not exists banco text;
comment on column public.conta_gc_mandato.cuenta_final is 'G05 · Los últimos dígitos de la cuenta del mandato que da GoCardless (account_number_ending: 2 en euros). Para enseñarla enmascarada; nunca la cuenta entera.';

create or replace function public.conta_tarifa_servicio_incluye(p_company uuid, p_servicio uuid, p_incluye text, p_ensayo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_s public.conta_servicio; v_quien text := public.conta_nombre_actor(); v_nuevo text := nullif(btrim(coalesce(p_incluye, '')), '');
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then raise exception 'Solo un administrador o un encargado cambia la tarifa.' using errcode = '42501'; end if;
  select * into v_s from public.conta_servicio where id = p_servicio and company_id = p_company;
  if v_s.id is null then raise exception 'Ese servicio no está.' using errcode = 'P0002'; end if;
  if length(coalesce(v_nuevo, '')) > 200 then raise exception 'Qué incluye: una frase corta, de 200 letras como mucho.' using errcode = '22023'; end if;
  if not p_ensayo then
    update public.conta_servicio set incluye = v_nuevo where id = p_servicio;
  end if;
  return jsonb_build_object('ensayo', p_ensayo, 'frase', case when v_nuevo is null
    then format('%s: sin «Qué incluye» propio; la factura pone el de siempre.', v_s.nombre)
    else format('%s incluye «%s»: así sale en las facturas.', v_s.nombre, v_nuevo) end, 'quien', v_quien);
end $$;
revoke all on function public.conta_tarifa_servicio_incluye(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.conta_tarifa_servicio_incluye(uuid, uuid, text, boolean) to authenticated, service_role;

-- La de antes, guardada para la vuelta atrás (_restaurar_funcion).
select public._respaldar_funcion('public.conta_pantalla_clientes(uuid)', '20261109T1344_g05_t4_incluye_y_cuenta');

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
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'company_id', x.company_id, 'clave', x.clave, 'nombre', x.nombre, 'forma', x.forma, 'activo', x.activo, 'incluye', x.incluye) order by x.id)
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
revoke all on function public.conta_pantalla_clientes(uuid) from public, anon;
grant execute on function public.conta_pantalla_clientes(uuid) to authenticated, service_role;
