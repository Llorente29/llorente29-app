-- supabase/migrations/20261101T0050_s01i_comision_liquidacion.sql
--
-- S01i · Las facturas de comisión de las plataformas (Uber, Glovo, Just Eat)
-- se ligan a SU liquidación y se pagan solas, por compensación (Julio, 31/10 y
-- 01/11). Esta solo AÑADE:
--
--   1. channel_settlement_invoice: las facturas de comisión de cada
--      liquidación. Varias por liquidación (Uber manda a veces la tasa y la
--      publicidad aparte); una factura, a una sola liquidación. Se rellena con
--      lo que ya había en channel_settlement.commission_invoice_id, que se
--      quita en dos pasos (Julio, 01/11): primero el front deja de leerla.
--   2. _conta_dir_coincide: si un texto lleva la dirección de un local
--      (su calle, y su número si lo pone), y _conta_local_de_texto: el local
--      de la cuenta cuya dirección sale (solo si es uno; con dos, ninguno).
--   3. _conta_comision_datos: de una factura, su plataforma, su periodo, su
--      marca y su local, sacados de lo leído (nada escrito a mano).
--   4. _conta_comision_estado (y conta_comision_de_la_factura, para la
--      ficha, con la comprobación de cuenta): con qué liquidación va, o por qué no se
--      sabe, y las que encajan para elegir.
--   5. _conta_comision_pagar / _conta_comision_ligar / _conta_comision_buscar
--      y conta_comision_ligar (la persona elige): ligar y dejarla pagada por
--      compensación cuando está aprobada.
--
-- Los disparadores, el CHECK de la forma de pago y las listas de Pagos y
-- Bancos van en la 0051 (cambian). Los datos de Foodint, en la 0052.

