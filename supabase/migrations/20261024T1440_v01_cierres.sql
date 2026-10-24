-- supabase/migrations/20261024T1440_v01_cierres.sql
--
-- V01 · Entrega 2 · Ventas › Cierres del día (Julio, 24/10). Un cierre es la
-- unidad que ya propone el cierre del día cada hora: un sales_day_summary por
-- día, local y canal (y marca, si el canal va por marca). Esta entrega le da
-- su pantalla y, al validarlo, su FACTURA RESUMEN numerada en la serie del
-- canal (aparece en Ventas › Facturas con origen «Cierre del día»), su PDF
-- guardado junto al asiento (journal_entry_document, para el traspaso del mes)
-- y su asiento validado. No se envía nada a Diez al validar: entra en el
-- traspaso del mes (C12).
--
-- Solo añade. No cambia ninguna función ni tabla que ya exista, y se puede
-- pasar dos veces seguidas:
--
--   1. conta_cierre_ajuste: cómo cuenta un pedido en la contabilidad (quitado
--      de su cierre con su motivo, pasado a otro día, o con otro importe). NO
--      toca el pedido de Folvy: la venta sigue igual en Pedidos, en Cocina y en
--      los informes; solo cambia cómo la cuenta el cierre (lo lee
--      conta_pedidos_del_dia, que cambia en la 1441).
--   2. conta_cierre_espera: un cierre que se deja en espera, con su motivo en
--      una frase (a mano, o porque al rehacerlo no ha salido propuesta).
--   3. invoice_series.channel_id: la serie de facturas de cada canal. Se crea
--      sola al validar el primer cierre del canal (UBR, GLV, JUS, TPV, WEB…).
--   4. customer_invoice_payment.entry_id: el asiento de un cobro en efectivo
--      (570 / 430; lo hace conta_venta_cobrar, que cambia en la 1441).
--   5. Las funciones de la pantalla: la lista, la ficha, guardar los cambios y
--      rehacer el cierre, ponerlo en espera, la factura que le tocaría y
--      validar (asiento + PDF + factura resumen, en UNA transacción).
--
-- Nombres que no empiezan por sales_ a propósito: no son del camino del pedido.

-- Vuelta atrás: supabase/vuelta-atras/20261024T1440_v01_cierres.down.sql

-- 1 · Los cambios de un pedido en su cierre ----------------------------------------------
create table if not exists public.conta_cierre_ajuste (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  -- Sin clave ajena a sale a propósito: una clave ajena nueva cierra sale un
  -- momento, y sale es del camino del pedido. Se comprueba al guardar.
  sale_id          uuid not null,
  location_id      uuid not null,
  -- El día del pedido (Madrid) y su unidad (conta_unidad_ventas), como eran al guardar.
  sales_day        date not null,
  unit_key         text not null,
  quitado          boolean not null default false,
  dia_destino      date,
  importe          numeric(14,2) check (importe is null or importe > 0),
  importe_antes    numeric(14,2) not null,
  motivo           text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text,
  updated_at       timestamptz not null default now(),
  unique (company_id, sale_id),
  constraint conta_cierre_ajuste_algo check (quitado or dia_destino is not null or importe is not null),
  constraint conta_cierre_ajuste_quitar check (not quitado or (dia_destino is null and importe is null and btrim(coalesce(motivo, '')) <> '')),
  constraint conta_cierre_ajuste_otro_dia check (dia_destino is null or dia_destino <> sales_day)
);
comment on table public.conta_cierre_ajuste is
  'V01 · Cómo cuenta un pedido en su cierre del día: quitado (con motivo), pasado a otro día o con otro importe. No toca el pedido de Folvy: solo la contabilidad (conta_pedidos_del_dia).';
create index if not exists conta_cierre_ajuste_dia_idx on public.conta_cierre_ajuste (company_id, location_id, sales_day);
create index if not exists conta_cierre_ajuste_destino_idx on public.conta_cierre_ajuste (company_id, location_id, dia_destino) where dia_destino is not null;

-- 2 · Un cierre en espera ------------------------------------------------------------------
create table if not exists public.conta_cierre_espera (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  location_id      uuid not null,
  sales_day        date not null,
  unit_key         text not null,
  motivo           text not null check (btrim(motivo) <> ''),
  -- true: lo puso el rehacer del cierre (no salió propuesta) y se va solo
  -- cuando vuelve a salir. false: lo puso alguien a mano.
  automatica       boolean not null default false,
  created_at       timestamptz not null default now(),
  created_by_name  text,
  unique (company_id, location_id, sales_day, unit_key)
);
comment on table public.conta_cierre_espera is 'V01 · Un cierre del día que se queda en espera, con su motivo en una frase. No se valida hasta quitarlo.';

