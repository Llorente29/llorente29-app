-- supabase/migrations/20261110T0700_g05_trabajo_suelto.sql
--
-- G05 · nº 69 y nº 71, punto 3 · UN TRABAJO SUELTO (la renta, el alta de un
-- autónomo, una regularización…), «sumado al recibo» del mes. Para la ficha del
-- cliente y la pestaña de Bitrix24 de Code 4.
--
-- Lo que decidió Julio (nº 69): el precio sale de la tarifa (los servicios que se
-- cobran «cada vez») y se puede cambiar cada vez; «Sumarlo al recibo» espera al
-- cobro del mes. «Aparte» (cobrarlo en cuanto se crea) no está en esta tanda: con
-- un recibo por cliente y mes, necesita antes una decisión (va en el PR).
--
-- Añade:
--   1. conta_trabajos_sueltos(empresa, cliente): los servicios que se cobran «cada
--      vez», con su precio para ese cliente (el suyo propio o el de la tarifa), y
--      sus trabajos sueltos de este mes en adelante, con el recibo en que van.
--   2. conta_trabajo_suelto_poner(empresa, cliente, servicio, concepto, importe):
--      una línea «suelto» (la de siempre del G01: un mes, su concepto y su
--      importe) en el mes del próximo recibo: este mes si su recibo aún no se ha
--      enviado; si no, el que viene. Sin importe, el de la tarifa; sin concepto,
--      el nombre del servicio. Lo deja apuntado el disparador de siempre
--      (conta_gestoria_cambio), así que «Deshacer» del mismo día lo deshace.
-- Las dos, de un administrador o un encargado (_conta_gestoria_puede).
-- No cambia ninguna función de antes. Nada en el camino del pedido. No toca datos.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0700_g05_trabajo_suelto.down.sql

create or replace function public._conta_suelto_mes(p_company uuid, p_party uuid)
returns date language sql stable security definer set search_path = public as $$
  -- El mes del próximo recibo: este, si su recibo no se ha enviado aún; si no, el que viene.
  select case when exists (select 1 from public.conta_recibo r
                            where r.company_id = p_company and r.party_id = p_party
                              and r.mes = to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM') and r.estado <> 'preparado')
              then (date_trunc('month', (now() at time zone 'Europe/Madrid')::date) + interval '1 month')::date
              else date_trunc('month', (now() at time zone 'Europe/Madrid')::date)::date end
$$;
revoke all on function public._conta_suelto_mes(uuid, uuid) from public, anon, authenticated;

create or replace function public._conta_suelto_precio(p_company uuid, p_party uuid, p_servicio uuid, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  -- El precio «cada vez» de un servicio para un cliente ese mes: el suyo propio, si lo tiene; si no, el de la tarifa.
  select p.importe from public.conta_precio p
   where p.company_id = p_company and p.servicio_id = p_servicio and p.nivel_id is null and p.paquete_id is null
     and p.forma = 'fijo' and p.periodo = 'vez' and (p.party_id is null or p.party_id = p_party)
     and p.desde <= p_mes and (p.hasta is null or p.hasta >= p_mes)
   order by (p.party_id is not null) desc, p.desde desc limit 1
$$;
revoke all on function public._conta_suelto_precio(uuid, uuid, uuid, date) from public, anon, authenticated;

create or replace function public.conta_trabajos_sueltos(p_company uuid, p_party uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); v_mes date := public._conta_suelto_mes(p_company, p_party);
begin
  if not exists (select 1 from public.party where id = p_party and account_id = v_cuenta) then raise exception 'Ese cliente no está.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'mes', to_char(v_mes, 'YYYY-MM'),
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object('servicio_id', s.id, 'nombre', s.nombre, 'importe', x.importe,
               'de', case when exists (select 1 from public.conta_precio q where q.company_id = p_company and q.servicio_id = s.id and q.party_id = p_party
                                         and q.forma = 'fijo' and q.periodo = 'vez' and q.desde <= v_mes and (q.hasta is null or q.hasta >= v_mes))
                          then 'su_precio' else 'tarifa' end) order by s.nombre)
        from public.conta_servicio s
        cross join lateral (select public._conta_suelto_precio(p_company, p_party, s.id, v_mes) as importe) x
       where s.company_id = p_company and s.activo and x.importe is not null), '[]'::jsonb),
    'hechos', coalesce((
      select jsonb_agg(jsonb_build_object('linea_id', l.id, 'concepto', l.detalle, 'importe', l.importe_propio, 'mes', to_char(l.desde, 'YYYY-MM'),
               'servicio', s.nombre, 'quien', l.created_by_name, 'cuando', l.created_at,
               'recibo', (select jsonb_build_object('id', r.id, 'estado', r.estado) from public.conta_recibo r
                           where r.company_id = l.company_id and r.party_id = l.party_id and r.mes = to_char(l.desde, 'YYYY-MM')))
             order by l.desde, l.created_at)
        from public.conta_linea l join public.conta_servicio s on s.id = l.servicio_id
       where l.company_id = p_company and l.party_id = p_party and l.tipo = 'suelto'
         and l.desde >= date_trunc('month', (now() at time zone 'Europe/Madrid')::date)), '[]'::jsonb));