create table if not exists public.channel_settlement_invoice (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  settlement_id uuid not null references public.channel_settlement(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoice(id) on delete cascade,
  matched_by text not null default 'sumied' check (matched_by in ('sumied', 'persona', 'antes')),
  matched_by_name text,
  created_at timestamptz not null default now(),
  constraint channel_settlement_invoice_una_liquidacion unique (supplier_invoice_id)
);
create index if not exists channel_settlement_invoice_liquidacion on public.channel_settlement_invoice (settlement_id);
alter table public.channel_settlement_invoice enable row level security;
drop policy if exists csi_read on public.channel_settlement_invoice;
create policy csi_read on public.channel_settlement_invoice for select using (account_id = any (public.current_user_account_ids()));
drop policy if exists csi_write on public.channel_settlement_invoice;
create policy csi_write on public.channel_settlement_invoice for all using (public.current_user_is_admin_of(account_id)) with check (public.current_user_is_admin_of(account_id));
grant select on public.channel_settlement_invoice to authenticated;

-- Lo que ya estaba ligado, tal cual (la misma cuenta a los dos lados).
insert into public.channel_settlement_invoice (account_id, settlement_id, supplier_invoice_id, matched_by, created_at)
select cs.account_id, cs.id, cs.commission_invoice_id, 'antes', cs.updated_at
  from public.channel_settlement cs join public.supplier_invoice si on si.id = cs.commission_invoice_id and si.account_id = cs.account_id
 where cs.commission_invoice_id is not null
on conflict (supplier_invoice_id) do nothing;

-- ¿Lleva `p_texto` la dirección `p_dir` (calle y número)? «Florencio Llorente, 29» está en
-- «Calle de Florencio Llorente 29, Madrid» y en «… - MAD - C. de Florencio Llorente 29».
create or replace function public._conta_dir_coincide(p_texto text, p_dir text)
returns boolean language sql immutable set search_path to 'public' as $$
  -- La calle tiene que estar. Si el texto pone un número detrás, tiene que ser el suyo («Inventada 120»
  -- no es «Inventada, 12»); si no lo pone, la calle tiene que ir como calle («C. de Florencio Llorente»,
  -- «(Camichi)»): «Empresa de Prueba» no es «Avenida de Prueba».
  with d as (
    select btrim(regexp_replace(regexp_replace(lower(coalesce(p_dir, '')), '^\s*(calle|c/|c\.|avenida|avda\.?|av\.|paseo|plaza|pza\.?)\s+(de\s+(la\s+|los\s+|las\s+)?)?', ''), '[,\s]*\d.*$', '')) as calle,
           substring(coalesce(p_dir, '') from '(\d+)') as num,
           regexp_replace(lower(coalesce(p_texto, '')), '\s+', ' ', 'g') as t),
  e as (select calle, num, t, position(calle in t) as pos from d)
  select coalesce(length(calle) >= 3 and pos > 0
                  and case when substring(substr(t, pos + length(calle)) from '^[\s,.]{0,3}(\d+)') is not null
                           then substring(substr(t, pos + length(calle)) from '^[\s,.]{0,3}(\d+)') = num
                           -- Sin número, solo si va como calle: «C. de …», «Calle …», «Avenida …» o «(…)».
                           else substr(t, 1, pos - 1) ~ '(\(|(calle|c/|c\.|avenida|avda\.?|av\.|paseo|plaza|pza\.?)\s*(de\s+(la\s+|los\s+|las\s+)?)?)\s*$' end, false)
    from e
$$;

-- El local de la cuenta cuya dirección sale en estos textos, por orden: en cada uno, primero lo
-- de antes del paréntesis (Glovo: «Marca - MAD - Camichi 4 (Calle de <la sede>)», donde el
-- paréntesis es la dirección de la sociedad) y luego el texto entero. Si casan dos locales, no
-- elige ninguno (regla de Julio: no se adivina). Medido contra las 22 tiendas de Foodint (01/11).
create or replace function public._conta_local_de_texto(p_account uuid, p_textos text[])
returns uuid language plpgsql stable set search_path to 'public' as $$
declare t text; p text; v_n int; v_id uuid;
begin
  foreach t in array coalesce(p_textos, '{}'::text[]) loop
    continue when t is null or btrim(t) = '';
    foreach p in array array[regexp_replace(t, '\(.*$', ''), t] loop
      select count(*), min(l.id::text)::uuid into v_n, v_id from public.locations l
       where l.account_id = p_account and l.address is not null and public._conta_dir_coincide(p, l.address);
      if v_n = 1 then return v_id; end if;
      if v_n > 1 then return null; end if;
    end loop;
  end loop;
  return null;
end $$;

-- Lo que se sabe de una factura de comisión: plataforma (el canal de su
-- proveedor), periodo (el que dicen sus líneas «05/10/26 - 11/10/26», el
-- leído, o la quincena si su fecha es el 15 o el último día del mes), marca
-- (la de la cuenta cuyo nombre sale en el destinatario o en la tienda) y local
-- (el de la cuenta cuya dirección sale en la tienda o en el destinatario).
create or replace function public._conta_comision_datos(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v public.supplier_invoice; v_canal uuid; v_lineas text; m text[]; v_desde date; v_hasta date;
  v_texto text; v_marca uuid; v_local uuid; v_dir text;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or v.supplier_id is null then return null; end if;
  select pl.channel_id into v_canal
    from public.party_role ps join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
   where ps.account_id = v.account_id and ps.role = 'supplier' and ps.supplier_id = v.supplier_id and pl.channel_id is not null
   limit 1;
  if v_canal is null then return null; end if;
  select string_agg(l.raw_text, ' | ') into v_lineas from public.supplier_invoice_line l where l.supplier_invoice_id = v.id;
  m := regexp_match(coalesce(v_lineas, ''), '(\d{2})/(\d{2})/(\d{2,4})\s*-\s*(\d{2})/(\d{2})/(\d{2,4})');
  if m is not null then
    v_desde := make_date(case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end, m[2]::int, m[1]::int);
    v_hasta := make_date(case when length(m[6]) = 2 then 2000 + m[6]::int else m[6]::int end, m[5]::int, m[4]::int);
  elsif v.reading->'factura'->'periodo'->>'hasta' ~ '^\d{4}-\d{2}-\d{2}$' then
    v_desde := nullif(v.reading->'factura'->'periodo'->>'desde', '')::date;
    v_hasta := (v.reading->'factura'->'periodo'->>'hasta')::date;
  elsif v.invoice_date is not null and extract(day from v.invoice_date) = 15 then
    v_desde := date_trunc('month', v.invoice_date)::date; v_hasta := v.invoice_date;
  elsif v.invoice_date is not null and v.invoice_date = (date_trunc('month', v.invoice_date) + interval '1 month - 1 day')::date then
    v_desde := date_trunc('month', v.invoice_date)::date + 15; v_hasta := v.invoice_date;
  end if;
  v_dir := nullif(btrim(coalesce(v.reading->'factura'->'tienda'->>'direccion', '')), '');
  v_texto := lower(concat_ws(' | ', v.reading->'factura'->'destinatario'->>'nombre', v.reading->'factura'->'tienda'->>'nombre', v_dir));
  select b.id into v_marca from public.brand b
   where b.account_id = v.account_id and length(btrim(b.name)) >= 3 and position(lower(btrim(b.name)) in v_texto) > 0
   order by length(b.name) desc limit 1;
  v_local := public._conta_local_de_texto(v.account_id, array[v_dir, v.reading->'factura'->'tienda'->>'nombre', v.reading->'factura'->'destinatario'->>'nombre']);
  return jsonb_build_object('canal', v_canal, 'desde', v_desde, 'hasta', v_hasta, 'marca', v_marca, 'local', v_local,
    'total', v.grand_total, 'direccion_leida', v_dir is not null);
end $$;

-- Lo que factura una liquidación (su factura de comisión, comisión y publicidad con IVA).
create or replace function public._conta_liquidacion_a_facturar(p_cs public.channel_settlement)
returns numeric language sql immutable as $$
  select case when jsonb_typeof(p_cs.raw->'factura') = 'object' and (p_cs.raw->'factura'->>'total') ~ '^-?[0-9.]+$'
              then round((p_cs.raw->'factura'->>'total')::numeric, 2) end
$$;

-- Con qué liquidación va una factura de comisión. `estado`:
--   ligada        ya lo está (`liquidacion`);
--   una           coincide al céntimo una sola, o la factura dice su marca y
--                 encaja una sola con su mismo periodo: se liga sin preguntar;
--   varias        hay candidatas pero ninguna segura (`candidatas`): elige la persona;
--   falta         no hay ninguna todavía: se ligará sola cuando llegue;
--   fuera         es de antes de la primera liquidación de su plataforma en
--                 Sumied: se compensó fuera de Sumied;
--   sin_periodo   no se sabe de qué periodo es: elige la persona (`candidatas`
--                 son las de su plataforma de los 45 días antes de su fecha);
--   no            no es de una plataforma.
create or replace function public._conta_comision_estado(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v public.supplier_invoice; d jsonb; v_canal uuid; v_desde date; v_hasta date; v_marca uuid; v_local uuid;
  v_cands jsonb; v_n int; v_exactas jsonb; v_primera date; v_lig uuid; v_porque text; v_plat text;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null then return jsonb_build_object('estado', 'no'); end if;
  select settlement_id into v_lig from public.channel_settlement_invoice where supplier_invoice_id = v.id and account_id = v.account_id;
  d := public._conta_comision_datos(v.id);
  if d is null then return jsonb_build_object('estado', 'no'); end if;
  v_canal := (d->>'canal')::uuid; v_desde := (d->>'desde')::date; v_hasta := (d->>'hasta')::date;
  v_marca := (d->>'marca')::uuid; v_local := (d->>'local')::uuid;
  select name into v_plat from public.sales_channel where id = v_canal;
  if v_lig is not null then
    -- Su liquidación, para la ficha: periodo, tienda, lo que factura, lo que suman sus facturas y lo que pagó.
    return jsonb_build_object('estado', 'ligada', 'liquidacion', v_lig, 'plataforma', v_plat, 'datos', d,
      'liq', (select jsonb_build_object('id', cs.id, 'desde', cs.period_from, 'hasta', cs.period_to,
                'tienda', regexp_replace(coalesce(ps.external_text, cs.external_location_text, ''), '\s*\(.*$', ''),
                'marca', (select name from public.brand where id = coalesce(cs.brand_id, ps.brand_id)),
                'local', (select name from public.locations where id = coalesce(cs.location_id, ps.location_id)),
                'a_facturar', public._conta_liquidacion_a_facturar(cs), 'te_pago', cs.net_payout, 'referencia', coalesce(cs.is_reference, false),
                'fecha', coalesce(cs.settlement_date, cs.period_to),
                'facturas', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'codigo', x.code, 'numero', x.invoice_number, 'total', x.grand_total) order by x.invoice_date, x.code), '[]'::jsonb)
                               from public.channel_settlement_invoice k join public.supplier_invoice x on x.id = k.supplier_invoice_id where k.settlement_id = cs.id))
                from public.channel_settlement cs left join public.platform_store ps on ps.id = cs.store_id where cs.id = v_lig));
  end if;
  select min(period_from) into v_primera from public.channel_settlement where account_id = v.account_id and channel_id = v_canal;
  if v_hasta is not null and (v_primera is null or v_hasta < v_primera) then
    return jsonb_build_object('estado', 'fuera', 'plataforma', v_plat, 'datos', d,
      'porque', case when v_primera is null then format('No hay ninguna liquidación de %s en Sumied: se compensó fuera de Sumied.', v_plat)
                     else format('Es de antes de la primera liquidación de %s en Sumied (%s): se compensó fuera de Sumied.', v_plat, to_char(v_primera, 'DD/MM/YYYY')) end);
  end if;
  -- Las que encajan: misma plataforma, el periodo se solapa, y su marca y su local si se saben.
  with c as (
    select cs.*, public._conta_liquidacion_a_facturar(cs) as a_facturar,
           coalesce(cs.brand_id, ps.brand_id) as marca, coalesce(cs.location_id, ps.location_id,
             public._conta_local_de_texto(cs.account_id, array[coalesce(ps.external_text, cs.external_location_text)])) as local,
           coalesce(ps.external_text, cs.external_location_text) as tienda,
           (select coalesce(sum(x.grand_total), 0) from public.channel_settlement_invoice k join public.supplier_invoice x on x.id = k.supplier_invoice_id
             where k.settlement_id = cs.id) as ya_facturado
      from public.channel_settlement cs left join public.platform_store ps on ps.id = cs.store_id
     where cs.account_id = v.account_id and cs.channel_id = v_canal
       and case when v_hasta is null then cs.period_to between v.invoice_date - 45 and v.invoice_date
                else cs.period_from <= v_hasta and cs.period_to >= coalesce(v_desde, v_hasta) end),
  f as (
    select c.* from c
     where (v_marca is null or c.marca = v_marca or (c.marca is null and position(lower((select name from public.brand where id = v_marca)) in lower(coalesce(c.tienda, ''))) > 0))
       and (v_local is null or c.local = v_local))
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'desde', f.period_from, 'hasta', f.period_to, 'tienda', regexp_replace(coalesce(f.tienda, ''), '\s*\(.*$', ''),
           'marca', (select name from public.brand where id = f.marca), 'local', (select name from public.locations where id = f.local),
           'a_facturar', f.a_facturar, 'ya_facturado', f.ya_facturado, 'te_pago', f.net_payout, 'referencia', coalesce(f.is_reference, false),
           'coincide', f.a_facturar is not null and (round(f.a_facturar * 100) = round(v.grand_total * 100)
                                                     or round((f.a_facturar - f.ya_facturado) * 100) = round(v.grand_total * 100)))
           order by f.period_to desc, f.id), '[]'::jsonb)
    into v_cands from f;
  v_n := jsonb_array_length(v_cands);
  if v_hasta is null then
    return jsonb_build_object('estado', 'sin_periodo', 'plataforma', v_plat, 'datos', d, 'candidatas', v_cands,
      'porque', 'La factura no dice de qué semana o quincena es: elige su liquidación.');
  end if;
  -- Ligar sin preguntar solo con una de estas dos (01/11, medido en Foodint: con una sola candidata y
  -- sin marca ni local se ligaban 12 facturas de Glovo de doce tiendas a la única liquidación de la quincena):
  --   · coincide al céntimo una sola (con lo que factura la liquidación, o con lo que le falta por facturar);
  --   · la factura dice su marca, encaja una sola y su periodo es exactamente el de la liquidación (una
  --     liquidación de varias semanas no se queda la factura de una de ellas).
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_exactas from jsonb_array_elements(v_cands) x where (x->>'coincide')::boolean;
  if jsonb_array_length(v_exactas) = 1 then
    return jsonb_build_object('estado', 'una', 'liquidacion', v_exactas->0->>'id', 'plataforma', v_plat, 'datos', d, 'candidatas', v_cands, 'por_importe', true);
  end if;
  if v_n = 1 and v_marca is not null and (v_cands->0->>'desde')::date = v_desde and (v_cands->0->>'hasta')::date = v_hasta then
    return jsonb_build_object('estado', 'una', 'liquidacion', v_cands->0->>'id', 'plataforma', v_plat, 'datos', d, 'candidatas', v_cands);
  end if;
  if v_n >= 1 then
    v_porque := format('%s de %s del %s al %s%s%s, y %s.',
      case when v_n = 1 then 'Hay una liquidación' else 'Hay ' || v_n || ' liquidaciones' end, v_plat, to_char(coalesce(v_desde, v_hasta), 'DD/MM'), to_char(v_hasta, 'DD/MM'),
      case when v_marca is not null then ' de ' || (select name from public.brand where id = v_marca) else '' end,
      case when v_local is not null then ' en ' || (select name from public.locations where id = v_local) else '' end,
      case when v_marca is null and v_local is null then 'la factura no dice de qué marca ni de qué local es'
           when v_marca is null then 'la factura no dice de qué marca es'
           when v_n = 1 then 'su periodo no es el de la factura'
           when v_local is null then 'la factura no dice la dirección de la tienda'
           else 'ninguna coincide sola al céntimo' end);
    return jsonb_build_object('estado', 'varias', 'plataforma', v_plat, 'datos', d, 'candidatas', v_cands, 'porque', v_porque);
  end if;
  return jsonb_build_object('estado', 'falta', 'plataforma', v_plat, 'datos', d, 'candidatas', '[]'::jsonb,
    'porque', format('Falta la liquidación: no hay ninguna de %s%s del %s al %s en Sumied. Se ligará sola cuando llegue.', v_plat,
      case when v_marca is not null then ' de ' || (select name from public.brand where id = v_marca) else '' end,
      to_char(coalesce(v_desde, v_hasta), 'DD/MM'), to_char(v_hasta, 'DD/MM/YYYY')));
