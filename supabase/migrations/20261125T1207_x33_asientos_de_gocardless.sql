-- supabase/migrations/20261125T1207_x33_asientos_de_gocardless.sql
--
-- X33 · Los asientos de GoCardless de una empresa de QBO, desde lo que ya trae Sumied de GoCardless (conta_gc_cobro y
-- conta_gc_payout), como en el libro mayor de QBO (_shared/cobro/asientos.ts, G05, 09/11):
--
--   · el cobro:      57200002 «Plataforma GoCardless» / 430 del cliente, por el importe entero, con la fecha del cobro
--                    y el concepto «nº de factura-nombre»;
--   · la devolución: 430 del cliente / 57200002 (se deshace el cobro);
--   · el ingreso:    57200000 banco / 57200002, por lo que llega (el neto) el día que llega.
--   (La comisión no va aquí: llega en la factura mensual de GoCardless, que es una factura recibida, a la 629.)
--
-- PREPARA, NO SUBE: el asiento queda propuesto («por revisar»), como los demás que propone Sumied, y solo sale a ERP10
-- cuando una persona lo valida y la salida de la empresa está encendida (lo decide Julio en Ajustes).
--
-- LO QUE NO SE SABE NO SE INVENTA: un cobro sin su cliente de Sumied, sin su 430 (conta_cobro_cliente.codigo_cliente,
-- que deja ahí el X14 al traer los clientes de ERP10) o sin su número de factura (la factura emitida del cliente por ese importe, que llega de ERP10
-- con el X14) no tiene asiento: queda en
-- «Pendiente de revisar» con su motivo, y el resto sigue. La devolución, también, mientras no se sepa su día.
--
-- NADA DOS VECES: cada cobro, devolución o ingreso tiene una fila en conta_gc_asiento (por su id de GoCardless) y su
-- asiento lleva un origen fijo (customer_payment, con un source_id que sale de la empresa, la clase y el id de
-- GoCardless); prepararlo otra vez no escribe otro. Y una liquidación ya casada en Bancos no se vuelve a asentar.
--
-- Solo añade: una tabla y tres funciones nuevas. Nada en el camino del pedido.

create table if not exists public.conta_gc_asiento (
  company_id uuid not null references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  clase text not null check (clase in ('cobro', 'devolucion', 'ingreso')),
  gc_id text not null,
  fecha date not null,
  importe numeric(14,2) not null,
  nombre text,
  cuenta text,
  concepto text,
  entry_id uuid references public.journal_entry(id) on delete set null,
  pendiente text[] not null default '{}',
  preparado_en timestamptz not null default now(),
  preparado_por_nombre text,
  primary key (company_id, clase, gc_id)
);
comment on table public.conta_gc_asiento is
  'X33 · Los asientos de GoCardless preparados desde conta_gc_cobro y conta_gc_payout: uno por cobro, devolución o ingreso. Con asiento (entry_id) o en «Pendiente de revisar» con su motivo.';
create index if not exists conta_gc_asiento_mes on public.conta_gc_asiento (company_id, fecha);

alter table public.conta_gc_asiento enable row level security;
drop policy if exists conta_gc_asiento_leer on public.conta_gc_asiento;
create policy conta_gc_asiento_leer on public.conta_gc_asiento
  for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_gc_asiento from anon;
grant select on public.conta_gc_asiento to authenticated;
grant all on public.conta_gc_asiento to service_role;

-- El número de la factura de un cobro de GoCardless: la factura emitida del mismo cliente, por el mismo importe, con
-- fecha del día del cobro o de los dos meses de antes (la más reciente). Las facturas de QBO las emite Cegid: llegan a
-- Sumied con lo que trae de ERP10 el X14. Sin ninguna, null, y el cobro queda en «Pendiente de revisar». Es el único
-- sitio que la busca.
create or replace function public._conta_gc_factura_del_cobro(p_company uuid, p_party uuid, p_importe numeric, p_fecha date)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(ci.number_text), ''), nullif(concat_ws('/', ci.series_code, ci.number::text), ''))
    from public.customer_invoice ci
   where ci.company_id = p_company and ci.party_id = p_party and ci.total = p_importe and ci.status = 'emitida'
     and ci.issue_date <= p_fecha and ci.issue_date > p_fecha - 62
   order by ci.issue_date desc, ci.created_at desc
   limit 1
