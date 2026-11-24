-- supabase/migrations/20261120T0810_r07_factura_del_dia_anade.sql
--
-- R07 · 2a · Lo que SOLO AÑADE del día en dos asientos (encargo R07; respuesta R07 · 1, 19/11). Lo
-- usa la 0900, que va después en la tanda y es la que cambia las funciones del día.
--
--   1. conta_tpv_factura_cuenta.desde (columna nueva, admite nulos): desde qué día va la forma nueva;
--      vacía, desde el día en que se eligió la cuenta.
--   2. conta_dia_cobro (nueva): qué cobro va con qué factura. Sin claves ajenas a propósito: el enlace
--      lo borra el disparador de la 0900 (una clave ajena lo borraría antes de que el disparador lo lea).
--   3. _conta_dia_partir (nueva): de las líneas de siempre, la factura y el cobro. Lado del cobro: lo que
--      no es 6, 7 ni 477 (caja, banco, la 430 de una plataforma…).
--   4. _conta_dia_concepto y _conta_dia_proponer (nuevas): propone por el embudo de siempre
--      (_journal_entry_proponer) la factura y, si la empresa tiene la cuenta y el día es de su «desde» en
--      adelante, su cobro, y los une. Hasta la 0900 no la llama nadie.
--   5. conta_tpv_factura_de y conta_tpv_factura_guardar (nuevas): la cuenta de «La factura del día va a».
--   6. conta_tpv_dia_ejemplo (nueva): los dos asientos de un día, con las cuentas que se están eligiendo,
--      sin guardar nada.
-- Se puede pasar dos veces seguidas (if not exists, create or replace). No retira nada al aplicarse.
-- Vuelta atrás: supabase/vuelta-atras/20261120T0810_r07_factura_del_dia_anade.down.sql

set local lock_timeout = '5s';

-- ── 2 y 3 · Desde cuándo, y el enlace ───────────────────────────────────────
alter table public.conta_tpv_factura_cuenta add column if not exists desde date;
comment on column public.conta_tpv_factura_cuenta.desde is 'R07: desde qué día va cada día de ventas en dos asientos (la factura del día y su cobro); si está vacía, desde el día en que se eligió la cuenta. Los de antes, como estaban.';

create table if not exists public.conta_dia_cobro (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null,
  company_id       uuid not null,
  factura_entry_id uuid not null unique,
  cobro_entry_id   uuid not null unique,
  created_at       timestamptz not null default now()
);
comment on table public.conta_dia_cobro is
  'R07: el cobro del día que va con cada factura del día. Se validan, se anulan y se quitan juntos (_conta_dia_cobro_junto). Sin claves ajenas a propósito: el enlace lo borra el disparador.';
alter table public.conta_dia_cobro enable row level security;
revoke all on public.conta_dia_cobro from public, anon, authenticated;
grant all on public.conta_dia_cobro to service_role;
grant select on public.conta_dia_cobro to authenticated;
drop policy if exists conta_dia_cobro_select on public.conta_dia_cobro;
create policy conta_dia_cobro_select on public.conta_dia_cobro for select using (account_id = any ((select public.current_user_account_ids())::uuid[]));

-- ── 4 · Partir el día ───────────────────────────────────────────────────────
create or replace function public._conta_dia_partir(p_lineas jsonb, p_contado text)
returns jsonb language plpgsql immutable set search_path = public as $f$
declare v_l jsonb; v_neto numeric := 0; v_fact jsonb := '[]'; v_cob jsonb := '[]'; v_base jsonb;
begin
  if p_contado is null or p_lineas is null then return null; end if;
  for v_l in select * from jsonb_array_elements(p_lineas) loop
    if coalesce(v_l->>'cuenta', '') ~ '^(6|7|477)' then
      v_fact := v_fact || v_l;
    else
      v_cob := v_cob || v_l;
      v_neto := v_neto + coalesce((v_l->>'debe')::numeric, 0) - coalesce((v_l->>'haber')::numeric, 0);
      if v_base is null then v_base := v_l - array['cuenta', 'debe', 'haber', 'concepto', 'forma', 'canal', 'iva', 'tercero_id']; end if;
    end if;
  end loop;
  if jsonb_array_length(v_cob) = 0 then return null; end if;
  -- La factura: «Clientes de contado» por lo que se cobra, en lugar de cada forma de pago.
  v_fact := jsonb_build_array(coalesce(v_base, '{}') || jsonb_build_object('cuenta', p_contado, 'debe', greatest(v_neto, 0), 'haber', greatest(-v_neto, 0),
                                                                      'concepto', 'La factura del día · Clientes de contado')) || v_fact;
  -- El cobro: cada forma de pago, contra «Clientes de contado», que queda a cero.
  v_cob := v_cob || jsonb_build_array(coalesce(v_base, '{}') || jsonb_build_object('cuenta', p_contado, 'debe', greatest(-v_neto, 0), 'haber', greatest(v_neto, 0),
                                                                      'concepto', 'El cobro del día · Clientes de contado'));
  return jsonb_build_object('factura', v_fact, 'cobro', v_cob);