end $$;

-- Lo mismo, para la ficha: solo la cuenta de la factura.
create or replace function public.conta_comision_de_la_factura(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.supplier_invoice where id = p_invoice;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501'; end if;
  return public._conta_comision_estado(p_invoice);
end $$;

-- Pagada por compensación, si está aprobada: con su liquidación (fecha de la
-- liquidación; el pago contra su asiento, si ya lo tiene) o «fuera de Sumied».
-- Nunca toca una que no está aprobada (la persona la valida antes) ni una pagada.
create or replace function public._conta_comision_pagar(p_invoice uuid, p_fuera boolean default false)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v public.supplier_invoice; cs public.channel_settlement; v_fecha date; v_nota text; v_quien constant text := 'Sumied · compensada con la liquidación';
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null or v.status <> 'aprobada' or v.paid_at is not null or coalesce(v.grand_total, 0) = 0 then return false; end if;
  if p_fuera then
    v_fecha := v.invoice_date; v_nota := 'Compensada fuera de Sumied (antes de su primera liquidación en Sumied)';
  else
    select c.* into cs from public.channel_settlement_invoice k join public.channel_settlement c on c.id = k.settlement_id
     where k.supplier_invoice_id = v.id and k.account_id = v.account_id;
    if cs.id is null then return false; end if;
    v_fecha := coalesce(cs.settlement_date, cs.period_to);
    v_nota := format('Compensada con la liquidación del %s al %s', to_char(cs.period_from, 'DD/MM'), to_char(cs.period_to, 'DD/MM/YYYY'));
  end if;
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, entry_id, created_by_name)
  values (v.account_id, v.company_id, v.id, v_fecha, v.grand_total, 'compensation', v_nota, cs.journal_entry_id, v_quien);
  update public.supplier_invoice set status = 'pagada', paid_at = v_fecha, paid_method = 'compensation', payment_method = 'compensation',
         paid_by_name = v_quien, updated_at = now() where id = v.id;
  insert into public.supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_name)
  values (v.account_id, v.id, 'paid', v_fecha, 'compensation', v_quien);
  return true;