$$;
revoke all on function public._conta_gc_factura_del_cobro(uuid, uuid, numeric, date) from public, anon, authenticated;

-- El plan de un mes: lo que se prepararía, sin escribir nada. Lo usan preparar y la pantalla.
create or replace function public._conta_gc_asientos_plan(p_company uuid, p_mes date)
returns table (clase text, gc_id text, fecha date, importe numeric, party_id uuid, nombre text, cuenta text, concepto text,
               lineas jsonb, pendiente text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month')::date;
  v_aj public.conta_gestoria_ajustes;
  v_pre text; v_pla text; v_ban text; v_d int;
  v_x record; v_cta text; v_num text; v_con text; v_pen text[];
begin
  select * into v_aj from public.conta_gestoria_ajustes a where a.company_id = p_company;
  v_pre := coalesce(nullif(v_aj.prefijo_cliente, ''), '430');
  v_pla := coalesce(nullif(v_aj.cuenta_plataforma, ''), '57200002');
  v_ban := coalesce(nullif(v_aj.cuenta_banco, ''), '57200000');
  select length(a.code) into v_d from public.company_account a where a.company_id = p_company limit 1;
  v_d := coalesce(v_d, 8);

  -- Los cobros del mes (confirmados, liquidados o retrocedidos después): el cobro, y si se retrocedió, su devolución.
  for v_x in
    select c.gc_id, c.estado, c.fecha, c.importe, k.party_id, coalesce(p.name, k.nombre) as nombre, cc.codigo_cliente
      from public.conta_gc_cobro c
      left join public.conta_gc_mandato m on m.company_id = c.company_id and m.gc_id = c.mandato_gc_id
      left join public.conta_gc_cliente k on k.company_id = c.company_id and k.gc_id = m.gc_cliente_id
      left join public.party p on p.id = k.party_id
      left join public.conta_cobro_cliente cc on cc.company_id = c.company_id and cc.party_id = k.party_id
     where c.company_id = p_company and c.fecha >= v_ini and c.fecha < v_fin
       and c.estado in ('confirmed', 'paid_out', 'charged_back')
     order by c.fecha, c.gc_id
  loop
    v_pen := '{}';
    v_cta := null;
    if v_x.party_id is null then v_pen := v_pen || 'El cobro no está atado a ningún cliente de Sumied'::text;
    elsif v_x.codigo_cliente is null then v_pen := v_pen || 'El cliente no tiene su 430'::text;
    elsif v_x.codigo_cliente <= 0 or length(v_x.codigo_cliente::text) > v_d - length(v_pre) then
      v_pen := v_pen || format('El código de cliente %s no cabe en una subcuenta %s de %s cifras', v_x.codigo_cliente, v_pre, v_d);
    else
      v_cta := v_pre || lpad(v_x.codigo_cliente::text, v_d - length(v_pre), '0');
    end if;
    v_num := case when v_x.party_id is null then null else public._conta_gc_factura_del_cobro(p_company, v_x.party_id, v_x.importe, v_x.fecha) end;
    if v_num is null then v_pen := v_pen || 'Falta el número de factura'::text; end if;
    v_con := coalesce(v_num, '—') || '-' || coalesce(v_x.nombre, 'sin nombre');
    if v_x.importe is null or v_x.importe <= 0 then v_pen := v_pen || 'El cobro tiene que ser mayor que cero'::text; end if;
    clase := 'cobro'; gc_id := v_x.gc_id; fecha := v_x.fecha; importe := v_x.importe; party_id := v_x.party_id; nombre := v_x.nombre;
    cuenta := v_cta; concepto := v_con; pendiente := v_pen;
    lineas := case when cardinality(v_pen) = 0 then jsonb_build_array(
      jsonb_build_object('cuenta', v_pla, 'debe', v_x.importe, 'haber', 0, 'concepto', v_con, 'tercero_id', v_x.party_id),
      jsonb_build_object('cuenta', v_cta, 'debe', 0, 'haber', v_x.importe, 'concepto', v_con, 'tercero_id', v_x.party_id)) end;
    return next;
    if v_x.estado = 'charged_back' then
      clase := 'devolucion'; concepto := 'Retrocedido ' || v_con; lineas := null;
      pendiente := v_pen || 'Falta el día de la devolución'::text;
      return next;
    end if;
  end loop;

  -- Lo que llega al banco: el ingreso de cada liquidación del mes. Una ya casada en Bancos (match_id) ya tiene su
  -- asiento (G05: el ingreso lo casa Bancos): no se prepara otro.
  for v_x in
    select y.gc_id, y.llegada, y.importe, y.referencia
      from public.conta_gc_payout y
     where y.company_id = p_company and y.llegada >= v_ini and y.llegada < v_fin and y.estado = 'paid' and y.match_id is null
     order by y.llegada, y.gc_id
  loop
    clase := 'ingreso'; gc_id := v_x.gc_id; fecha := v_x.llegada; importe := v_x.importe; party_id := null; nombre := null;
    cuenta := v_ban; concepto := 'Ingreso de GoCardless ' || coalesce(v_x.referencia, v_x.gc_id);
    pendiente := case when v_x.importe is null or v_x.importe = 0 then array['La liquidación no trae importe'] else '{}' end;
    lineas := case when cardinality(pendiente) > 0 then null
      when v_x.importe > 0 then jsonb_build_array(
        jsonb_build_object('cuenta', v_ban, 'debe', v_x.importe, 'haber', 0, 'concepto', concepto),
        jsonb_build_object('cuenta', v_pla, 'debe', 0, 'haber', v_x.importe, 'concepto', concepto))
      else jsonb_build_array(
        jsonb_build_object('cuenta', v_pla, 'debe', -v_x.importe, 'haber', 0, 'concepto', concepto),
        jsonb_build_object('cuenta', v_ban, 'debe', 0, 'haber', -v_x.importe, 'concepto', concepto)) end;
    return next;
  end loop;
end $$;
revoke all on function public._conta_gc_asientos_plan(uuid, date) from public, anon, authenticated;

-- Preparar los asientos de GoCardless de un mes: un administrador de la cuenta. Devuelve lo que ha hecho, en números.
create or replace function public.conta_gc_asientos_preparar(p_company uuid, p_mes date, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c public.company;
  v_quien text;
  v_x record;
  v_ya public.conta_gc_asiento;
  v_r jsonb;
  v_entry uuid;
  v_aj public.conta_gestoria_ajustes;
  v_pla text;
  v_preparados int := 0; v_seguian int := 0; v_pendientes int := 0;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta prepara los asientos de GoCardless.' using errcode = '42501';
  end if;
  if p_mes is null then raise exception 'Falta el mes.' using errcode = '22023'; end if;
  v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
  select * into v_aj from public.conta_gestoria_ajustes a where a.company_id = v_c.id;
  v_pla := coalesce(nullif(v_aj.cuenta_plataforma, ''), '57200002');
  -- Dos a la vez sobre la misma empresa y el mismo mes no se cruzan.
  perform pg_advisory_xact_lock(hashtextextended('conta_gc_asientos:' || v_c.id::text || ':' || to_char(p_mes, 'YYYY-MM'), 0));

  for v_x in select * from public._conta_gc_asientos_plan(v_c.id, p_mes) loop
    select * into v_ya from public.conta_gc_asiento a where a.company_id = v_c.id and a.clase = v_x.clase and a.gc_id = v_x.gc_id for update;
    -- Ya tiene un asiento vivo: no se escribe otro (nada dos veces).
    if v_ya.entry_id is not null and exists (select 1 from public.journal_entry e where e.id = v_ya.entry_id and e.status in ('propuesto', 'borrador', 'validado')) then
      v_seguian := v_seguian + 1; continue;
    end if;
    v_entry := null;
    if cardinality(v_x.pendiente) = 0 then
      perform public._conta_cobro_cuenta(v_c.id, v_pla, 'Plataforma GoCardless', v_quien);
      if v_x.clase = 'cobro' then perform public._conta_cobro_cuenta(v_c.id, v_x.cuenta, coalesce(v_x.nombre, 'Cliente'), v_quien); end if;
      if v_x.clase = 'ingreso' then perform public._conta_cobro_cuenta(v_c.id, v_x.cuenta, 'Banco', v_quien); end if;
      v_r := public._journal_entry_proponer(v_c.id,
        jsonb_build_object('series', 4, 'fecha', v_x.fecha, 'source_type', 'customer_payment',
          'source_id', md5(v_c.id::text || ':' || v_x.clase || ':' || v_x.gc_id)::uuid, 'concepto', v_x.concepto,
          'party_id', v_x.party_id, 'confianza', 'seguro',
          'porque', case v_x.clase when 'cobro' then 'Cobro de GoCardless (X33).' else 'Ingreso de GoCardless en el banco (X33).' end),
        v_x.lineas, null, v_quien, auth.uid());
      v_entry := (v_r->>'id')::uuid;
      v_preparados := v_preparados + 1;
    else
      v_pendientes := v_pendientes + 1;
    end if;
    insert into public.conta_gc_asiento (company_id, account_id, clase, gc_id, fecha, importe, nombre, cuenta, concepto, entry_id, pendiente,
                                         preparado_en, preparado_por_nombre)
    values (v_c.id, v_c.account_id, v_x.clase, v_x.gc_id, v_x.fecha, v_x.importe, v_x.nombre, v_x.cuenta, v_x.concepto, v_entry, v_x.pendiente,
            now(), v_quien)
    on conflict (company_id, clase, gc_id) do update set fecha = excluded.fecha, importe = excluded.importe, nombre = excluded.nombre,
      cuenta = excluded.cuenta, concepto = excluded.concepto, entry_id = excluded.entry_id, pendiente = excluded.pendiente,
      preparado_en = excluded.preparado_en, preparado_por_nombre = excluded.preparado_por_nombre;
  end loop;

  return jsonb_build_object('preparados', v_preparados, 'ya_estaban', v_seguian, 'pendientes', v_pendientes,
    'texto', format('%s preparados · %s ya estaban · %s en «Pendiente de revisar».', v_preparados, v_seguian, v_pendientes));
end $$;
comment on function public.conta_gc_asientos_preparar(uuid, date, text) is
  'X33 · Prepara (propuestos, sin subir) los asientos de GoCardless del mes: cobro, devolución e ingreso. Sin cliente, sin 430 o sin número de factura: «Pendiente de revisar». Nada dos veces.';
revoke all on function public.conta_gc_asientos_preparar(uuid, date, text) from public, anon;
grant execute on function public.conta_gc_asientos_preparar(uuid, date, text) to authenticated, service_role;

-- Lo preparado de un mes, para la pantalla: cada fila con su asiento (número y estado) o su motivo.
create or replace function public.conta_gc_asientos_del_mes(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_c public.company;
  v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month')::date;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or (auth.uid() is not null and not public.belongs_to_account(v_c.account_id)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if p_mes is null then raise exception 'Falta el mes.' using errcode = '22023'; end if;
  return jsonb_build_object(
    'por_preparar', (select count(*) from public._conta_gc_asientos_plan(v_c.id, p_mes) x
                      where not exists (select 1 from public.conta_gc_asiento a where a.company_id = v_c.id and a.clase = x.clase and a.gc_id = x.gc_id)),
    'filas', coalesce((select jsonb_agg(jsonb_build_object('clase', a.clase, 'gc_id', a.gc_id, 'fecha', a.fecha, 'importe', a.importe,
        'nombre', a.nombre, 'cuenta', a.cuenta, 'concepto', a.concepto, 'pendiente', to_jsonb(a.pendiente), 'entry_id', a.entry_id,
        'numero', case when e.id is null then null else e.series || '/' || coalesce(e.number::text, '—') end, 'estado', e.status)
        order by cardinality(a.pendiente) > 0 desc, a.fecha, a.clase, a.gc_id)
      from public.conta_gc_asiento a left join public.journal_entry e on e.id = a.entry_id
     where a.company_id = v_c.id and a.account_id = v_c.account_id and a.fecha >= v_ini and a.fecha < v_fin), '[]'::jsonb));
end $$;
comment on function public.conta_gc_asientos_del_mes(uuid, date) is
  'X33 · Los asientos de GoCardless preparados del mes (con su asiento o en «Pendiente de revisar» con su motivo), y cuántos quedan por preparar.';
revoke all on function public.conta_gc_asientos_del_mes(uuid, date) from public, anon;
grant execute on function public.conta_gc_asientos_del_mes(uuid, date) to authenticated, service_role;