alter table public.conta_cierre_ajuste enable row level security;
alter table public.conta_cierre_espera enable row level security;
revoke all on public.conta_cierre_ajuste, public.conta_cierre_espera from public, anon, authenticated;
grant select on public.conta_cierre_ajuste, public.conta_cierre_espera to authenticated;
drop policy if exists conta_cierre_ajuste_leer on public.conta_cierre_ajuste;
create policy conta_cierre_ajuste_leer on public.conta_cierre_ajuste for select to authenticated using (public.belongs_to_account(account_id));
drop policy if exists conta_cierre_espera_leer on public.conta_cierre_espera;
create policy conta_cierre_espera_leer on public.conta_cierre_espera for select to authenticated using (public.belongs_to_account(account_id));

-- 3 · La serie de cada canal; 4 · el asiento de un cobro en efectivo -----------------------
-- Sin clave ajena a sales_channel por lo mismo que arriba (sales_* es del camino).
alter table public.invoice_series add column if not exists channel_id uuid;
comment on column public.invoice_series.channel_id is 'V01 · La serie de las facturas resumen de los cierres de este canal (se crea sola al validar el primero).';
create unique index if not exists invoice_series_canal_uidx on public.invoice_series (company_id, channel_id) where channel_id is not null;
alter table public.customer_invoice_payment add column if not exists entry_id uuid references public.journal_entry(id);
comment on column public.customer_invoice_payment.entry_id is 'V01 · El asiento del cobro en efectivo (570 / 430). Un cobro por banco no lo lleva: lo hace Bancos al casar el movimiento.';

-- 5 · Las funciones -----------------------------------------------------------------------