end $$;

-- Ligar una factura a una liquidación (de su cuenta y de su plataforma) y pagarla si toca.
create or replace function public._conta_comision_ligar(p_invoice uuid, p_settlement uuid, p_por text, p_quien text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v public.supplier_invoice; cs public.channel_settlement;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  select * into cs from public.channel_settlement where id = p_settlement and account_id = v.account_id;
  if v.id is null or cs.id is null then raise exception 'Esa liquidación no es de la cuenta de la factura.' using errcode = '22023'; end if;
  if cs.channel_id is distinct from (public._conta_comision_datos(v.id)->>'canal')::uuid then
    raise exception 'Esa liquidación no es de la plataforma de la factura.' using errcode = '22023';
  end if;
  insert into public.channel_settlement_invoice (account_id, settlement_id, supplier_invoice_id, matched_by, matched_by_name)
  values (v.account_id, cs.id, v.id, p_por, p_quien)
  on conflict (supplier_invoice_id) do update set settlement_id = excluded.settlement_id, matched_by = excluded.matched_by,
    matched_by_name = excluded.matched_by_name, created_at = now();
  -- Mientras el resto de la base lea la columna de antes (se quita en otra tanda), la primera factura va también ahí.
  update public.channel_settlement set commission_invoice_id = v.id, updated_at = now() where id = cs.id and commission_invoice_id is null;
  update public.supplier_invoice set payment_method = 'compensation', updated_at = now() where id = v.id and payment_method is distinct from 'compensation';
  perform public._conta_comision_pagar(v.id);
end $$;

-- Buscarle liquidación a una factura y ligarla si encaja una sola (o pagarla
-- «fuera de Sumied»). Devuelve el estado de conta_comision_de_la_factura.
create or replace function public._conta_comision_buscar(p_invoice uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; v public.supplier_invoice;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or v.status in ('anulada', 'descartada') then return null; end if;
  r := public._conta_comision_estado(v.id);
  if r->>'estado' = 'no' then return 'no'; end if;
  update public.supplier_invoice set payment_method = 'compensation', updated_at = now() where id = v.id and payment_method is distinct from 'compensation';
  if r->>'estado' = 'una' then
    perform public._conta_comision_ligar(v.id, (r->>'liquidacion')::uuid, 'sumied', 'Sumied');
  elsif r->>'estado' = 'fuera' then
    perform public._conta_comision_pagar(v.id, true);
  elsif r->>'estado' = 'ligada' then
    perform public._conta_comision_pagar(v.id);
  end if;
  return r->>'estado';
end $$;

-- La persona elige la liquidación de una factura (la ficha, «No sé con qué liquidación va»).
create or replace function public.conta_comision_ligar(p_invoice uuid, p_settlement uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v public.supplier_invoice; cs public.channel_settlement; v_pagada boolean;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or not public.belongs_to_account(v.account_id) then raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501'; end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta liga facturas con liquidaciones.' using errcode = '42501';
  end if;
  perform public._conta_comision_ligar(v.id, p_settlement, 'persona', coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona'));
  select * into cs from public.channel_settlement where id = p_settlement;
  select status = 'pagada' into v_pagada from public.supplier_invoice where id = v.id;
  return jsonb_build_object('liquidacion', cs.id, 'pagada', v_pagada,
    'texto', format('Ligada con la liquidación del %s al %s%s', to_char(cs.period_from, 'DD/MM'), to_char(cs.period_to, 'DD/MM/YYYY'),
      case when v_pagada then ': pagada por compensación, no se paga por banco.' else ': quedará pagada por compensación al validarla.' end));
end $$;

revoke all on function public._conta_comision_pagar(uuid, boolean) from public, anon, authenticated;
revoke all on function public._conta_comision_ligar(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public._conta_comision_buscar(uuid) from public, anon, authenticated;
revoke all on function public._conta_comision_estado(uuid) from public, anon, authenticated;
revoke all on function public._conta_comision_datos(uuid) from public, anon, authenticated;
revoke all on function public._conta_local_de_texto(uuid, text[]) from public, anon, authenticated;
