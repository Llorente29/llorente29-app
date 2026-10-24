-- C12 · Traspaso a Diez una vez al mes, en el cierre (Julio, 24/10).
--
-- QUÉ: en vez de mandar cada asiento a Diez al validarlo, al cerrar el mes se
-- traspasan de golpe todos los del mes (ventas, recibidas, banco, manuales,
-- liquidaciones y anulaciones). A Diez solo llega lo definitivo.
--
-- AÑADE:
--   · conta_diez_envio_empresa.modo ('al_validar' o 'mensual'; nulo = al
--     validar, como hasta hoy). Nadie cambia de modo con este fichero.
--   · conta_diez_traspaso: un traspaso por empresa y mes; quién lo confirmó y
--     cuándo (vale como la autorización escrita de Julio para escribir en Diez
--     real todo ese mes: banco, manuales y liquidaciones incluidos), lo que
--     faltaba al confirmar, el resumen, cuántos llegaron, el cuadre y el cierre.
--   · conta_traspaso_revisar(empresa, mes): lo que falta, en frases, y el
--     resumen de lo que va (por tipo y por cuenta). Lo ve quien es de la cuenta.
--   · conta_traspaso_lista(empresa, mes): lo que va, en orden. Solo el servidor.
--     La regla de lo definitivo (Julio, 24/10):
--       - va todo lo VALIDADO del mes que no está ya en Diez;
--       - un asiento ANULADO no va (no está validado);
--       - su anulación va SOLO si el original ya estaba en Diez; si no, no
--         viaja ninguno de los dos, y el rehecho va con su número de siempre
--         (conta_diez_numero_vez solo cuenta anulados que llegaron a Diez).
--   · conta_traspaso_saldos(empresa, mes): debe y haber por cuenta de lo que
--     tiene que estar en Diez ese mes, para el «Cuadra».
--   · conta_traspaso_confirmar(empresa, mes): un administrador, después de ver
--     el resumen. Queda quién y cuándo.
--   · conta_traspaso_apuntar / conta_traspaso_terminar: el servidor apunta lo
--     que llega y, al terminar, el cuadre y el cierre del mes (si llegó todo y
--     Diez cuadra; si no, el porqué queda escrito y el mes, abierto).
-- Solo AÑADE. Lo que cambia (conta_diez_por_enviar, para dejar fuera las
-- empresas en modo 'mensual') va aparte, en 20261024T1251_c12_por_enviar_modo.sql.
--
-- No toca ningún dato: ninguna empresa pasa a 'mensual' aquí (eso va aparte,
-- con su autorizo). Se puede pasar dos veces.
-- Prueba: supabase/staging/sql/20261024_c12_traspaso_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261024T1250_c12_traspaso_mensual.down.sql

alter table public.conta_diez_envio_empresa
  add column if not exists modo text check (modo in ('al_validar', 'mensual'));
comment on column public.conta_diez_envio_empresa.modo is
  'C12 (24/10). al_validar (o nulo): cada asiento a Diez al validarlo. mensual: todos los del mes en el traspaso del cierre.';

create table if not exists public.conta_diez_traspaso (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),
  estado text not null default 'confirmado' check (estado in ('confirmado', 'traspasando', 'terminado', 'con_fallos')),
  confirmado_por uuid,
  confirmado_por_nombre text,
  confirmado_en timestamptz not null default now(),
  faltaba jsonb not null default '[]'::jsonb,
  resumen jsonb not null default '{}'::jsonb,
  van integer not null default 0,
  llegaron integer not null default 0,
  no_llegaron integer not null default 0,
  detalle jsonb not null default '[]'::jsonb,
  cuadre jsonb,
  cuadra boolean,
  mes_cerrado boolean not null default false,
  cierre_motivo text,
  terminado_en timestamptz,
  unique (company_id, mes)
);
comment on table public.conta_diez_traspaso is
  'C12 (24/10). El traspaso a Diez de un mes: quién lo confirmó y cuándo (autorización escrita de Julio para Diez real), qué faltaba, cuántos llegaron, el cuadre y el cierre.';
