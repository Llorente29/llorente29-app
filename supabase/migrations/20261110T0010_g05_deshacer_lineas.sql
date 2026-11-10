-- supabase/migrations/20261110T0010_g05_deshacer_lineas.sql
--
-- G05 · DESHACER UN ALTA, UNA BAJA O UN CAMBIO DE NIVEL DEL MISMO DÍA (Julio,
-- nº 68 y nº 69, punto 3; para la pestaña de Bitrix24 de Code 4). Solo AÑADE:
-- no cambia ninguna función de las que hacen el alta, la baja o el cambio.
--
-- Cada escritura en conta_linea ya queda apuntada, con su antes y su después,
-- en conta_gestoria_cambio (el disparador conta_linea_apuntar, G01). Todo lo que
-- hace una misma llamada lleva la misma hora (now(), la de su transacción): una
-- OPERACIÓN son las filas de un cliente con la misma hora. Se reconocen:
--   · alta: una línea nueva (conta_gestoria_alta_empleado y las altas de línea);
--   · baja: una línea a la que se le pone «hasta» (conta_gestoria_baja_linea);
--   · cambio de nivel: la de antes con «hasta» y la nueva del mismo servicio con
--     otro nivel (conta_tarifa_nivel_cambiar).
--
--   1. conta_linea_deshecha (tabla): las operaciones deshechas, con la hora de
--      la operación y la del deshacer (lo que escribe el deshacer no es una
--      operación nueva que se pueda deshacer).
--   2. conta_linea_operaciones_hoy(empresa, cliente): las de hoy (hora de
--      Madrid) que se pueden deshacer, con su frase y, si no se puede, por qué.
--   3. conta_linea_deshacer(empresa, cuando): la deshace. Solo si es de hoy, es
--      la última de esas líneas y no ha entrado en un recibo enviado (enviado
--      después de la operación); si no, lo dice y no toca nada. Cada línea vuelve
--      a como estaba (la nueva se borra; la cambiada recupera su antes) y queda
--      apuntado. Si ya había un cobro preparado, dice que se vuelva a preparar.
-- Las tres de un administrador o un encargado de la cuenta (_conta_gestoria_puede).
-- Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261110T0010_g05_deshacer_lineas.down.sql

create table if not exists public.conta_linea_deshecha (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  party_id          uuid not null,
  cuando            timestamptz not null,
  deshecha_cuando   timestamptz not null default now(),
  tipo              text not null check (tipo in ('alta', 'baja', 'nivel')),
  frase             text not null,
  quien_name        text,
  unique (account_id, cuando)
);
comment on table public.conta_linea_deshecha is
  'G05 · nº 69 · Las operaciones de conta_linea deshechas el mismo día (conta_linea_deshacer): la hora de la operación (cuando, la de sus filas en conta_gestoria_cambio) y la del deshacer.';
alter table public.conta_linea_deshecha enable row level security;
drop policy if exists conta_linea_deshecha_leer on public.conta_linea_deshecha;
create policy conta_linea_deshecha_leer on public.conta_linea_deshecha for select to authenticated using (public.belongs_to_account(account_id));

