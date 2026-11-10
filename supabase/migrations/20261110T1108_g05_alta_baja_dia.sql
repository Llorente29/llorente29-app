-- supabase/migrations/20261110T1108_g05_alta_baja_dia.sql
-- cambia: public.conta_linea · prueba: supabase/staging/sql/20261110_g05_alta_baja_dia_prueba.sql
--
-- G05 · nº 77, punto 1 · EL ALTA Y LA BAJA DE UN TRABAJADOR CON SU DÍA Y SU DNI O
-- NIE. Las de la ficha (G01) solo admiten el mes; la pestaña de Bitrix24 (Code 4)
-- y la maqueta piden el día y el documento.
--
-- Solo añade. Las dos de antes (conta_gestoria_alta_empleado y
-- conta_gestoria_baja_linea) se quedan como están: cambiarles la firma sería
-- borrarlas y crearlas (regla 2) y las llaman la ficha y la pestaña.
--   1. conta_linea.empleado_documento: el DNI o NIE del trabajador, sin espacios
--      ni guiones, con la misma forma que el de Code 3 (conta_solicitud) y la
--      letra de control comprobada.
--   2. _conta_dni_nie_valido(texto): la letra de control de un DNI o un NIE.
--   3. conta_gestoria_alta_trabajador(empresa, cliente, servicio, nombre, día,
--      documento): la línea desde el mes del día, con el día en alta_el (para la
--      parte proporcional, si la gestoría la cobra así). El documento es opcional;
--      si se da, tiene que ser válido y no estar ya de alta en ese servicio.
--   4. conta_gestoria_baja_trabajador(línea, día): hasta el mes del día, con el día
--      en baja_el; nunca antes del alta.
-- Las dos, de un administrador o un encargado (_conta_gestoria_puede); lo apunta
-- el disparador de siempre (conta_gestoria_cambio), así que «Deshacer» las deshace.
-- Nada en el camino del pedido. No toca datos.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1108_g05_alta_baja_dia.down.sql

alter table public.conta_linea add column if not exists empleado_documento text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conta_linea_empleado_documento') then
    alter table public.conta_linea add constraint conta_linea_empleado_documento
      check (empleado_documento is null or empleado_documento ~ '^[0-9XYZ][0-9]{7}[A-Z]$');
  end if;
end $$;
comment on column public.conta_linea.empleado_documento is 'G05 · El DNI o NIE del trabajador de la línea (sin espacios ni guiones), si se sabe.';

create or replace function public._conta_dni_nie_valido(p_doc text)
returns boolean language sql immutable as $$
  select p_doc ~ '^[0-9XYZ][0-9]{7}[A-Z]$'
     and substr('TRWAGMYFPDXBNJZSQVHLCKE',
                ((translate(left(p_doc, 1), 'XYZ', '012') || substr(p_doc, 2, 7))::bigint % 23 + 1)::int, 1) = right(p_doc, 1)
$$;