alter table public.conta_diez_traspaso enable row level security;
drop policy if exists conta_diez_traspaso_leer on public.conta_diez_traspaso;
create policy conta_diez_traspaso_leer on public.conta_diez_traspaso for select using (public.belongs_to_account(account_id));
revoke all on table public.conta_diez_traspaso from public, anon, authenticated;
grant select on table public.conta_diez_traspaso to authenticated;
grant all on table public.conta_diez_traspaso to service_role;

-- ¿Va en el traspaso? (la regla de lo definitivo, en un sitio).
create or replace function public._conta_traspaso_va(p_entry uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select e.status = 'validado'
     and e.source_type not in ('migrated', 'opening', 'closing', 'template')
     and not exists (select 1 from public.external_send s
                      where s.entry_id = e.id and s.account_id = e.account_id and s.status in ('enviado', 'enlazado'))
     and (e.reverses_entry_id is null or exists (
           select 1 from public.external_send x
            where x.entry_id = e.reverses_entry_id and x.account_id = e.account_id and x.status in ('enviado', 'enlazado')))
    from public.journal_entry e
   where e.id = p_entry
$function$;

-- ¿Tiene que estar en Diez? (lo que va + lo que ya llegó; para el cuadre).
create or replace function public._conta_traspaso_en_diez(p_entry uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select e.source_type not in ('migrated', 'opening', 'closing', 'template')
     and (exists (select 1 from public.external_send s
                   where s.entry_id = e.id and s.account_id = e.account_id and s.status in ('enviado', 'enlazado'))
          or public._conta_traspaso_va(e.id))
    from public.journal_entry e
   where e.id = p_entry
$function$;

create or replace function public.conta_traspaso_lista(p_company uuid, p_mes date)
 returns table(entry_id uuid, orden integer, tipo text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select e.id, (row_number() over (order by e.entry_date, (e.reverses_entry_id is not null), e.number nulls last, e.id))::int,
         case when e.source_type = 'reversal' then 'anulacion'
              when e.source_type = 'sales_day' then 'ventas'
              when e.source_type = 'supplier_invoice' then 'recibidas'
              when e.source_type = 'bank' then 'banco'
              when e.source_type in ('channel_settlement', 'licensed_settlement') then 'liquidaciones'
              else 'manuales' end
    from public.journal_entry e
   where e.company_id = p_company
     and e.entry_date >= date_trunc('month', p_mes)::date
     and e.entry_date < (date_trunc('month', p_mes) + interval '1 month')::date
     and public._conta_traspaso_va(e.id)
   order by 2
$function$;

create or replace function public.conta_traspaso_saldos(p_company uuid, p_mes date)
 returns table(cuenta text, nombre text, debe numeric(14,2), haber numeric(14,2))
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare v_acc uuid;
begin
  select c.account_id into v_acc from public.company c where c.id = p_company;
  if v_acc is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.belongs_to_account(v_acc) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  return query
    select a.code, a.name, sum(l.debit)::numeric(14,2), sum(l.credit)::numeric(14,2)
      from public.journal_entry e
      join public.journal_line l on l.entry_id = e.id and l.account_id = e.account_id
      join public.company_account a on a.id = l.company_account_id and a.company_id = e.company_id
     where e.company_id = p_company and e.account_id = v_acc
       and e.entry_date >= date_trunc('month', p_mes)::date
       and e.entry_date < (date_trunc('month', p_mes) + interval '1 month')::date
       and e.status in ('validado', 'anulado')
       and public._conta_traspaso_en_diez(e.id)
     group by a.code, a.name
     order by a.code;
end
$function$;

create or replace function public.conta_traspaso_revisar(p_company uuid, p_mes date)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_acc uuid; v_mes date := date_trunc('month', p_mes)::date; v_fin date;
  v_asientos int; v_sin_pdf int; v_cierres int; v_liq int;
  v_por_tipo jsonb; v_por_cuenta jsonb; v_van int; v_ya int; v_no_viajan int;
  v_traspaso jsonb; v_cerrado boolean; v_modo text; v_conectado boolean;
begin
  select c.account_id into v_acc from public.company c where c.id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  v_fin := (v_mes + interval '1 month - 1 day')::date;

  -- 1 · Asientos sin validar del mes.
  select count(*) into v_asientos from public.journal_entry e
   where e.company_id = p_company and e.account_id = v_acc and e.status in ('propuesto', 'borrador')
     and e.entry_date between v_mes and v_fin;
  -- 2 · Recibidas del mes sin PDF (salvo las marcadas «Sin PDF»).
  select count(*) into v_sin_pdf from public.journal_entry e
    join public.supplier_invoice f on f.id = e.source_id and f.account_id = e.account_id
   where e.company_id = p_company and e.account_id = v_acc and e.source_type = 'supplier_invoice'
     and e.status in ('propuesto', 'validado') and e.entry_date between v_mes and v_fin
     and f.raw_document_url is null and f.no_document_at is null;
  -- 3 · Cierres del día en espera: pedidos cerrados sin confirmar que esperan decisión.
  begin
    select count(*) into v_cierres from public.conta_sin_confirmar_no_cobrados(p_company) w
     where w.dia between v_mes and v_fin;
  exception when others then v_cierres := null;
  end;
  -- 4 · Liquidaciones del mes cobradas con diferencia.
  select count(*) into v_liq from public.channel_settlement x
   where x.account_id = v_acc and not coalesce(x.is_reference, false)
     and x.collected_on is not null and x.net_payout is not null
     and abs(coalesce(x.collected_amount, 0) - x.net_payout) >= 0.01
     and coalesce(x.settlement_date, x.period_to, x.proposed_period_to) between v_mes and v_fin;

  -- Lo que va, por tipo, y lo que ya estaba.
  select coalesce(jsonb_agg(jsonb_build_object('tipo', t.tipo, 'n', t.n) order by t.tipo), '[]'::jsonb), coalesce(sum(t.n), 0)
    into v_por_tipo, v_van
    from (select l.tipo, count(*)::int n from public.conta_traspaso_lista(p_company, v_mes) l group by l.tipo) t;
  select count(*) into v_ya from public.journal_entry e
   where e.company_id = p_company and e.account_id = v_acc and e.entry_date between v_mes and v_fin
     and exists (select 1 from public.external_send s where s.entry_id = e.id and s.account_id = e.account_id and s.status in ('enviado', 'enlazado'));
  -- Anulados y sus anulaciones que no viajan (el original nunca llegó a Diez).
  select count(*) into v_no_viajan from public.journal_entry e
   where e.company_id = p_company and e.account_id = v_acc and e.entry_date between v_mes and v_fin
     and ((e.status = 'anulado' and not exists (select 1 from public.external_send s where s.entry_id = e.id and s.account_id = e.account_id and s.status in ('enviado', 'enlazado')))
       or (e.status = 'validado' and e.reverses_entry_id is not null and not public._conta_traspaso_va(e.id)
           and not exists (select 1 from public.external_send s where s.entry_id = e.id and s.account_id = e.account_id and s.status in ('enviado', 'enlazado'))));

  -- Totales por cuenta de lo que va.
  select coalesce(jsonb_agg(jsonb_build_object('cuenta', x.code, 'nombre', x.name, 'debe', x.d, 'haber', x.h) order by x.code), '[]'::jsonb)
    into v_por_cuenta
    from (select a.code, a.name, sum(l.debit)::numeric(14,2) d, sum(l.credit)::numeric(14,2) h
            from public.conta_traspaso_lista(p_company, v_mes) z
            join public.journal_line l on l.entry_id = z.entry_id and l.account_id = v_acc
            join public.company_account a on a.id = l.company_account_id and a.company_id = p_company
           group by a.code, a.name) x;

  select to_jsonb(t) - 'detalle' into v_traspaso from public.conta_diez_traspaso t where t.company_id = p_company and t.mes = v_mes;
  select exists (select 1 from public.fiscal_period_lock k where k.company_id = p_company and k.month = v_mes and k.reopened_at is null) into v_cerrado;
  select z.modo, coalesce(z.enviar, false) into v_modo, v_conectado from public.conta_diez_envio_empresa z where z.company_id = p_company and z.account_id = v_acc;

  return jsonb_build_object(
    'mes', v_mes,
    'faltan', (select coalesce(jsonb_agg(f) filter (where (f->>'n')::int > 0), '[]'::jsonb) from jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('codigo', 'asientos', 'n', coalesce(v_asientos, 0)),
        jsonb_build_object('codigo', 'recibidas_sin_pdf', 'n', coalesce(v_sin_pdf, 0)),
        jsonb_build_object('codigo', 'cierres_en_espera', 'n', coalesce(v_cierres, 0)),
        jsonb_build_object('codigo', 'liquidaciones_con_diferencia', 'n', coalesce(v_liq, 0)))) f),
    'van', v_van, 'por_tipo', v_por_tipo, 'por_cuenta', v_por_cuenta,
    'ya_en_diez', v_ya, 'no_viajan', v_no_viajan,
    'traspaso', v_traspaso, 'mes_cerrado', v_cerrado,
    'modo', coalesce(v_modo, 'al_validar'), 'conectado', coalesce(v_conectado, false));
end
$function$;

create or replace function public.conta_traspaso_confirmar(p_company uuid, p_mes date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_acc uuid; v_mes date := date_trunc('month', p_mes)::date; v_rev jsonb; v_t public.conta_diez_traspaso; v_id uuid;
begin
  select c.account_id into v_acc from public.company c where c.id = p_company;
  if v_acc is null or not public.current_user_is_admin_of(v_acc) then
    raise exception 'Solo un administrador de la cuenta puede traspasar el mes a Diez.' using errcode = '42501';
  end if;
  if v_mes >= date_trunc('month', (now() at time zone 'Europe/Madrid'))::date then
    raise exception 'El mes aún no ha terminado: se traspasa cuando acaba.' using errcode = '23514';
  end if;
  select * into v_t from public.conta_diez_traspaso where company_id = p_company and mes = v_mes for update;
  if v_t.id is not null and v_t.estado in ('terminado', 'traspasando') then
    raise exception 'Ese mes ya está %.', case v_t.estado when 'terminado' then 'traspasado' else 'traspasándose' end using errcode = '23505';
  end if;
  v_rev := public.conta_traspaso_revisar(p_company, v_mes);
  insert into public.conta_diez_traspaso (account_id, company_id, mes, estado, confirmado_por, confirmado_por_nombre, confirmado_en, faltaba, resumen, van)
  values (v_acc, p_company, v_mes, 'confirmado', auth.uid(), public.conta_nombre_actor(), now(), v_rev->'faltan',
          jsonb_build_object('por_tipo', v_rev->'por_tipo', 'por_cuenta', v_rev->'por_cuenta', 'ya_en_diez', v_rev->'ya_en_diez', 'no_viajan', v_rev->'no_viajan'),
          (v_rev->>'van')::int)
  on conflict (company_id, mes) do update
     set estado = 'confirmado', confirmado_por = excluded.confirmado_por, confirmado_por_nombre = excluded.confirmado_por_nombre,
         confirmado_en = excluded.confirmado_en, faltaba = excluded.faltaba, resumen = excluded.resumen, van = excluded.van,
         llegaron = 0, no_llegaron = 0, detalle = '[]'::jsonb, cuadre = null, cuadra = null, terminado_en = null
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'mes', v_mes, 'van', (v_rev->>'van')::int, 'faltaban', jsonb_array_length(v_rev->'faltan'));
end
$function$;

-- El servidor apunta cada tanda: cuántos llegaron y cuáles no (con su motivo).
create or replace function public.conta_traspaso_apuntar(p_traspaso uuid, p_llegaron integer, p_no_llegaron integer, p_detalle jsonb)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  update public.conta_diez_traspaso
     set estado = 'traspasando', llegaron = llegaron + greatest(p_llegaron, 0), no_llegaron = greatest(p_no_llegaron, 0),
         detalle = coalesce(p_detalle, '[]'::jsonb)
   where id = p_traspaso
$function$;

-- Al terminar: el cuadre y, si llegó todo y Diez cuadra, el mes cerrado en Sumied (en orden).
create or replace function public.conta_traspaso_terminar(p_traspaso uuid, p_cuadre jsonb, p_cuadra boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_t public.conta_diez_traspaso; v_ej public.fiscal_year; v_primero date; v_cerrado boolean := false; v_motivo text;
begin
  select * into v_t from public.conta_diez_traspaso where id = p_traspaso for update;
  if v_t.id is null then raise exception 'Ese traspaso no existe.' using errcode = 'P0002'; end if;
  if v_t.no_llegaron > 0 then
    v_motivo := 'No se cierra el mes: ' || v_t.no_llegaron || ' no han llegado a Diez.';
  elsif p_cuadra is not true then
    v_motivo := case when p_cuadra is null then 'No se cierra el mes: no se ha podido comprobar con Diez.'
                     else 'No se cierra el mes: Diez no cuadra con Sumied.' end;
  elsif exists (select 1 from public.fiscal_period_lock k where k.company_id = v_t.company_id and k.month = v_t.mes and k.reopened_at is null) then
    v_cerrado := true; v_motivo := 'El mes ya estaba cerrado.';
  else
    select * into v_ej from public.fiscal_year where company_id = v_t.company_id and v_t.mes between date_trunc('month', starts_on)::date and ends_on;
    if v_ej.id is null then
      v_motivo := 'No se cierra el mes: no hay ejercicio para ' || to_char(v_t.mes, 'MM/YYYY') || '.';
    else
      select min(m)::date into v_primero from generate_series(date_trunc('month', v_ej.starts_on), v_ej.ends_on, interval '1 month') m
       where not exists (select 1 from public.fiscal_period_lock l where l.company_id = v_t.company_id and l.month = m::date and l.reopened_at is null);
      if v_primero is distinct from v_t.mes then
        v_motivo := 'No se cierra el mes: los meses se cierran en orden y el primero abierto es ' || to_char(v_primero, 'MM/YYYY') || '.';
      else
        insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, locked_by, locked_by_name)
        values (v_t.account_id, v_t.company_id, v_ej.id, v_t.mes, v_t.confirmado_por, coalesce(v_t.confirmado_por_nombre, 'Traspaso a Diez'));
        v_cerrado := true;
      end if;
    end if;
  end if;
  update public.conta_diez_traspaso
     set estado = case when v_t.no_llegaron > 0 then 'con_fallos' else 'terminado' end,
         cuadre = p_cuadre, cuadra = p_cuadra, mes_cerrado = v_cerrado, cierre_motivo = v_motivo, terminado_en = now()
   where id = p_traspaso;
  return jsonb_build_object('mes_cerrado', v_cerrado, 'motivo', v_motivo);
end
$function$;

-- Permisos: las del servidor, solo la clave de servicio; las de pantalla, también los usuarios.
revoke execute on function public._conta_traspaso_va(uuid) from public, anon, authenticated;
grant execute on function public._conta_traspaso_va(uuid) to service_role;
revoke execute on function public._conta_traspaso_en_diez(uuid) from public, anon, authenticated;
grant execute on function public._conta_traspaso_en_diez(uuid) to service_role;
revoke execute on function public.conta_traspaso_lista(uuid, date) from public, anon, authenticated;
grant execute on function public.conta_traspaso_lista(uuid, date) to service_role;
revoke execute on function public.conta_traspaso_apuntar(uuid, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.conta_traspaso_apuntar(uuid, integer, integer, jsonb) to service_role;
revoke execute on function public.conta_traspaso_terminar(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.conta_traspaso_terminar(uuid, jsonb, boolean) to service_role;
revoke execute on function public.conta_traspaso_revisar(uuid, date) from public, anon;
grant execute on function public.conta_traspaso_revisar(uuid, date) to authenticated, service_role;
revoke execute on function public.conta_traspaso_confirmar(uuid, date) from public, anon;
grant execute on function public.conta_traspaso_confirmar(uuid, date) to authenticated, service_role;
revoke execute on function public.conta_traspaso_saldos(uuid, date) from public, anon;
grant execute on function public.conta_traspaso_saldos(uuid, date) to authenticated, service_role;