/** Las operaciones de conta_linea de un cliente en un día (hora de Madrid), sin las deshechas ni lo que escribió un deshacer. */
create or replace function public._conta_linea_operaciones(p_company uuid, p_party uuid, p_dia date)
returns table (cuando timestamptz, tipo text, filas jsonb, frase text)
language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; r record; v_alta jsonb; v_cambio jsonb; v_cliente text; v_n int;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  select name into v_cliente from public.party where id = p_party;
  for r in
    select c.cuando, jsonb_agg(jsonb_build_object('registro', c.registro_id, 'accion', c.accion, 'antes', c.antes, 'despues', c.despues) order by c.id) as filas
      from public.conta_gestoria_cambio c
     where c.account_id = v_cuenta and c.tabla = 'conta_linea'
       and coalesce(c.despues, c.antes)->>'company_id' = p_company::text and coalesce(c.despues, c.antes)->>'party_id' = p_party::text
       and (c.cuando at time zone 'Europe/Madrid')::date = p_dia
       and not exists (select 1 from public.conta_linea_deshecha d where d.account_id = v_cuenta and (d.cuando = c.cuando or d.deshecha_cuando = c.cuando))
     group by c.cuando
     order by c.cuando
  loop
    v_n := jsonb_array_length(r.filas);
    select x into v_alta from jsonb_array_elements(r.filas) x where x->>'accion' = 'alta' limit 1;
    select x into v_cambio from jsonb_array_elements(r.filas) x where x->>'accion' = 'cambio' limit 1;
    cuando := r.cuando; filas := r.filas;
    if v_n = 1 and v_alta is not null then
      tipo := 'alta';
      frase := format('Alta de %s en %s de %s desde %s', coalesce(nullif(v_alta->'despues'->>'empleado_nombre', ''), nullif(v_alta->'despues'->>'detalle', ''), 'la línea'),
        lower(public._conta_tarifa_nombre((v_alta->'despues'->>'servicio_id')::uuid, (v_alta->'despues'->>'nivel_id')::uuid, null)), v_cliente,
        public._conta_gestoria_mes((v_alta->'despues'->>'desde')::date));
    elsif v_n = 1 and v_cambio is not null and v_cambio->'antes'->>'hasta' is null and v_cambio->'despues'->>'hasta' is not null then
      tipo := 'baja';
      frase := format('Baja de %s en %s de %s desde %s', coalesce(nullif(v_cambio->'despues'->>'empleado_nombre', ''), nullif(v_cambio->'despues'->>'detalle', ''), 'la línea'),
        lower(public._conta_tarifa_nombre((v_cambio->'despues'->>'servicio_id')::uuid, (v_cambio->'despues'->>'nivel_id')::uuid, null)), v_cliente,
        public._conta_gestoria_mes(((v_cambio->'despues'->>'hasta')::date + interval '1 month')::date));
    elsif v_n = 2 and v_alta is not null and v_cambio is not null
          and v_alta->'despues'->>'servicio_id' = v_cambio->'despues'->>'servicio_id'
          and v_alta->'despues'->>'nivel_id' is distinct from v_cambio->'antes'->>'nivel_id' then
      tipo := 'nivel';
      frase := format('%s pasa de %s a %s desde %s', v_cliente,
        public._conta_tarifa_nombre((v_cambio->'antes'->>'servicio_id')::uuid, (v_cambio->'antes'->>'nivel_id')::uuid, null),
        public._conta_tarifa_nombre((v_alta->'despues'->>'servicio_id')::uuid, (v_alta->'despues'->>'nivel_id')::uuid, null),
        public._conta_gestoria_mes((v_alta->'despues'->>'desde')::date));
    else
      tipo := 'otro';
      frase := format('%s cambios en las líneas de %s', v_n, v_cliente);
    end if;
    return next;
  end loop;
end $$;
revoke all on function public._conta_linea_operaciones(uuid, uuid, date) from public, anon, authenticated;

/** Por qué no se puede deshacer una operación (null: se puede). */
create or replace function public._conta_linea_no_se_deshace(p_company uuid, p_party uuid, p_cuando timestamptz, p_tipo text, p_filas jsonb)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_tipo not in ('alta', 'baja', 'nivel') then 'Solo se deshace un alta, una baja o un cambio de nivel.'
    when (p_cuando at time zone 'Europe/Madrid')::date <> (now() at time zone 'Europe/Madrid')::date then 'Solo se deshace lo hecho hoy.'
    -- Lo que ha pasado después con esas mismas líneas (sin contar lo deshecho ni lo que escribió un deshacer).
    when exists (select 1 from public.conta_gestoria_cambio c, jsonb_array_elements(p_filas) x
                  where c.tabla = 'conta_linea' and c.registro_id = (x->>'registro')::uuid and c.cuando > p_cuando
                    and not exists (select 1 from public.conta_linea_deshecha d where d.company_id = p_company and (d.cuando = c.cuando or d.deshecha_cuando = c.cuando)))
      then 'Después se ha cambiado otra vez esa línea: deshaz antes lo último.'
    when exists (select 1 from public.conta_recibo r where r.company_id = p_company and r.party_id = p_party and r.enviado_at >= p_cuando)
      then 'Ya se ha enviado a GoCardless un recibo con este cambio: no se deshace aquí.'
  end
$$;
revoke all on function public._conta_linea_no_se_deshace(uuid, uuid, timestamptz, text, jsonb) from public, anon, authenticated;

