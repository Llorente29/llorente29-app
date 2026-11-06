-- supabase/migrations/20261106T1932_g01_tarifas_y_reintentos.sql
--
-- G01 · Tarea 4 (06/11/2026) · Lo que necesitan las pantallas. SOLO AÑADE:
-- una columna nueva con valor por defecto y dos funciones nuevas.
--
--   1. conta_cobro_gocardless.reintentos_inteligentes: el interruptor de
--      «Reintentos inteligentes» de GoCardless (Julio, tarea 4), apagado por
--      defecto. En este encargo solo se guarda: todavía no se cobra nada, y
--      puede tener coste según el plan de GoCardless (lo dice la pantalla).
--   2. conta_gestoria_tarifa_guardar: guarda la tarifa general o la propia de un
--      cliente «desde el mes» que se diga. Si ya había una que valía ese mes,
--      la cierra el mes de antes (su «hasta») y abre la nueva: cada cambio
--      queda en conta_gestoria_cambio (el disparador de la 1530). Devuelve la
--      frase de la confirmación, con contenido (regla 8): «Tarifa laboral de
--      <cliente>: 24,20 € desde diciembre. Afecta a 3 empleados».
--   3. conta_gocardless_reintentos: enciende o apaga el interruptor.
-- Las dos funciones, para una persona administradora o encargada de la cuenta.
-- Nombre: conta_gestoria_tarifa_guardar, no conta_tarifa_guardar, que ya es
-- la de las tarifas de los proveedores (E05, 20261112T0120): la misma con
-- otros argumentos sería una sobrecarga, y el análisis de la tanda la para.
-- Vuelta atrás: supabase/vuelta-atras/20261106T1932_g01_tarifas_y_reintentos.down.sql

alter table public.conta_cobro_gocardless add column if not exists reintentos_inteligentes boolean not null default false;
comment on column public.conta_cobro_gocardless.reintentos_inteligentes is
  'G01 · «Reintentos inteligentes» de GoCardless: apagado por defecto. Solo se guarda (todavía no se cobra nada); puede tener coste según el plan de GoCardless.';

create or replace function public.conta_gestoria_tarifa_guardar(p_company uuid, p_servicio uuid, p_party uuid, p_importe numeric, p_periodo text, p_desde date, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_mes date := date_trunc('month', p_desde)::date; v_quien text; v_serv public.conta_servicio; v_cliente text;
        v_id uuid; v_afecta int; v_meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia una tarifa.' using errcode = '42501';
  end if;
  select * into v_serv from public.conta_servicio where id = p_servicio and company_id = p_company;
  if v_serv.id is null then raise exception 'Ese servicio no es de esta empresa.' using errcode = 'P0002'; end if;
  if p_party is not null and not exists (select 1 from public.party where id = p_party and account_id = v_cuenta) then
    raise exception 'Ese cliente no es de esta cuenta.' using errcode = 'P0002';
  end if;
  if p_importe is null or p_importe < 0 then raise exception 'El importe tiene que ser cero o más.' using errcode = '22023'; end if;
  if p_periodo not in ('mes', 'anio', 'unidad') then raise exception 'Cada cuánto: al mes, al año o por unidad.' using errcode = '22023'; end if;
  if v_mes is null then raise exception 'Di desde qué mes vale.' using errcode = '22023'; end if;
  v_quien := public.conta_nombre_actor();

  -- La que valía ese mes (o después) para lo mismo, se cierra el mes de antes.
  update public.conta_tarifa t set hasta = (v_mes - interval '1 month')::date, motivo = coalesce(nullif(trim(p_motivo), ''), t.motivo)
   where t.company_id = p_company and t.servicio_id = p_servicio and t.party_id is not distinct from p_party
     and t.desde < v_mes and (t.hasta is null or t.hasta >= v_mes);
  delete from public.conta_tarifa t
   where t.company_id = p_company and t.servicio_id = p_servicio and t.party_id is not distinct from p_party and t.desde >= v_mes;
  insert into public.conta_tarifa (account_id, company_id, servicio_id, party_id, importe, periodo, desde, motivo, origen, created_by, created_by_name)
  values (v_cuenta, p_company, p_servicio, p_party, round(p_importe, 2), p_periodo, v_mes, nullif(trim(p_motivo), ''), 'manual', auth.uid(), v_quien)
  returning id into v_id;

  -- A cuántas líneas afecta: las de alta ese mes o después, sin importe propio
  -- (con la general, las de los clientes que no tienen propia).
  select count(*) into v_afecta from public.conta_linea l
   where l.company_id = p_company and l.servicio_id = p_servicio and l.importe_propio is null
     and (l.hasta is null or l.hasta >= v_mes)
     and (case when p_party is null
               then not exists (select 1 from public.conta_tarifa x where x.company_id = p_company and x.servicio_id = p_servicio and x.party_id = l.party_id
                                  and x.desde <= v_mes and (x.hasta is null or x.hasta >= v_mes))
               else l.party_id = p_party end);
  select name into v_cliente from public.party where id = p_party;
  return jsonb_build_object('id', v_id, 'afecta', v_afecta,
    'frase', format('%s%s: %s desde %s. Afecta a %s %s.',
      case when v_serv.clave = 'gestion_laboral' then 'Tarifa laboral' else 'Tarifa de ' || lower(v_serv.nombre) end,
      case when p_party is null then ' general' else ' de ' || v_cliente end,
      replace(replace(replace(to_char(round(p_importe, 2), 'FM999,999,990.00'), ',', '#'), '.', ','), '#', '.') || ' €',
      v_meses[extract(month from v_mes)::int],
      v_afecta,
      case when v_serv.forma = 'por_empleado' then case when v_afecta = 1 then 'empleado' else 'empleados' end
           else case when v_afecta = 1 then 'línea' else 'líneas' end end));
end $$;
revoke all on function public.conta_gestoria_tarifa_guardar(uuid, uuid, uuid, numeric, text, date, text) from public, anon;
grant execute on function public.conta_gestoria_tarifa_guardar(uuid, uuid, uuid, numeric, text, date, text) to authenticated;

create or replace function public.conta_gocardless_reintentos(p_company uuid, p_encendido boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_nombre text;
begin
  select account_id, coalesce(trade_name, legal_name) into v_cuenta, v_nombre from public.company where id = p_company;
  if v_cuenta is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia los reintentos.' using errcode = '42501';
  end if;
  update public.conta_cobro_gocardless set reintentos_inteligentes = coalesce(p_encendido, false), updated_at = now() where company_id = p_company;
  if not found then raise exception 'Esta empresa aún no tiene conectada su cuenta de GoCardless.' using errcode = 'P0002'; end if;
  return jsonb_build_object('encendido', coalesce(p_encendido, false),
    'frase', case when p_encendido then format('Reintentos inteligentes encendidos para %s. Se usarán cuando Sumied cobre; hoy no se cobra nada.', v_nombre)
                  else format('Reintentos inteligentes apagados para %s.', v_nombre) end);
end $$;
revoke all on function public.conta_gocardless_reintentos(uuid, boolean) from public, anon;
grant execute on function public.conta_gocardless_reintentos(uuid, boolean) to authenticated;