end $$;
revoke all on function public.conta_trabajos_sueltos(uuid, uuid) from public, anon;
grant execute on function public.conta_trabajos_sueltos(uuid, uuid) to authenticated, service_role;

create or replace function public.conta_trabajo_suelto_poner(p_company uuid, p_party uuid, p_servicio uuid, p_concepto text default null, p_importe numeric default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_cuenta uuid := public._conta_gestoria_puede(p_company); v_quien text := public.conta_nombre_actor();
  v_mes date; v_s public.conta_servicio; v_importe numeric; v_concepto text; v_id uuid; v_preparado boolean; v_nombre text;
begin
  if not exists (select 1 from public.party where id = p_party and account_id = v_cuenta) then raise exception 'Ese cliente no está.' using errcode = 'P0002'; end if;
  select * into v_s from public.conta_servicio where id = p_servicio and company_id = p_company;
  if v_s.id is null then raise exception 'Ese servicio no es de esta empresa.' using errcode = 'P0002'; end if;
  -- Uno a la vez por cliente y empresa: dos clics no ponen dos.
  perform pg_advisory_xact_lock(hashtextextended('conta_suelto:' || p_company || ':' || p_party, 0));
  v_mes := public._conta_suelto_mes(p_company, p_party);
  v_importe := coalesce(p_importe, public._conta_suelto_precio(p_company, p_party, p_servicio, v_mes));
  if v_importe is null then raise exception 'Este servicio no tiene precio «cada vez» en la tarifa: di cuánto se cobra.' using errcode = '22023'; end if;
  if v_importe <= 0 then raise exception 'El importe tiene que ser mayor que cero.' using errcode = '22023'; end if;
  if v_importe <> round(v_importe, 2) then raise exception 'El importe va en euros con dos decimales como mucho.' using errcode = '22023'; end if;
  v_concepto := coalesce(nullif(trim(coalesce(p_concepto, '')), ''), v_s.nombre);
  if length(v_concepto) > 200 then raise exception 'El concepto es demasiado largo (200 caracteres como mucho).' using errcode = '22023'; end if;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, tipo, detalle, origen, importe_propio, periodo, desde, hasta, created_by_name, updated_by_name)
  values (v_cuenta, p_company, p_party, p_servicio, 'suelto', v_concepto, 'manual', v_importe, 'unidad', v_mes, v_mes, v_quien, v_quien)
  returning id into v_id;
  select exists (select 1 from public.conta_recibo r where r.company_id = p_company and r.party_id = p_party
                  and r.mes = to_char(v_mes, 'YYYY-MM') and r.estado = 'preparado') into v_preparado;
  select name into v_nombre from public.party where id = p_party;
  return jsonb_build_object('id', v_id, 'mes', to_char(v_mes, 'YYYY-MM'), 'importe', v_importe, 'concepto', v_concepto,
    'frase', format('Sumado al recibo de %s de %s: %s, %s.%s',
      (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from v_mes)::int],
      coalesce(v_nombre, 'el cliente'), v_concepto, public._conta_gestoria_euros(v_importe),
      case when v_preparado then ' Ya habías preparado el cobro de ese mes: vuelve a prepararlo.' else '' end));
end $$;
revoke all on function public.conta_trabajo_suelto_poner(uuid, uuid, uuid, text, numeric) from public, anon;
grant execute on function public.conta_trabajo_suelto_poner(uuid, uuid, uuid, text, numeric) to authenticated, service_role;

comment on function public.conta_trabajo_suelto_poner(uuid, uuid, uuid, text, numeric) is
  'G05 · nº 71 · Un trabajo suelto sumado al próximo recibo del cliente (este mes si no se ha enviado; si no, el que viene), con el precio de la tarifa o el que se diga. De un administrador o un encargado.';