-- ── Las de hoy de un cliente ────────────────────────────────────────────────────────
create or replace function public.conta_linea_operaciones_hoy(p_company uuid, p_party uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('cuando', o.cuando, 'tipo', o.tipo, 'frase', o.frase || '.',
      'puede', public._conta_linea_no_se_deshace(p_company, p_party, o.cuando, o.tipo, o.filas) is null,
      'porque', public._conta_linea_no_se_deshace(p_company, p_party, o.cuando, o.tipo, o.filas)) order by o.cuando desc)
    from public._conta_linea_operaciones(p_company, p_party, (now() at time zone 'Europe/Madrid')::date) o
   where o.tipo <> 'otro'), '[]'::jsonb);
end $$;
revoke all on function public.conta_linea_operaciones_hoy(uuid, uuid) from public, anon;
grant execute on function public.conta_linea_operaciones_hoy(uuid, uuid) to authenticated;
comment on function public.conta_linea_operaciones_hoy(uuid, uuid) is
  'G05 · nº 69 · Las altas, bajas y cambios de nivel de hoy de un cliente, la más reciente primero, con su frase y si se pueden deshacer (y, si no, por qué). De un administrador o un encargado.';

-- ── Deshacer ────────────────────────────────────────────────────────────────────────
create or replace function public.conta_linea_deshacer(p_company uuid, p_party uuid, p_cuando timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_gestoria_puede(p_company); o record; v_no text; x jsonb; v_quien text := public.conta_nombre_actor();
  v_preparado text; v_l public.conta_linea;
begin
  perform pg_advisory_xact_lock(hashtext('conta_linea_deshacer:' || p_company::text || ':' || p_party::text));
  if exists (select 1 from public.conta_linea_deshecha where account_id = v_cuenta and cuando = p_cuando) then
    raise exception 'Eso ya está deshecho.' using errcode = '23505';
  end if;
  select * into o from public._conta_linea_operaciones(p_company, p_party, (p_cuando at time zone 'Europe/Madrid')::date) q where q.cuando = p_cuando;
  if o.cuando is null then raise exception 'No encuentro ese cambio en las líneas de este cliente.' using errcode = 'P0002'; end if;
  v_no := public._conta_linea_no_se_deshace(p_company, p_party, o.cuando, o.tipo, o.filas);
  if v_no is not null then raise exception '%', v_no using errcode = '23514'; end if;
  -- Cada línea, como estaba: lo nuevo se borra; lo cambiado recupera su antes. En orden inverso.
  for x in select e from jsonb_array_elements(o.filas) with ordinality t(e, n) order by n desc loop
    if x->>'accion' = 'alta' then
      delete from public.conta_linea where id = (x->>'registro')::uuid;
    elsif x->>'accion' = 'cambio' then
      v_l := jsonb_populate_record(null::public.conta_linea, x->'antes');
      update public.conta_linea set servicio_id = v_l.servicio_id, tipo = v_l.tipo, detalle = v_l.detalle, empleado_nombre = v_l.empleado_nombre,
             employee_id = v_l.employee_id, importe_propio = v_l.importe_propio, periodo = v_l.periodo, desde = v_l.desde, hasta = v_l.hasta,
             nivel_id = v_l.nivel_id, alta_el = v_l.alta_el, baja_el = v_l.baja_el, updated_at = now(), updated_by_name = v_quien
       where id = (x->>'registro')::uuid;
    end if;
  end loop;
  insert into public.conta_linea_deshecha (account_id, company_id, party_id, cuando, tipo, frase, quien_name)
  values (v_cuenta, p_company, p_party, o.cuando, o.tipo, o.frase, v_quien);
  -- Un cobro ya preparado se calculó con el cambio: hay que volver a prepararlo.
  select string_agg(distinct public._conta_gestoria_mes((r.mes || '-01')::date), ', ') into v_preparado
    from public.conta_recibo r where r.company_id = p_company and r.party_id = p_party and r.estado = 'preparado' and r.updated_at >= o.cuando;
  return jsonb_build_object('tipo', o.tipo, 'cuando', o.cuando,
    'frase', format('Deshecho: %s.%s', o.frase, case when v_preparado is not null then format(' Ya habías preparado el cobro de %s: vuelve a prepararlo.', v_preparado) else '' end));
end $$;
revoke all on function public.conta_linea_deshacer(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.conta_linea_deshacer(uuid, uuid, timestamptz) to authenticated;
comment on function public.conta_linea_deshacer(uuid, uuid, timestamptz) is
  'G05 · nº 69 · Deshace un alta, una baja o un cambio de nivel de hoy (la operación de esa hora en conta_gestoria_cambio): solo si es la última de esas líneas y no ha entrado en un recibo enviado. De un administrador o un encargado.';