create or replace function public.conta_gestoria_alta_trabajador(p_company uuid, p_party uuid, p_servicio uuid, p_empleado text, p_dia date, p_documento text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public._conta_gestoria_puede(p_company); v_mes date := date_trunc('month', p_dia)::date;
  v_serv public.conta_servicio; v_cliente text; v_id uuid; v_importe numeric; v_nombre text := upper(trim(coalesce(p_empleado, '')));
  v_doc text := nullif(upper(regexp_replace(coalesce(p_documento, ''), '[\s.-]', '', 'g')), '');
begin
  select * into v_serv from public.conta_servicio where id = p_servicio and company_id = p_company;
  if v_serv.id is null then raise exception 'Ese servicio no es de esta empresa.' using errcode = 'P0002'; end if;
  if v_serv.forma <> 'por_empleado' then raise exception '«%» no se cobra por trabajador.', v_serv.nombre using errcode = '22023'; end if;
  select name into v_cliente from public.party where id = p_party and account_id = v_cuenta;
  if v_cliente is null then raise exception 'Ese cliente no es de esta cuenta.' using errcode = 'P0002'; end if;
  if v_nombre = '' then raise exception 'Escribe el nombre del trabajador.' using errcode = '22023'; end if;
  if p_dia is null then raise exception 'Di el día del alta.' using errcode = '22023'; end if;
  if v_doc is not null and not public._conta_dni_nie_valido(v_doc) then
    raise exception 'El DNI o NIE % no es válido: revisa los números y la letra.', v_doc using errcode = '22023';
  end if;
  if exists (select 1 from public.conta_linea where company_id = p_company and party_id = p_party and servicio_id = p_servicio
               and (upper(empleado_nombre) = v_nombre or (v_doc is not null and empleado_documento = v_doc)) and (hasta is null or hasta >= v_mes)) then
    raise exception '% ya está de alta en % de %.', coalesce(v_doc, v_nombre), v_serv.nombre, v_cliente using errcode = '23505';
  end if;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, empleado_documento, origen, periodo, desde, alta_el, created_by_name)
  values (v_cuenta, p_company, p_party, p_servicio, v_nombre, v_doc, 'manual', 'mes', v_mes, p_dia, public.conta_nombre_actor())
  returning id into v_id;
  v_importe := public.conta_linea_al_mes(v_id, v_mes);
  return jsonb_build_object('id', v_id, 'desde', v_mes, 'alta_el', p_dia, 'documento', v_doc,
    'frase', format('Alta de %s%s en %s de %s el %s: %s.', v_nombre, coalesce(' (' || v_doc || ')', ''), lower(v_serv.nombre), v_cliente,
      to_char(p_dia, 'DD/MM/YYYY'), case when v_importe is null then 'aún sin tarifa' else public._conta_gestoria_euros(v_importe) || ' al mes' end));
end $$;
revoke all on function public.conta_gestoria_alta_trabajador(uuid, uuid, uuid, text, date, text) from public, anon;
grant execute on function public.conta_gestoria_alta_trabajador(uuid, uuid, uuid, text, date, text) to authenticated, service_role;

create or replace function public.conta_gestoria_baja_trabajador(p_linea uuid, p_dia date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_l public.conta_linea; v_mes date := date_trunc('month', p_dia)::date; v_serv text; v_cliente text; v_quien text;
begin
  select * into v_l from public.conta_linea where id = p_linea;
  if v_l.id is null then raise exception 'Esa línea no existe.' using errcode = 'P0002'; end if;
  perform public._conta_gestoria_puede(v_l.company_id);
  if p_dia is null then raise exception 'Di el día de la baja.' using errcode = '22023'; end if;
  if v_mes < v_l.desde or (v_l.alta_el is not null and p_dia < v_l.alta_el) then
    raise exception 'La baja no puede ser antes del alta (%).', coalesce(to_char(v_l.alta_el, 'DD/MM/YYYY'), public._conta_gestoria_mes(v_l.desde)) using errcode = '22023';
  end if;
  update public.conta_linea set hasta = v_mes, baja_el = p_dia, updated_at = now(), updated_by_name = public.conta_nombre_actor() where id = p_linea;
  select s.nombre into v_serv from public.conta_servicio s where s.id = v_l.servicio_id;
  select name into v_cliente from public.party where id = v_l.party_id;
  v_quien := coalesce(v_l.empleado_nombre, nullif(v_l.detalle, ''), v_serv);
  return jsonb_build_object('id', p_linea, 'hasta', v_mes, 'baja_el', p_dia,
    'frase', format('Baja de %s en %s de %s el %s: ya no se cobra desde %s.', v_quien, lower(v_serv), v_cliente,
      to_char(p_dia, 'DD/MM/YYYY'), public._conta_gestoria_mes((v_mes + interval '1 month')::date)));
end $$;
revoke all on function public.conta_gestoria_baja_trabajador(uuid, date) from public, anon;
grant execute on function public.conta_gestoria_baja_trabajador(uuid, date) to authenticated, service_role;