end $f$;
comment on function public._conta_dia_partir(jsonb, text) is
  'R07: de las líneas de un día de ventas, la factura del día (Clientes de contado por lo cobrado, contra ventas e IVA) y su cobro (lo cobrado contra Clientes de contado). null si no hay nada que cobrar.';
revoke all on function public._conta_dia_partir(jsonb, text) from public, anon, authenticated;

-- ── 5 · Proponer por el embudo de siempre ───────────────────────────────────
-- El concepto: «Ventas del día · Alcalá» pasa a «Factura del día · Alcalá» y «Cobro del día · Alcalá».
create or replace function public._conta_dia_concepto(p_que text, p_concepto text)
returns text language sql immutable set search_path = public as $f$
  select case when coalesce(p_concepto, '') ~ '^Ventas del día' then regexp_replace(p_concepto, '^Ventas del día', p_que)
              else p_que || coalesce(' · ' || nullif(p_concepto, ''), '') end
$f$;
revoke all on function public._conta_dia_concepto(text, text) from public, anon, authenticated;

create or replace function public._conta_dia_proponer(p_company uuid, p_prop jsonb, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_contado text; v_desde date; v_partido jsonb; v_r jsonb; v_c jsonb; v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  select a.code, coalesce(f.desde, (f.created_at at time zone 'Europe/Madrid')::date) into v_contado, v_desde from public.conta_tpv_factura_cuenta f
    join public.company_account a on a.id = f.company_account_id and a.company_id = f.company_id
   where f.company_id = p_company and f.account_id = v_cuenta and a.status is distinct from 'cerrada';
  if v_contado is not null and (p_prop->'entrada'->>'fecha')::date >= v_desde then
    v_partido := public._conta_dia_partir(p_prop->'lineas', v_contado);
  end if;
  if v_partido is null then
    return public._journal_entry_proponer(p_company, p_prop->'entrada', p_prop->'lineas', p_prop->'resumen', p_quien, null);
  end if;
  v_r := public._journal_entry_proponer(p_company,
           jsonb_set(p_prop->'entrada', '{concepto}', to_jsonb(public._conta_dia_concepto('Factura del día', p_prop->'entrada'->>'concepto'))),
           v_partido->'factura', p_prop->'resumen', p_quien, null);
  -- El cobro, solo con una factura nueva (una de antes, ya propuesta de un asiento, se queda como está).
  if not coalesce((v_r->>'existente')::boolean, false) and not coalesce((v_r->>'descartada')::boolean, false) and v_r->>'id' is not null then
    v_c := public._journal_entry_proponer(p_company,
             jsonb_build_object('series', p_prop->'entrada'->'series', 'fecha', p_prop->'entrada'->'fecha',
               'concepto', public._conta_dia_concepto('Cobro del día', p_prop->'entrada'->>'concepto'), 'source_type', 'sales_day_payment', 'source_id', v_r->>'id',
               'confianza', coalesce(p_prop->'entrada'->>'confianza', 'seguro'), 'porque', 'Lo cobrado el día contra «Clientes de contado»: la deja a cero.',
               'razones', '[]'::jsonb, 'party_id', null, 'documento', p_prop->'entrada'->'documento'),
             v_partido->'cobro', '{}'::jsonb, p_quien, null);
    insert into public.conta_dia_cobro (account_id, company_id, factura_entry_id, cobro_entry_id)
    values (v_cuenta, p_company, (v_r->>'id')::uuid, (v_c->>'id')::uuid) on conflict do nothing;
  end if;
  return v_r;
end $f$;
comment on function public._conta_dia_proponer(uuid, jsonb, text) is
  'R07: propone un día de ventas por el embudo de siempre; con la cuenta de la factura del día y desde su «desde», en dos asientos unidos (la factura y su cobro).';
revoke all on function public._conta_dia_proponer(uuid, jsonb, text) from public, anon, authenticated;

-- ── 8 · Para la pantalla ────────────────────────────────────────────────────
create or replace function public.conta_tpv_factura_de(p_company uuid, p_mes date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare v_acc uuid; v jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select jsonb_build_object('cuenta', a.code, 'nombre', coalesce(a.plain_name, a.name), 'desde', coalesce(f.desde, (f.created_at at time zone 'Europe/Madrid')::date),
           'mes', coalesce((select sum(l.debit) from public.journal_line l join public.journal_entry e on e.id = l.entry_id
                             where l.company_account_id = a.id and e.status = 'validado' and e.source_type = 'sales_day'
                               and e.entry_date >= date_trunc('month', coalesce(p_mes, current_date))::date
                               and e.entry_date < (date_trunc('month', coalesce(p_mes, current_date)) + interval '1 month')::date), 0))
    into v from public.conta_tpv_factura_cuenta f join public.company_account a on a.id = f.company_account_id
   where f.company_id = p_company and f.account_id = v_acc;
  return jsonb_build_object('factura', v,
    -- Lo que propone Sumied si no hay ninguna: una 430 que ya se llame «contado».
    'propuesta', (select jsonb_build_object('cuenta', a.code, 'nombre', coalesce(a.plain_name, a.name)) from public.company_account a
                   where a.company_id = p_company and a.account_id = v_acc and a.code like '430%' and length(a.code) >= 8
                     and (a.name ilike '%contado%' or a.plain_name ilike '%contado%') and a.status is distinct from 'cerrada'
                   order by a.code limit 1));
end $f$;
revoke all on function public.conta_tpv_factura_de(uuid, date) from public, anon;
grant execute on function public.conta_tpv_factura_de(uuid, date) to authenticated;

create or replace function public.conta_tpv_factura_guardar(p_company uuid, p_cuenta text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_acc uuid; v_a public.company_account; v_desde date;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then raise exception 'Solo un administrador o un encargado de la cuenta elige la cuenta de la factura del día.' using errcode = '42501'; end if;
  select * into v_a from public.company_account where company_id = p_company and account_id = v_acc and code = p_cuenta and status is distinct from 'cerrada';
  if v_a.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', p_cuenta using errcode = '23514'; end if;
  if length(v_a.code) < 8 then raise exception 'La % es una cuenta de grupo: elige una subcuenta.', v_a.code using errcode = '23514'; end if;
  insert into public.conta_tpv_factura_cuenta (account_id, company_id, company_account_id, created_by_name, desde)
  values (v_acc, p_company, v_a.id, coalesce(p_quien_nombre, public.conta_nombre_actor()), (now() at time zone 'Europe/Madrid')::date)
  on conflict (company_id) do update set company_account_id = excluded.company_account_id, created_by_name = excluded.created_by_name
  returning coalesce(desde, (created_at at time zone 'Europe/Madrid')::date) into v_desde;
  return jsonb_build_object('cuenta', v_a.code, 'nombre', coalesce(v_a.plain_name, v_a.name), 'desde', v_desde,
    'texto', format('La factura del día va a la %s · %s. Desde el %s, cada día va en dos asientos: la factura del día y su cobro.',
                    v_a.code, coalesce(v_a.plain_name, v_a.name), to_char(v_desde, 'DD/MM/YYYY')));
end $f$;
revoke all on function public.conta_tpv_factura_guardar(uuid, text, text) from public, anon;
grant execute on function public.conta_tpv_factura_guardar(uuid, text, text) to authenticated;

-- ── 9 · «Cómo quedan los asientos de un día», en la ventana ─────────────────
-- Como conta_tpv_asiento_ejemplo (R06), con la cuenta de la factura del día que se está eligiendo
-- (p_factura; si no, la guardada) y devolviendo los dos asientos. No guarda nada: todo se deshace.
create or replace function public.conta_tpv_dia_ejemplo(p_dia uuid, p_cuentas jsonb default '[]'::jsonb, p_factura uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  v_d public.conta_tpv_dia; v_ventas uuid; v_falta record; v_p jsonb; v_res jsonb; v_c jsonb; v_cta uuid;
  v_sustitutas jsonb := '[]'::jsonb; v_contado_falta boolean := false; v_contado text;
begin
  select * into v_d from public.conta_tpv_dia where id = p_dia;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese día no está.' using errcode = 'P0002'; end if;
  if jsonb_typeof(coalesce(p_cuentas, '[]'::jsonb)) <> 'array' then raise exception 'Las cuentas van en una lista.' using errcode = '22023'; end if;
  if p_factura is not null and not exists (select 1 from public.company_account where id = p_factura and company_id = v_d.company_id and status is distinct from 'cerrada') then
    raise exception 'La cuenta elegida para la factura del día no es de esta empresa.' using errcode = '22023';
  end if;
  begin
    for v_c in select * from jsonb_array_elements(coalesce(p_cuentas, '[]'::jsonb)) loop
      delete from public.conta_tpv_forma_cuenta
       where company_id = v_d.company_id and lower(forma) = lower(v_c ->> 'forma') and canal is not distinct from nullif(v_c ->> 'canal', '');
      v_cta := nullif(v_c ->> 'cuenta_id', '')::uuid;
      if v_cta is not null then
        if not exists (select 1 from public.company_account where id = v_cta and company_id = v_d.company_id and status is distinct from 'cerrada') then
          raise exception 'La cuenta elegida para «%» no es de esta empresa.', v_c ->> 'forma' using errcode = '22023';
        end if;
        insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
        values (v_d.account_id, v_d.company_id, v_c ->> 'forma', nullif(v_c ->> 'canal', ''), v_cta, 'ejemplo');
      end if;
    end loop;
    select id into v_ventas from public.company_account
     where company_id = v_d.company_id and kind = 'template' and template_code = '700' and status is distinct from 'cerrada' order by code limit 1;
    -- La factura del día: la que se está eligiendo, la guardada o, si no hay, una cualquiera en su lugar («sin cuenta»).
    if p_factura is not null then
      insert into public.conta_tpv_factura_cuenta (account_id, company_id, company_account_id, created_by_name)
      values (v_d.account_id, v_d.company_id, p_factura, 'ejemplo')
      on conflict (company_id) do update set company_account_id = excluded.company_account_id;
    elsif not exists (select 1 from public.conta_tpv_factura_cuenta where company_id = v_d.company_id) then
      -- En su lugar, una cuenta que el día no usa (ni ventas, ni IVA, ni la de una forma de pago): se enseña «sin cuenta».
      select a.id into v_cta from public.company_account a
       where a.company_id = v_d.company_id and a.status is distinct from 'cerrada' and length(a.code) >= 8 and a.code !~ '^(6|7|477)'
         and not exists (select 1 from public.conta_tpv_forma_cuenta k where k.company_id = v_d.company_id and k.company_account_id = a.id)
       order by a.code limit 1;
      if v_cta is not null then
        insert into public.conta_tpv_factura_cuenta (account_id, company_id, company_account_id, created_by_name) values (v_d.account_id, v_d.company_id, v_cta, 'ejemplo');
        v_contado_falta := true;
      end if;
    end if;
    select a.code into v_contado from public.conta_tpv_factura_cuenta f join public.company_account a on a.id = f.company_account_id where f.company_id = v_d.company_id;
    if v_ventas is not null then
      for v_falta in
        select distinct on (lower(x.forma), x.canal) x.forma, x.canal from public._conta_tpv_formas_de(v_d.company_id, array[p_dia]) x
         where public._conta_tpv_cuenta_de(v_d.company_id, x.forma, x.canal) is null
           and (x.canal is not null or not exists (
             select 1 from public.conta_tpv_forma_cuenta k where k.company_id = v_d.company_id and lower(k.forma) = lower(x.forma) and k.canal is not null))
      loop
        insert into public.conta_tpv_forma_cuenta (account_id, company_id, forma, canal, company_account_id, created_by_name)
        values (v_d.account_id, v_d.company_id, v_falta.forma, v_falta.canal, v_ventas, 'ejemplo');
        v_sustitutas := v_sustitutas || jsonb_build_object('forma', lower(v_falta.forma), 'canal', v_falta.canal);
      end loop;
    end if;
    v_p := public._conta_tpv_propuesta(p_dia);
    raise exception using errcode = 'RR007', message = 'deshacer el ejemplo';
  exception when sqlstate 'RR007' then
    null;
  end;

  if v_p ? 'sin_propuesta' then
    return jsonb_build_object('dia', v_d.dia, 'motivo', v_p ->> 'sin_propuesta', 'factura', null, 'cobro', null);
  end if;
  with uno as (
    select q.que, jsonb_agg(
             case when l ->> 'cuenta' = v_contado and v_contado_falta
                  then jsonb_build_object('cuenta', null, 'nombre', null, 'sin_cuenta', true, 'forma', 'Clientes de contado', 'canal', null, 'contado', true,
                                          'debe', (l ->> 'debe')::numeric, 'haber', (l ->> 'haber')::numeric, 'concepto', l ->> 'concepto')
                  when v_sustitutas @> jsonb_build_array(jsonb_build_object('forma', lower(l ->> 'forma'), 'canal', l -> 'canal'))
                  then jsonb_build_object('cuenta', null, 'nombre', null, 'sin_cuenta', true, 'forma', l ->> 'forma', 'canal', l -> 'canal', 'contado', false,
                                          'debe', (l ->> 'debe')::numeric, 'haber', (l ->> 'haber')::numeric, 'concepto', l ->> 'concepto')
                  else jsonb_build_object('cuenta', l ->> 'cuenta', 'sin_cuenta', false, 'forma', l ->> 'forma', 'canal', l -> 'canal', 'tipo', l -> 'tipo',
                                          'contado', l ->> 'cuenta' = v_contado,
                                          'nombre', (select coalesce(a.plain_name, a.name) from public.company_account a where a.company_id = v_d.company_id and a.code = l ->> 'cuenta'),
                                          'debe', (l ->> 'debe')::numeric, 'haber', (l ->> 'haber')::numeric, 'concepto', l ->> 'concepto') end
             order by o) as lineas
      from (values ('factura', v_p -> 'lineas'), ('cobro', v_p -> 'cobro' -> 'lineas')) q(que, ls)
      cross join lateral jsonb_array_elements(coalesce(q.ls, '[]'::jsonb)) with ordinality as z(l, o)
     group by q.que
  )
  select jsonb_build_object('dia', v_d.dia, 'motivo', null,
           'primero', v_d.primer_numero, 'ultimo', v_d.ultimo_numero, 'facturas', v_d.documentos,
           'factura', (select jsonb_build_object('lineas', u.lineas,
                         'debe', (select sum((l ->> 'debe')::numeric) from jsonb_array_elements(u.lineas) l),
                         'haber', (select sum((l ->> 'haber')::numeric) from jsonb_array_elements(u.lineas) l)) from uno u where u.que = 'factura'),
           'cobro', (select jsonb_build_object('lineas', u.lineas,
                         'debe', (select sum((l ->> 'debe')::numeric) from jsonb_array_elements(u.lineas) l),
                         'haber', (select sum((l ->> 'haber')::numeric) from jsonb_array_elements(u.lineas) l)) from uno u where u.que = 'cobro'),
           'sin_cuenta', (select count(*) from uno u, jsonb_array_elements(u.lineas) l where (l ->> 'sin_cuenta')::boolean))
    into v_res;
  return v_res;
end $f$;
comment on function public.conta_tpv_dia_ejemplo(uuid, jsonb, uuid) is
  'R07: «Cómo quedan los asientos de un día» (la factura del día y su cobro) con las cuentas que se están eligiendo, sin guardar nada.';
revoke all on function public.conta_tpv_dia_ejemplo(uuid, jsonb, uuid) from public, anon;
grant execute on function public.conta_tpv_dia_ejemplo(uuid, jsonb, uuid) to authenticated;