-- La serie de un canal: la suya, o la que tendría (las tres letras de Diez para
-- las plataformas, TPV para el mostrador, WEB para la tienda), sin chocar con
-- otra serie ni con las facturas a mano de la empresa.
create or replace function public._conta_cierre_serie(p_company uuid, p_canal uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_code text; v_slug text; v_base text; v_i int := 1;
begin
  select code into v_code from public.invoice_series where company_id = p_company and channel_id = p_canal order by created_at limit 1;
  if v_code is not null then return v_code; end if;
  select ch.slug into v_slug from public.sales_channel ch join public.company c on c.id = p_company and c.account_id = ch.account_id where ch.id = p_canal;
  v_base := case when v_slug ~* 'uber' then 'UBR' when v_slug ~* 'glovo' then 'GLV' when v_slug ~* 'just' then 'JUS'
                 when v_slug ~* 'tpv|mostrador|pos' then 'TPV' when v_slug ~* 'shop|tienda|web' then 'WEB'
                 else nullif(left(upper(regexp_replace(coalesce(v_slug, ''), '[^A-Za-z0-9]', '', 'g')), 3), '') end;
  v_base := coalesce(v_base, 'CD');
  v_code := v_base;
  while exists (select 1 from public.invoice_series where company_id = p_company and code = v_code)
     or exists (select 1 from public.customer_invoice where company_id = p_company and series_code = v_code and origin <> 'cierre_dia') loop
    v_i := v_i + 1; v_code := v_base || v_i;
  end loop;
  return v_code;
end $$;
revoke all on function public._conta_cierre_serie(uuid, uuid) from public, anon, authenticated;

-- El cierre de un asiento (o null), con lo que la pantalla necesita para decir si es suyo.
create or replace function public._conta_cierre_de(p_summary uuid)
returns public.sales_day_summary language sql stable security definer set search_path = public as $$
  select * from public.sales_day_summary where id = p_summary and unit_key is not null and channel_id is not null
$$;
revoke all on function public._conta_cierre_de(uuid) from public, anon, authenticated;

-- La factura que le tocaría a un cierre si se validara ahora: su serie, su año y su número.
create or replace function public.conta_cierre_factura_prevista(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_e public.journal_entry; v_d public.sales_day_summary; v_code text; v_dig int; v_ini int; v_anual boolean; v_anio int; v_ult int; v_num int;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not (public.belongs_to_account(v_e.account_id) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  select * into v_d from public.sales_day_summary where entry_id = p_entry and company_id = v_e.company_id and unit_key is not null and channel_id is not null;
  if v_d.id is null then raise exception 'Ese asiento no es el de un cierre del día de un canal: no lleva factura resumen.' using errcode = '22023'; end if;
  v_code := public._conta_cierre_serie(v_e.company_id, v_d.channel_id);
  select digits, starts_at, reset_yearly into v_dig, v_ini, v_anual from public.invoice_series where company_id = v_e.company_id and code = v_code;
  v_dig := coalesce(v_dig, 5); v_ini := coalesce(v_ini, 1); v_anual := coalesce(v_anual, true);
  v_anio := extract(year from v_d.sales_day)::int;
  select last_number into v_ult from public.customer_invoice_counter
   where company_id = v_e.company_id and series_code = v_code and fiscal_year = case when v_anual then v_anio else 0 end;
  v_num := case when v_ult is null then v_ini else v_ult + 1 end;
  return jsonb_build_object('serie', v_code, 'anio', v_anio, 'numero', v_num,
    'texto', v_code || '-' || case when v_anual then v_anio || '/' else '' end || lpad(v_num::text, v_dig, '0'));
end $$;
revoke all on function public.conta_cierre_factura_prevista(uuid) from public, anon;
grant execute on function public.conta_cierre_factura_prevista(uuid) to authenticated, service_role;

-- La lista: un cierre por día, local y canal (solo los de las marcas propias:
-- los de las cedidas no se proponen), con su estado para las pestañas. Y los
-- días que el cierre del día no ha podido proponer, con su porqué (regla 7: la
-- pantalla no esconde nada; esos van a «En espera»).
create or replace function public.conta_cierres(p_company uuid, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v_r jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  with c as (
    select s.id, s.location_id, l.name as local, s.sales_day, s.unit_key, s.channel_id, ch.name as canal, ch.slug as canal_slug, b.name as marca,
           s.tickets_count, s.total, e.id as entry_id, e.status as estado_asiento, e.number as numero_asiento, e.series as serie_asiento,
           ci.id as factura_id, ci.number_text as factura, d.storage_path as documento, w.motivo as espera, w.automatica as espera_sola,
           (select count(*) from public.conta_cierre_ajuste a where a.company_id = s.company_id and a.location_id = s.location_id and a.unit_key = s.unit_key
             and (a.sales_day = s.sales_day or a.dia_destino = s.sales_day)) as ajustes,
           case when e.status in ('propuesto', 'borrador') then (select m.motivo from public.conta_motivos_para_validar(e.id) m order by m.orden limit 1) end as bloqueo
      from public.sales_day_summary s
      join public.locations l on l.id = s.location_id and l.account_id = v_cuenta
      left join public.sales_channel ch on ch.id = s.channel_id and ch.account_id = v_cuenta
      left join public.brand b on b.id = s.brand_id and b.account_id = v_cuenta
      left join public.journal_entry e on e.id = s.entry_id
      left join public.customer_invoice ci on ci.entry_id = s.entry_id and ci.origin = 'cierre_dia'
      left join public.journal_entry_document d on d.entry_id = s.entry_id and d.kind = 'resumen_ventas'
      left join public.conta_cierre_espera w on w.company_id = s.company_id and w.location_id = s.location_id and w.sales_day = s.sales_day and w.unit_key = s.unit_key
     where s.company_id = p_company and s.unit_key is not null and s.channel_id is not null
       and (p_desde is null or s.sales_day >= p_desde) and (p_hasta is null or s.sales_day <= p_hasta)
  ), sin as (
    -- Días sin ningún cierre que el cierre del día no ha podido proponer.
    select g.location_id, l.name as local, g.sales_day, g.result, g.reason
      from public.sales_day_proposal_log g join public.locations l on l.id = g.location_id and l.account_id = v_cuenta
     where g.company_id = p_company and g.result in ('sin_propuesta', 'fallo')
       and (p_desde is null or g.sales_day >= p_desde) and (p_hasta is null or g.sales_day <= p_hasta)
       and not exists (select 1 from public.sales_day_summary s2 join public.journal_entry e2 on e2.id = s2.entry_id
                        where s2.company_id = p_company and s2.location_id = g.location_id and s2.sales_day = g.sales_day and e2.status in ('propuesto', 'borrador', 'validado'))
  )
  select coalesce(jsonb_agg(x order by x->>'dia' desc, x->>'local', x->>'canal'), '[]'::jsonb) into v_r from (
    select jsonb_build_object('id', c.id, 'local_id', c.location_id, 'local', c.local, 'dia', c.sales_day, 'unidad', c.unit_key, 'canal_id', c.channel_id,
             'canal', coalesce(c.canal, 'Sin canal'), 'canal_slug', c.canal_slug, 'marca', c.marca, 'tiques', c.tickets_count, 'total', c.total,
             'asiento_id', c.entry_id, 'estado_asiento', c.estado_asiento, 'numero_asiento', c.numero_asiento, 'serie_asiento', c.serie_asiento,
             'factura_id', c.factura_id, 'factura', c.factura, 'documento', c.documento, 'ajustes', c.ajustes,
             'estado', case when c.estado_asiento = 'validado' then 'validado'
                            when c.estado_asiento = 'anulado' then 'anulado'
                            when c.entry_id is null or c.espera is not null or c.bloqueo is not null then 'en_espera'
                            else 'por_validar' end,
             'motivo', coalesce(c.espera, c.bloqueo, case when c.entry_id is null then 'Al rehacerlo no ha salido asiento: mira sus pedidos.' end),
             'espera_a_mano', c.espera is not null and not c.espera_sola) as x
      from c
    union all
    select jsonb_build_object('id', null, 'local_id', sin.location_id, 'local', sin.local, 'dia', sin.sales_day, 'unidad', null, 'canal', 'Sin cierre',
             'tiques', 0, 'total', 0, 'estado', 'en_espera', 'ajustes', 0, 'espera_a_mano', false,
             'motivo', coalesce(sin.reason, 'El cierre del día no ha podido proponerlo.'))
      from sin
  ) t;
  return v_r;
end $$;
revoke all on function public.conta_cierres(uuid, date, date) from public, anon;
grant execute on function public.conta_cierres(uuid, date, date) to authenticated;

-- La ficha de un cierre: sus pedidos (también los quitados y los pasados a
-- otro día, para poder deshacerlo: regla 7) con lo que se les ha cambiado.
create or replace function public.conta_cierre_pedidos(p_summary uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_d public.sales_day_summary; v_r jsonb;
begin
  v_d := public._conta_cierre_de(p_summary);
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese cierre no está.' using errcode = 'P0002'; end if;
  with dentro as (
    -- Lo de este cierre hoy (ya con los cambios). Solo marcas propias: las
    -- cedidas no son ventas de la empresa y no salen.
    select p.id, p.codigo, p.marca_id, p.propia, p.estado, p.total, p.base, p.cuota
      from public.conta_pedidos_del_dia(v_d.company_id, v_d.location_id, v_d.sales_day) p
     where p.propia and public.conta_unidad_ventas(v_d.company_id, p.canal_id, p.marca_id) = v_d.unit_key
  ), fuera as (
    -- Lo que era de este día y se ha quitado o pasado a otro.
    select a.sale_id as id from public.conta_cierre_ajuste a
     where a.company_id = v_d.company_id and a.location_id = v_d.location_id and a.sales_day = v_d.sales_day and a.unit_key = v_d.unit_key
       and (a.quitado or a.dia_destino is not null)
  ), todos as (
    select id from dentro union select id from fuera
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'codigo', coalesce(s.platform_order_code, s.pos_short_code, s.external_ref, left(s.id::text, 8)),
           'hora', to_char(s.sold_at at time zone 'Europe/Madrid', 'HH24:MI'), 'dia', (s.sold_at at time zone 'Europe/Madrid')::date,
           'marca', b.name, 'propia', coalesce(b.ownership_type, 'own') = 'own',
           'estado', coalesce(dn.estado, case when s.status = 'cancelled' and s.unconfirmed_at is not null then 'unconfirmed' else s.status end),
           'total', coalesce(dn.total, s.total), 'total_pedido', s.total,
           'cuenta', dn.id is not null and dn.propia and dn.estado = 'closed',
           'ajuste', case when a.id is null then null else jsonb_build_object('quitado', a.quitado, 'dia', a.dia_destino, 'importe', a.importe,
                     'importe_antes', a.importe_antes, 'motivo', a.motivo, 'quien', a.created_by_name, 'cuando', a.updated_at,
                     'de_otro_dia', a.dia_destino = v_d.sales_day) end)
         order by s.sold_at, s.id), '[]'::jsonb) into v_r
    from todos t
    join public.sale s on s.id = t.id and s.account_id = v_d.account_id
    left join dentro dn on dn.id = s.id
    left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
    left join public.conta_cierre_ajuste a on a.company_id = v_d.company_id and a.sale_id = s.id;
  return v_r;
end $$;
revoke all on function public.conta_cierre_pedidos(uuid) from public, anon;
grant execute on function public.conta_cierre_pedidos(uuid) to authenticated;

-- Rehacer la propuesta de una unidad en un día: quita la propuesta viva (no
-- validada) y la vuelve a pedir al motor del cierre del día, que ya cuenta con
-- los cambios. Lo que no se valida (sin propuesta) queda «en espera» con su
-- porqué. Devuelve qué ha pasado.
create or replace function public._conta_cierre_rehacer(p_company uuid, p_location uuid, p_dia date, p_unidad text, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_e public.journal_entry; v_p jsonb; v_u jsonb; v_r jsonb; v_res text := 'vacio'; v_porque text; v_id uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  perform pg_advisory_xact_lock(hashtextextended('sales_day:' || p_company::text || ':' || p_location || ':' || p_dia, 0));
  select e.* into v_e from public.sales_day_summary s join public.journal_entry e on e.id = s.entry_id
   where s.company_id = p_company and s.location_id = p_location and s.sales_day = p_dia and s.unit_key = p_unidad;
  if v_e.status = 'validado' then
    raise exception 'El cierre del % ya está validado: no se cambia. Se corrige desde su factura, con «Corregir».', to_char(p_dia, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  if v_e.status in ('propuesto', 'borrador') then delete from public.journal_entry where id = v_e.id; end if;
  v_p := public.conta_propuestas_ventas_dia(p_company, p_location, p_dia);
  select x into v_u from jsonb_array_elements(coalesce(v_p, '[]'::jsonb)) x where x->>'unit_key' = p_unidad limit 1;
  if v_u is null then
    v_res := 'vacio'; v_porque := 'No le queda ningún pedido que contar.';
  elsif v_u->'propuesta' ? 'sin_propuesta' then
    v_res := 'sin_propuesta'; v_porque := v_u->'propuesta'->>'sin_propuesta';
  else
    v_r := public._journal_entry_proponer(p_company, v_u->'propuesta'->'entrada', v_u->'propuesta'->'lineas', v_u->'propuesta'->'resumen', p_quien, auth.uid());
    v_id := nullif(v_r->>'id', '')::uuid;
    v_res := case when (v_r->>'descartada')::boolean then 'descartado' else 'propuesto' end;
    if v_res = 'descartado' then v_porque := 'Este cierre estaba descartado: no se vuelve a proponer.'; end if;
  end if;
  if v_res = 'vacio' then
    -- Sin pedidos que contar: su cierre dice cero (y en espera, con el porqué).
    update public.sales_day_summary set tickets_count = 0, total = 0, sale_ids = '{}', by_rate = '[]', by_channel = '[]', by_brand = '[]'
     where company_id = p_company and location_id = p_location and sales_day = p_dia and unit_key = p_unidad and entry_id is null;
  end if;
  if v_res = 'propuesto' then
    delete from public.conta_cierre_espera where company_id = p_company and location_id = p_location and sales_day = p_dia and unit_key = p_unidad and automatica;
  elsif exists (select 1 from public.sales_day_summary where company_id = p_company and location_id = p_location and sales_day = p_dia and unit_key = p_unidad) then
    insert into public.conta_cierre_espera (account_id, company_id, location_id, sales_day, unit_key, motivo, automatica, created_by_name)
    values (v_cuenta, p_company, p_location, p_dia, p_unidad, v_porque, true, p_quien)
    on conflict (company_id, location_id, sales_day, unit_key) do update set motivo = excluded.motivo
      where public.conta_cierre_espera.automatica;
  end if;
  return jsonb_build_object('dia', p_dia, 'resultado', v_res, 'porque', v_porque, 'asiento', v_id,
    'total', (select total from public.sales_day_summary where company_id = p_company and location_id = p_location and sales_day = p_dia and unit_key = p_unidad));
end $$;
revoke all on function public._conta_cierre_rehacer(uuid, uuid, date, text, text) from public, anon, authenticated;

-- «Guardar cambios» en la ficha de un cierre: los cambios de sus pedidos, de
-- una vez, y el cierre (y el del día al que se pase algo) rehecho con ellos.
-- p_cambios: [{pedido, accion: quitar|mover|importe|deshacer, motivo, dia, importe}].
-- Nada de esto toca el pedido de Folvy.
create or replace function public.conta_cierre_guardar(p_summary uuid, p_cambios jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_d public.sales_day_summary; v_c jsonb; v_s public.sale; v_a public.conta_cierre_ajuste; v_accion text; v_dia_pedido date; v_unidad text;
  v_dias date[] := '{}'; v_dia date; v_r jsonb; v_res jsonb := '[]'::jsonb; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
  v_antes numeric; v_n int := 0; v_importe numeric; v_destino date; v_estado text; v_codigo text;
begin
  v_d := public._conta_cierre_de(p_summary);
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese cierre no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia un cierre.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_cambios) <> 'array' or jsonb_array_length(p_cambios) = 0 then raise exception 'No hay cambios que guardar.' using errcode = '22023'; end if;
  select e.status into v_estado from public.journal_entry e where e.id = v_d.entry_id;
  if v_estado = 'validado' then
    raise exception 'Este cierre ya está validado: no se cambia. Se corrige desde su factura, con «Corregir».' using errcode = '23514';
  end if;
  v_antes := v_d.total;
  v_dias := array[v_d.sales_day];

  for v_c in select * from jsonb_array_elements(p_cambios) loop
    v_accion := v_c->>'accion';
    select * into v_s from public.sale where id = nullif(v_c->>'pedido', '')::uuid and account_id = v_d.account_id and location_id = v_d.location_id;
    if v_s.id is null then raise exception 'Ese pedido no es de este local.' using errcode = '22023'; end if;
    v_codigo := coalesce(v_s.platform_order_code, v_s.pos_short_code, v_s.external_ref, left(v_s.id::text, 8));
    v_dia_pedido := (v_s.sold_at at time zone 'Europe/Madrid')::date;
    v_unidad := public.conta_unidad_ventas(v_d.company_id, v_s.channel_id, v_s.brand_id);
    select * into v_a from public.conta_cierre_ajuste where company_id = v_d.company_id and sale_id = v_s.id for update;
    if v_unidad is distinct from v_d.unit_key
       or not (v_dia_pedido = v_d.sales_day or (v_a.id is not null and v_a.dia_destino = v_d.sales_day)) then
      raise exception 'El pedido % no es de este cierre.', v_codigo using errcode = '22023';
    end if;
    if v_a.id is not null and v_a.dia_destino is not null then v_dias := v_dias || v_a.dia_destino; end if;
    v_dias := v_dias || v_dia_pedido;

    if v_accion = 'deshacer' then
      delete from public.conta_cierre_ajuste where id = v_a.id;
    elsif v_accion = 'quitar' then
      if btrim(coalesce(v_c->>'motivo', '')) = '' then raise exception 'Para quitar el pedido % hay que decir por qué.', v_codigo using errcode = '22023'; end if;
      insert into public.conta_cierre_ajuste (account_id, company_id, sale_id, location_id, sales_day, unit_key, quitado, importe_antes, motivo, created_by, created_by_name)
      values (v_d.account_id, v_d.company_id, v_s.id, v_d.location_id, v_dia_pedido, v_unidad, true, v_s.total, btrim(v_c->>'motivo'), auth.uid(), v_quien)
      on conflict (company_id, sale_id) do update set quitado = true, dia_destino = null, importe = null, motivo = excluded.motivo,
        created_by = excluded.created_by, created_by_name = excluded.created_by_name, updated_at = now();
    elsif v_accion = 'mover' then
      v_destino := nullif(v_c->>'dia', '')::date;
      if v_destino is null then raise exception 'Falta el día al que pasar el pedido %.', v_codigo using errcode = '22023'; end if;
      if v_destino > public.conta_ultimo_dia_cerrado(v_d.company_id, now()) then
        raise exception 'El % aún no está cerrado: un pedido solo se pasa a un día ya cerrado.', to_char(v_destino, 'DD/MM/YYYY') using errcode = '22023';
      end if;
      if public.conta_mes_cerrado(v_d.company_id, v_destino) then
        raise exception 'El mes del % está cerrado: no se le pasan pedidos.', to_char(v_destino, 'DD/MM/YYYY') using errcode = '23514';
      end if;
      if v_destino = v_dia_pedido then
        -- Volver a su día es deshacer el paso (lo demás se queda).
        update public.conta_cierre_ajuste set dia_destino = null, updated_at = now() where id = v_a.id;
        delete from public.conta_cierre_ajuste where id = v_a.id and not quitado and dia_destino is null and importe is null;
      else
        insert into public.conta_cierre_ajuste (account_id, company_id, sale_id, location_id, sales_day, unit_key, dia_destino, importe_antes, motivo, created_by, created_by_name)
        values (v_d.account_id, v_d.company_id, v_s.id, v_d.location_id, v_dia_pedido, v_unidad, v_destino, v_s.total, nullif(btrim(v_c->>'motivo'), ''), auth.uid(), v_quien)
        on conflict (company_id, sale_id) do update set quitado = false, dia_destino = excluded.dia_destino,
          motivo = coalesce(excluded.motivo, public.conta_cierre_ajuste.motivo), created_by_name = excluded.created_by_name, updated_at = now();
      end if;
      v_dias := v_dias || v_destino;
    elsif v_accion = 'importe' then
      v_importe := round((v_c->>'importe')::numeric, 2);
      if v_importe is null or v_importe <= 0 then
        raise exception 'El importe del pedido % tiene que ser mayor que cero (para que no cuente, quítalo).', v_codigo using errcode = '22023';
      end if;
      if v_importe = v_s.total then
        update public.conta_cierre_ajuste set importe = null, updated_at = now() where id = v_a.id;
        delete from public.conta_cierre_ajuste where id = v_a.id and not quitado and dia_destino is null and importe is null;
      else
        insert into public.conta_cierre_ajuste (account_id, company_id, sale_id, location_id, sales_day, unit_key, importe, importe_antes, motivo, created_by, created_by_name)
        values (v_d.account_id, v_d.company_id, v_s.id, v_d.location_id, v_dia_pedido, v_unidad, v_importe, v_s.total, nullif(btrim(v_c->>'motivo'), ''), auth.uid(), v_quien)
        on conflict (company_id, sale_id) do update set quitado = false, importe = excluded.importe,
          motivo = coalesce(excluded.motivo, public.conta_cierre_ajuste.motivo), created_by_name = excluded.created_by_name, updated_at = now();
      end if;
    else
      raise exception 'Qué se hace con el pedido %: quitar, mover, importe o deshacer.', v_codigo using errcode = '22023';
    end if;
    v_n := v_n + 1;
  end loop;

  -- Rehacer cada día tocado (este y aquellos de donde o adonde se ha pasado algo).
  for v_dia in select distinct x from unnest(v_dias) x order by 1 loop
    v_r := public._conta_cierre_rehacer(v_d.company_id, v_d.location_id, v_dia, v_d.unit_key, v_quien);
    v_res := v_res || jsonb_build_array(v_r);
  end loop;
  select * into v_d from public.sales_day_summary where id = p_summary;
  return jsonb_build_object('id', p_summary, 'cambios', v_n, 'antes', v_antes, 'total', v_d.total, 'asiento', v_d.entry_id, 'dias', v_res);
end $$;
revoke all on function public.conta_cierre_guardar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_cierre_guardar(uuid, jsonb, text) to authenticated;

-- Poner un cierre en espera (con su motivo en una frase) o quitarlo (motivo vacío).
create or replace function public.conta_cierre_espera(p_summary uuid, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d public.sales_day_summary; v_estado text;
begin
  v_d := public._conta_cierre_de(p_summary);
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese cierre no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta deja un cierre en espera.' using errcode = '42501';
  end if;
  select status into v_estado from public.journal_entry where id = v_d.entry_id;
  if v_estado = 'validado' then raise exception 'Este cierre ya está validado.' using errcode = '23514'; end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    delete from public.conta_cierre_espera where company_id = v_d.company_id and location_id = v_d.location_id and sales_day = v_d.sales_day and unit_key = v_d.unit_key and not automatica;
    return jsonb_build_object('id', p_summary, 'en_espera', false);
  end if;
  insert into public.conta_cierre_espera (account_id, company_id, location_id, sales_day, unit_key, motivo, automatica, created_by_name)
  values (v_d.account_id, v_d.company_id, v_d.location_id, v_d.sales_day, v_d.unit_key, btrim(p_motivo), false, coalesce(p_quien_nombre, public.conta_nombre_actor()))
  on conflict (company_id, location_id, sales_day, unit_key) do update set motivo = excluded.motivo, automatica = false, created_by_name = excluded.created_by_name;
  return jsonb_build_object('id', p_summary, 'en_espera', true, 'motivo', btrim(p_motivo));
end $$;
revoke all on function public.conta_cierre_espera(uuid, text, text) from public, anon;
grant execute on function public.conta_cierre_espera(uuid, text, text) to authenticated;

-- Validar un cierre: el asiento con su PDF (journal_entry_validar_con_documento,
-- que lo guarda junto al asiento para el traspaso del mes) y su factura
-- resumen, numerada en la serie del canal, en UNA transacción. El PDF se hizo
-- en el navegador con el nº de asiento y el de factura que tocaban: si alguno
-- ha cambiado entre medias, no se valida y se vuelve a intentar (como la 0720).
-- No envía nada a Diez: entra en el traspaso del mes.
create or replace function public.conta_cierre_validar(p_entry uuid, p_numero integer, p_factura text, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_e public.journal_entry; v_d public.sales_day_summary; v_prev jsonb; v_val jsonb; v_code text; v_id uuid; v_num int; v_anio int; v_anual boolean;
  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor()); v_espera text; v_canal text; v_local text; v_cta uuid; v_l record; v_pos int := 0;
  v_base numeric := 0; v_iva numeric := 0; v_prev_hash text; v_hash text; v_emisor text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then raise exception 'Ese asiento no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta valida cierres.' using errcode = '42501';
  end if;
  select * into v_d from public.sales_day_summary where entry_id = p_entry and company_id = v_e.company_id and unit_key is not null and channel_id is not null;
  if v_d.id is null then raise exception 'Ese asiento no es el de un cierre del día de un canal.' using errcode = '22023'; end if;
  select motivo into v_espera from public.conta_cierre_espera
   where company_id = v_d.company_id and location_id = v_d.location_id and sales_day = v_d.sales_day and unit_key = v_d.unit_key;
  if v_espera is not null then raise exception 'Está en espera: %. Quítalo de espera para validarlo.', rtrim(v_espera, '.') using errcode = '23514'; end if;
  if exists (select 1 from public.customer_invoice where entry_id = p_entry) then raise exception 'Este cierre ya tiene su factura.' using errcode = '23505'; end if;

  -- La serie del canal: la suya, o se crea ahora con el código que la pantalla ya enseñó.
  v_code := public._conta_cierre_serie(v_e.company_id, v_d.channel_id);
  select ch.name into v_canal from public.sales_channel ch where ch.id = v_d.channel_id and ch.account_id = v_e.account_id;
  select l.name into v_local from public.locations l where l.id = v_d.location_id and l.account_id = v_e.account_id;
  insert into public.invoice_series (account_id, company_id, code, name, doc_type, digits, reset_yearly, starts_at, is_default, is_active, channel_id)
  values (v_e.account_id, v_e.company_id, v_code, 'Cierres del día · ' || coalesce(v_canal, 'canal'), 'simplified', 5, true, 1, false, true, v_d.channel_id)
  on conflict do nothing;
  v_prev := public.conta_cierre_factura_prevista(p_entry);
  if p_factura is null or v_prev->>'texto' <> p_factura then
    raise exception 'El PDF se hizo con la factura % y ahora le toca la % (se ha validado otro asiento de la serie a la vez): no se valida. Vuelve a pulsar.',
      coalesce(p_factura, '(ninguna)'), v_prev->>'texto' using errcode = '40001';
  end if;

  -- El asiento y su PDF (con todas sus reglas).
  v_val := public.journal_entry_validar_con_documento(p_entry, p_numero, p_ruta, p_nombre, p_sha256, p_bytes, v_quien);

  -- El número de la factura: el contador sin huecos de su serie y año.
  select reset_yearly into v_anual from public.invoice_series where company_id = v_e.company_id and code = v_code;
  v_anio := (v_prev->>'anio')::int;
  insert into public.customer_invoice_counter (company_id, account_id, series_code, fiscal_year, last_number)
  values (v_e.company_id, v_e.account_id, v_code, case when coalesce(v_anual, true) then v_anio else 0 end, (v_prev->>'numero')::int)
  on conflict (company_id, series_code, fiscal_year) do update set last_number = public.customer_invoice_counter.last_number + 1
  returning last_number into v_num;
  if v_num <> (v_prev->>'numero')::int then
    raise exception 'La factura del PDF es la % y le toca otro número (se ha validado otro asiento de la serie a la vez): no se valida. Vuelve a pulsar.', p_factura using errcode = '40001';
  end if;

  -- La factura resumen: una línea por tipo de IVA, con la base y la cuota del
  -- asiento (lo que dice el libro), a la cuenta de ventas principal del asiento.
  select l.company_account_id into v_cta from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = p_entry and a.code like '70%' order by l.credit desc, l.position limit 1;
  insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, issue_date, due_date, customer, location_id, notes,
                                       created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, 'borrador', 'factura', 'cierre_dia', v_code, v_d.sales_day, v_d.sales_day,
          jsonb_build_object('nombre', 'Ventas del día · ' || coalesce(v_canal, 'canal')), v_d.location_id,
          format('Factura resumen de las ventas del %s en %s (%s): %s tiques.', to_char(v_d.sales_day, 'DD/MM/YYYY'), coalesce(v_canal, 'el canal'), coalesce(v_local, 'el local'), v_d.tickets_count),
          auth.uid(), v_quien)
  returning id into v_id;
  for v_l in
    select l.tax_rate_id, t.rate, sum(case when l.credit > 0 then l.tax_base else -l.tax_base end) as base, sum(l.credit - l.debit) as cuota
      from public.journal_line l join public.tax_rate t on t.id = l.tax_rate_id
     where l.entry_id = p_entry and l.vat_book = 'issued' and l.tax_rate_id is not null
     group by 1, 2 order by 2 desc
  loop
    v_pos := v_pos + 1;
    insert into public.customer_invoice_line (account_id, company_id, invoice_id, position, concept, quantity, unit_price, discount_pct, tax_rate_id, tax_pct, revenue_account_id, amount)
    values (v_e.account_id, v_e.company_id, v_id, v_pos, format('Ventas del día al %s %%', to_char(v_l.rate, 'FM990D##')), 1, v_l.base, 0, v_l.tax_rate_id, v_l.rate, v_cta, v_l.base);
    v_base := v_base + v_l.base; v_iva := v_iva + v_l.cuota;
  end loop;
  if v_pos = 0 or v_cta is null then raise exception 'Este cierre no lleva IVA o cuenta de ventas: no se puede hacer su factura resumen.' using errcode = '23514'; end if;

  select hash into v_prev_hash from public.customer_invoice where company_id = v_e.company_id and status <> 'borrador' and hash is not null order by issued_at desc, id desc limit 1;
  select tax_id into v_emisor from public.company where id = v_e.company_id;
  v_hash := encode(sha256(convert_to(concat_ws('|', v_emisor, p_factura, v_d.sales_day::text, (v_base + v_iva)::text, coalesce(v_prev_hash, '')), 'UTF8')), 'hex');
  update public.customer_invoice set status = 'emitida', fiscal_year = v_anio, number = v_num, number_text = p_factura,
         base = v_base, tax = v_iva, total = v_base + v_iva, entry_id = p_entry, pdf_path = p_ruta, pdf_sha256 = p_sha256, pdf_bytes = p_bytes,
         prev_hash = v_prev_hash, hash = v_hash, issued_at = now(), issued_by_name = v_quien
   where id = v_id;
  -- El libro de expedidas lleva el número de la factura resumen.
  update public.vat_book_entry set number = p_factura, updated_at = now() where entry_id = p_entry and book = 'issued';
  perform public._conta_venta_evento(v_id, 'emitida',
    format('Factura resumen del cierre del %s (%s · %s), con el asiento nº %s y su PDF. Entra en el traspaso del mes.',
           to_char(v_d.sales_day, 'DD/MM/YYYY'), coalesce(v_canal, 'canal'), coalesce(v_local, 'local'), v_val->>'numero'),
    jsonb_build_object('asiento', p_entry, 'numero_asiento', v_val->'numero', 'cierre', v_d.id), v_quien);
  return jsonb_build_object('id', p_entry, 'serie', v_val->'serie', 'numero', v_val->'numero', 'factura', p_factura, 'factura_id', v_id, 'total', v_base + v_iva);
end $$;
revoke all on function public.conta_cierre_validar(uuid, integer, text, text, text, text, integer, text) from public, anon;
grant execute on function public.conta_cierre_validar(uuid, integer, text, text, text, text, integer, text) to authenticated;
