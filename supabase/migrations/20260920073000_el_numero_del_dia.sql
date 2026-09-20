-- ---------------------------------------------------------------------------
-- EL NÚMERO DEL DÍA · 20/09/2026 · Lote 1 del encargo del 20/09
-- ---------------------------------------------------------------------------
--
-- Un número corto por LOCAL y por DÍA DE SERVICIO, asignado UNA vez y estable,
-- que es el MISMO en la tarjeta del pase, en el ticket de cocina y en la
-- pegatina. Hoy el mismo pedido lleva tres números distintos y ninguno grande.
--
-- 🔴 BANDA DE SERVICIO. Esta migración **NO puede aplicarse entre las 12:15 y
--    las 23:45** (reloj de la base). Falla la condición 1 de la banda y no es
--    discutible: pone un disparador BEFORE INSERT OR UPDATE sobre `sale`, que
--    es el camino del pedido, medido y no supuesto. Las condiciones 2 y 3 sí
--    se cumplen (ningún ACCESS EXCLUSIVE sobre tabla del camino: `alter table
--    … add column` con default NULL no reescribe la tabla en PG 11+, y el
--    resto son create or replace de función). Ventana: antes de las 12:15 o
--    después de las 23:45.
--
-- ---------------------------------------------------------------------------
-- N2 · POR QUÉ UN HERMANO Y NO `pos_ticket_counter`, con el fichero delante
-- ---------------------------------------------------------------------------
--
-- Leído `supabase/migrations/20260815T1702_tpv_t1_pos_sale_rpc.sql`:
--
--   · línea 66:  «tabla interna, solo la toca _pos_next_ticket_code»
--   · línea 508: el TPV inserta la venta con
--                `pos_short_code = _pos_next_ticket_code(cuenta, local)`
--
-- O sea que `pos_ticket_counter` no numera pedidos: numera TICKETS DEL TPV, y
-- lo que escribe va a `sale.pos_short_code` con formato 'T042'. Y
-- `pos_short_code` es EXACTAMENTE el campo del que `passCode.ts` saca el
-- código de pase de Glovo y del reparto propio. Reutilizar esa fila hace dos
-- daños, no uno:
--
--   1. COLISIÓN VISIBLE. Con las dos secuencias en la misma fila, el pedido de
--      Glovo que coge el 42 para el pase y el ticket de mostrador que coge el
--      42 para su 'T042' enseñan el mismo número en el mismo pase.
--   2. Y el peor: LE MUEVE EL CORRELATIVO AL TPV. El 'Txxx' del mostrador es
--      el correlativo de su ticket, el que va en la factura simplificada.
--      Si el pase le consume números, el TPV pasa a saltar de 'T003' a 'T071'.
--      Eso no es un choque de nombres: es meterse en la numeración de un
--      documento que ya existe.
--
-- Además las poblaciones no son la misma: el TPV numera SOLO mostrador (2
-- filas en toda su historia, el piloto del 10 y 11/08); el pase tiene que
-- numerar TODO lo que entra al local —Glovo, Uber, Just Eat y mostrador—, que
-- en Alcalá son 69 de media y 139 el máximo (medido, 30 días, corte de 4 h).
--
-- Así que: TABLA HERMANA, misma forma y la MISMA regla de día de negocio.
--
-- ---------------------------------------------------------------------------
-- N3 · EL PEDIDO QUE CRUZA MEDIANOCHE — la regla ya existe en casa
-- ---------------------------------------------------------------------------
--
-- No se inventa nada: se reutiliza el corte de 4 h en la zona de la cuenta que
-- ya usan `_pos_next_ticket_code`, `orders_feed` y `_kitchen_day_banner_for`.
-- Un pedido de las 00:11 se cuenta en el día anterior.
--
-- La diferencia con lo de antes es que aquí el corte vive en UNA función
-- (`_pase_dia_de_negocio`) en vez de estar copiado en línea en cada sitio.
-- La deuda declarada en el TPV —«si algún día un local necesita un corte
-- distinto de 4 h, hoy no hay dónde configurarlo»— sigue abierta y sigue sin
-- cerrarse aquí, pero por lo menos ya sólo hay un sitio que tocar.
--
-- ---------------------------------------------------------------------------

begin;

-- ── 1 · El día de negocio, en un solo sitio ────────────────────────────────

create or replace function public._pase_dia_de_negocio(p_account_id uuid, p_momento timestamptz default now())
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select (date_trunc(
            'day',
            (p_momento at time zone coalesce(
               (select a.timezone from accounts a where a.id = p_account_id),
               'Europe/Madrid'))
            - make_interval(hours => 4))
         )::date;
$$;

comment on function public._pase_dia_de_negocio(uuid, timestamptz) is
  'Día de servicio con corte de 4 h en la zona de la cuenta. Un pedido de las 00:11 cae en el día anterior. Misma regla que _pos_next_ticket_code / orders_feed.';

revoke all on function public._pase_dia_de_negocio(uuid, timestamptz) from public, anon;
grant execute on function public._pase_dia_de_negocio(uuid, timestamptz) to authenticated, service_role;

-- ── 2 · El contador, hermano del del TPV ───────────────────────────────────

create table if not exists public.pase_day_counter (
  account_id     uuid not null references public.accounts(id),
  location_id    uuid not null references public.locations(id),
  business_date  date not null,
  last_number    integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (account_id, location_id, business_date)
);

comment on table public.pase_day_counter is
  'Contador del NÚMERO DEL DÍA del pase, por local y día de servicio. Hermano de pos_ticket_counter y deliberadamente separado: aquel numera tickets del TPV y escribe sale.pos_short_code (Txxx); éste numera TODO lo que entra al local. Ver la cabecera de 20260920073000.';

alter table public.pase_day_counter enable row level security;
revoke all on public.pase_day_counter from public, anon, authenticated;
-- Sin políticas: interna, sólo la toca _pase_siguiente_numero (SECURITY DEFINER).

-- ── 3 · Asignación ATÓMICA ─────────────────────────────────────────────────
--
-- El UPSERT toma el cerrojo de la fila del día y lo suelta al confirmar, así
-- que dos pedidos simultáneos se serializan y NO pueden coger el mismo número.
-- A 139 pedidos en el día más cargado, esa espera es inmedible.
--
-- Y no deja huecos: si la transacción que lo pidió se deshace, el incremento
-- se deshace con ella —es la misma transacción—, así que el número vuelve a
-- estar libre para el siguiente.

create or replace function public._pase_siguiente_numero(p_account_id uuid, p_location_id uuid, p_dia date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_num integer;
begin
  insert into pase_day_counter (account_id, location_id, business_date, last_number)
  values (p_account_id, p_location_id, p_dia, 1)
  on conflict (account_id, location_id, business_date)
  do update set last_number = pase_day_counter.last_number + 1, updated_at = now()
  returning last_number into v_num;
  return v_num;
end;
$$;

revoke all on function public._pase_siguiente_numero(uuid, uuid, date) from public, anon;
grant execute on function public._pase_siguiente_numero(uuid, uuid, date) to authenticated, service_role;

-- ── 4 · Dónde vive el número: en la venta ──────────────────────────────────

alter table public.sale add column if not exists pase_numero integer;
alter table public.sale add column if not exists pase_dia     date;

comment on column public.sale.pase_numero is
  'NÚMERO DEL DÍA del pase. Corto, por local y día de servicio. Se asigna UNA vez y no cambia: reimprimir no lo mueve.';
comment on column public.sale.pase_dia is
  'Día de servicio (corte 4 h) al que pertenece pase_numero. La pareja (location_id, pase_dia, pase_numero) identifica al pedido dentro del local.';

-- Índice para el resolutor de texto del segundo lector y para el recuento
-- diario. NO es único, y eso es una decisión, no un olvido:
--
-- 🔴 Un índice ÚNICO aquí convierte un choque imposible en un pedido
--    RECHAZADO. Es literalmente el incidente del 10/09: un NOT NULL correcto
--    sobre `recipe_item_location_stock.stock_value` se llevó por delante 79
--    entregas, 33 cambios de estado, 10 mermas y 7 cierres de venta. La
--    unicidad ya la garantiza el cerrojo del contador; lo que un índice único
--    añadiría no es seguridad, es una forma nueva de que no entre un pedido.
--    Se comprueba con una consulta (va en el parte), no con un cerrojo que
--    pueda cerrar la puerta.
create index if not exists sale_pase_numero_idx
  on public.sale (location_id, pase_dia, pase_numero)
  where pase_numero is not null;

-- ── 5 · El disparador: una vez, y estable ──────────────────────────────────
--
-- Se engancha donde YA se engancha la impresión (`tg_auto_print_on_accept`),
-- para que el número exista antes de que se encole el ticket de cocina: este
-- disparador es BEFORE y aquél AFTER, así que el orden está garantizado por
-- construcción, no por suerte.
--
-- Dos puertas, porque hay dos formas de nacer:
--   · INSERT  — el pedido entra ya vivo (plataformas, y el TPV, que nace con
--               order_status NULL y también tiene que salir en el pase).
--   · UPDATE  — red de seguridad: si entró muerto y luego se acepta.
-- Lo que nace rechazado o cancelado NO consume número.
--
-- 🔴 Y si algo falla aquí, el pedido ENTRA IGUAL. Se queda sin número y se ve
--    —la tarjeta y el papel enseñan el código de pase en su lugar—, que es
--    infinitamente mejor que un pedido que no entra. Misma regla que B53 y que
--    los tokens de etiqueta: se imprime peor, no se deja de imprimir.

create or replace function public.tg_sale_pase_numero()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_dia date;
begin
  if new.pase_numero is not null then
    return new;
  end if;
  if coalesce(new.order_status, '') in ('rejected', 'cancelled')
     or coalesce(new.status, '') = 'cancelled' then
    return new;
  end if;
  if TG_OP = 'UPDATE' and coalesce(new.order_status, '') <> 'accepted' then
    return new;   -- en UPDATE sólo actúa la red de seguridad
  end if;

  begin
    v_dia := public._pase_dia_de_negocio(
               new.account_id,
               coalesce(new.opened_at, new.sold_at, new.created_at, now()));
    new.pase_dia    := v_dia;
    new.pase_numero := public._pase_siguiente_numero(new.account_id, new.location_id, v_dia);
  exception when others then
    -- Ni un pedido se cae por un número. Se avisa y se sigue sin él.
    raise warning 'tg_sale_pase_numero: venta % sin número (%): %', new.id, sqlstate, sqlerrm;
    new.pase_dia    := null;
    new.pase_numero := null;
  end;

  return new;
end;
$$;

drop trigger if exists trg_sale_pase_numero on public.sale;
create trigger trg_sale_pase_numero
  before insert or update on public.sale
  for each row execute function public.tg_sale_pase_numero();

-- ── 6 · N5a · El número entra en `label_token` ─────────────────────────────
--
-- El token ES la identidad de la unidad impresa. Guardar aquí el número no es
-- duplicar un dato: es dejar escrito QUÉ DECÍA EL PAPEL, que es lo que va a
-- leer una cámara meses después.

alter table public.label_token add column if not exists pase_numero integer;
comment on column public.label_token.pase_numero is
  'El número del día que se imprimió en esta etiqueta. Se escribe al acuñar el token y no se toca nunca más.';

create or replace function public.ensure_label_tokens(p_sale_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_acc uuid; v_loc uuid; v_num int; v_n int := 0;
begin
  select account_id, location_id, pase_numero into v_acc, v_loc, v_num
    from sale where id = p_sale_id;
  if v_acc is null then return 0; end if;

  with objetivo as (
    select p.id as line_id, greatest(1, round(p.quantity)::int) as uds
      from sale_line p
     where p.sale_id = p_sale_id and p.parent_sale_line_id is null
       and not exists (select 1 from sale_line h
                        where h.parent_sale_line_id = p.id and h.line_type = 'combo_item')
    union all
    select h.id, greatest(1, round(h.quantity)::int)
      from sale_line h
     where h.sale_id = p_sale_id and h.line_type = 'combo_item'
  ),
  unidades as (
    select o.line_id, g.n as unit_no from objetivo o, generate_series(1, o.uds) as g(n)
    union all
    select null::uuid, null::int
  ),
  puestos as (
    insert into public.label_token (token, account_id, location_id, sale_id, line_id, unit_no, pase_numero)
    select public._label_token_nuevo(), v_acc, v_loc, p_sale_id, u.line_id, u.unit_no, v_num
      from unidades u
    on conflict on constraint label_token_unidad_unica do nothing
    returning 1
  )
  select count(*)::int into v_n from puestos;

  return v_n;
exception when others then
  raise warning 'ensure_label_tokens: venta % sin tokens (%): %', p_sale_id, sqlstate, sqlerrm;
  return 0;
end;
$$;

-- ── 7 · N5b · El resolutor de texto del segundo lector ─────────────────────
--
-- 🔴 LO QUE HAY QUE DECIR ANTES: la cámara del §4 de C9 NO EXISTE todavía.
--    Está el sitio donde guardar la foto (`sale_capture`, los buckets y la
--    purga, del 04/09) y está el primer lector, que es el QR. El SEGUNDO
--    lector —el que lee el texto impreso cuando el QR no se deja leer— no
--    tenía función ninguna: se buscó `pos_short_code` en `supabase/functions`
--    y en `src` y no aparece ni un resolutor. Así que esto no «actualiza» un
--    resolutor existente: lo CREA, y acepta las dos vías.
--
-- Acepta lo que una cámara puede sacar de la pegatina:
--   · 1–3 cifras  → el número del día, del día de servicio en curso.
--   · lo demás    → el código de pase (pos_short_code / platform_order_code).
--
-- Devuelve por qué vía casó, y si hay más de un candidato lo DICE en vez de
-- elegir por su cuenta: un verificador que desempata solo es un verificador
-- que un día pega la etiqueta en la bolsa de otro.

create or replace function public.pase_resolver_texto(p_device_token text, p_texto text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_device  kds_device;
  v_cuenta  uuid;
  v_local   uuid;
  v_dia     date;
  v_txt     text;
  v_res     jsonb;
  v_n       int;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'pase_resolver_texto: token de dispositivo no válido';
  end if;
  v_cuenta := v_device.account_id;
  v_local  := v_device.location_id;

  v_txt := upper(regexp_replace(coalesce(p_texto, ''), '[^0-9A-Za-z]', '', 'g'));
  if v_txt = '' then
    return jsonb_build_object('via', null, 'candidatos', 0, 'pedido', null);
  end if;

  v_dia := public._pase_dia_de_negocio(v_cuenta);

  -- Vía 1: el número del día. Sólo dentro del local y del día de servicio.
  if v_txt ~ '^[0-9]{1,3}$' then
    select count(*), (array_agg(jsonb_build_object(
             'sale_id', s.id, 'pase_numero', s.pase_numero,
             'codigo', coalesce(s.pos_short_code, s.platform_order_code),
             'marca', b.name, 'cliente', s.customer_name) order by s.sold_at desc))[1]
      into v_n, v_res
      from sale s
      left join brand b on b.id = s.brand_id
     where s.account_id = v_cuenta and s.location_id = v_local
       and s.pase_dia = v_dia and s.pase_numero = v_txt::int
       and coalesce(s.status, '') <> 'cancelled';
    if v_n = 1 then
      return jsonb_build_object('via', 'numero', 'candidatos', 1, 'pedido', v_res);
    end if;
    return jsonb_build_object('via', 'numero', 'candidatos', v_n, 'pedido', null);
  end if;

  -- Vía 2: el código de pase. Ventana de 12 h, como el propio pase.
  select count(*), (array_agg(jsonb_build_object(
           'sale_id', s.id, 'pase_numero', s.pase_numero,
           'codigo', coalesce(s.pos_short_code, s.platform_order_code),
           'marca', b.name, 'cliente', s.customer_name) order by s.sold_at desc))[1]
    into v_n, v_res
    from sale s
    left join brand b on b.id = s.brand_id
   where s.account_id = v_cuenta and s.location_id = v_local
     and s.sold_at >= now() - interval '12 hours'
     and coalesce(s.status, '') <> 'cancelled'
     and v_txt in (upper(coalesce(s.pos_short_code, '')), upper(coalesce(s.platform_order_code, '')));
  if v_n = 1 then
    return jsonb_build_object('via', 'codigo', 'candidatos', 1, 'pedido', v_res);
  end if;
  return jsonb_build_object('via', 'codigo', 'candidatos', v_n, 'pedido', null);
end;
$$;

revoke all on function public.pase_resolver_texto(text, text) from public, anon;
grant execute on function public.pase_resolver_texto(text, text) to authenticated, service_role, anon;

-- ── 8 · N6a · El número viaja al papel (`order_for_print`) ─────────────────
--
-- Se cambia SOLO lo que hay que cambiar y sin tocar la firma, así que
-- `create or replace` no crea sobrecarga (regla 2 vigilada: la regla es para
-- cambios de firma; aquí la firma es idéntica).
--
-- Dos cosas nuevas:
--   · `pase_numero` a nivel de pedido.
--   · `allergens_state` por línea — ver el bloque de abajo, que es lo que
--     impide que la pegatina mienta sobre comida.
--
-- 🔴 LOS TRES ESTADOS DE LOS ALÉRGENOS, y por qué no son dos.
--
-- El encargo dice: «si el plato no tiene alérgenos en ficha, la caja dice
-- ‹Alérgenos: sin datos›». Medido (Foodint, marcas propias activas, platos
-- activos con ficha: 204; con `contains`: 143; sin `contains`: 61 — el mismo
-- 61 del encargo), esos 61 NO son una sola cosa:
--
--   47 platos → las 14 filas puestas en `free`, CERO `unknown`. La ficha está
--               COMPLETA y dice que no lleva ninguno de los 14.
--   11 platos → cero filas. Nadie ha tocado la ficha.
--    3 platos → 1 `may_contain` y 13 `unknown`. Sólo una traza declarada.
--
-- Imprimir «sin datos» en los 47 sería una afirmación falsa en el sentido
-- contrario —y además tirar a la basura trabajo ya hecho, que es justo lo que
-- prohíbe la regla 30—. Así que la caja tiene tres respuestas y ninguna es un
-- hueco:
--
--   'listed'  → hay `contains`: se listan.
--   'none'    → sin `contains` y sin ninguna `unknown`: la ficha está entera y
--               dice que no. La caja dice «Ninguno de los 14».
--   'unknown' → todo lo demás (ficha en blanco, o alguna sin decidir). La caja
--               dice «Sin datos». Son 14 platos, listados en el parte.

create or replace function public.order_for_print(p_device_token text, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_device      kds_device;
  v_account_id  uuid;
  v_result      jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'order_for_print: token no válido';
  end if;
  v_account_id := v_device.account_id;

  begin
    perform public.fill_line_discounts(p_sale_id);
    perform public.ensure_label_tokens(p_sale_id);
  exception when others then
    null;
  end;

  with v as (
    select s.id, s.external_ref, s.external_tab_ref,
           s.platform_order_code, s.pos_short_code, s.platform_order_ref,
           s.order_status, s.status, s.service_type, s.source,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.customer_name, s.customer_phone, s.delivery_address,
           s.expected_time, s.customer_note,
           s.total, s.paid, s.payment_method, s.discount_amount, s.delivery_cost,
           s.pase_numero, s.pase_dia,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at, s.raw_tab
    from sale s
    where s.id = p_sale_id and s.account_id = v_account_id
  ),
  notas as (
    select v.id as sale_id, (prod->>'organizationProductId') as ext_pid,
           nullif(btrim(prod->>'comments'), '') as note
    from v
    cross join lateral (select safe_jsonb(v.raw_tab) as tab) rt
    cross join lateral (select coalesce(rt.tab -> 'products', rt.tab -> 'bills' -> 0 -> 'products') as products) p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.products)='array' then p.products else '[]'::jsonb end) as prod
    where nullif(btrim(prod->>'comments'),'') is not null and (prod->>'organizationProductId') is not null
  ),
  padres as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity, sl.line_type,
           sl.menu_item_id, sl.external_product_id, sl.unit_price, sl.line_total,
           sl.original_unit_price, sl.discount_label,
           mi.category as menu_category, df.name as family, df.color as family_color, df.icon as family_icon,
           array(select allergen_code from recipe_item_allergen a where a.recipe_item_id = ri.id and a.state='contains') as allergens,
           case
             when ri.id is null then 'unknown'
             when exists (select 1 from recipe_item_allergen a where a.recipe_item_id = ri.id and a.state='contains') then 'listed'
             when exists (select 1 from recipe_item_allergen a where a.recipe_item_id = ri.id)
              and not exists (select 1 from recipe_item_allergen a where a.recipe_item_id = ri.id and a.state='unknown') then 'none'
             else 'unknown'
           end as allergens_state
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join recipe_family df on df.id = ri.family_id
    where sl.sale_id = p_sale_id and sl.parent_sale_line_id is null
  ),
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.external_product_id, sl.menu_item_id, mg.group_type,
           dfh.name as family, dfh.color as family_color, mih.category as menu_category,
           case when sl.line_type='combo_item' then 1 when mg.group_type='removal' then 2
                when mg.group_type='extras' then 3 when mg.group_type in ('choice','side') then 4
                when mg.group_type in ('cross_sell','info') then 6 else 5 end as sort_rank
    from sale_line sl
    left join modifier_option mo on mo.id = sl.modifier_option_id
    left join modifier_group mg on mg.id = mo.modifier_group_id
    left join menu_item mih on mih.id = sl.menu_item_id
    left join recipe_item rih on rih.id = mih.recipe_item_id
    left join recipe_family dfh on dfh.id = rih.family_id
    where sl.sale_id = p_sale_id and sl.parent_sale_line_id is not null
  )
  select to_jsonb(t) into v_result from (
    select v.id as sale_id, v.external_ref, v.external_tab_ref,
           v.platform_order_code, v.pos_short_code, v.platform_order_ref, v.order_status, v.status, v.service_type, v.source,
           b.name as brand, b.logo_url as brand_logo_url, b.color as brand_color,
           b.shop_url as brand_shop_url, b.qr_caption as brand_qr_caption, b.ownership_type as brand_ownership_type,
           public.label_token_bolsa(v.id) as bag_token,
           v.pase_numero, v.pase_dia,
           coalesce(ch.name, v.external_channel_text) as channel, v.channel_id,
           v.customer_name, v.customer_phone, v.delivery_address, v.expected_time, v.customer_note,
           v.total, v.paid, v.payment_method, v.discount_amount, v.delivery_cost, v.entro_at,
           safe_jsonb(v.raw_tab)->'delivery' as delivery_detail,
           (select jsonb_agg(jsonb_build_object(
              'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity, 'menu_item_id', l.menu_item_id,
              'unit_tokens', public.label_tokens_for(l.line_id),
              'unit_price', l.unit_price, 'line_total', l.line_total,
              'original_unit_price', l.original_unit_price, 'discount_label', l.discount_label,
              'allergens', l.allergens,
              'allergens_state', l.allergens_state,
              'family', l.family, 'family_color', l.family_color, 'family_icon', l.family_icon,
              'menu_category', l.menu_category, 'has_recipe', (l.menu_item_id is not null),
              'customer_note', (select n.note from notas n where n.sale_id=l.sale_id and n.ext_pid=l.external_product_id limit 1),
              'children', coalesce((select jsonb_agg(jsonb_build_object(
                  'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity, 'line_type', h.line_type,
                  'unit_tokens', public.label_tokens_for(h.line_id),
                  'group_type', h.group_type, 'menu_item_id', h.menu_item_id, 'family', h.family,
                  'family_color', h.family_color, 'menu_category', h.menu_category
                ) order by h.sort_rank, h.product_name) from hijas h where h.parent_sale_line_id = l.line_id), '[]'::jsonb)
            ) order by l.product_name) from padres l) as lineas
    from v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  ) t;

  return v_result;
end;
$$;

-- ── 9 · N6b · El número viaja a la tarjeta del pase ────────────────────────
--
-- `pase_board` es una función de LECTURA que se pregunta en bucle mientras la
-- tablet está encendida. Aquí NO se asigna nada: sólo se lee la columna. El
-- 11/08 ya se pagó una vez el precio de que las lecturas escribieran.

create or replace function public.pase_board(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_device  kds_device;
  v_cuenta  uuid;
  v_local   uuid;
  v_nombre  text;
  v_papel   text;
  v_activo  boolean;
  v_res     jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'pase_board: token de dispositivo no válido';
  end if;
  v_cuenta := v_device.account_id;
  v_local  := v_device.location_id;

  select l.name into v_nombre from locations l where l.id = v_local;

  select case
           when v_device.station_ids is null
             or coalesce(array_length(v_device.station_ids, 1), 0) = 0 then 'ambas'
           when bool_and(k.kind = 'expo') then 'pase'
           when bool_and(k.kind = 'prep') then 'cocina'
           else 'ambas'
         end
    into v_papel
    from kitchen_station k
   where k.id = any(coalesce(v_device.station_ids, '{}'::uuid[]))
     and k.account_id = v_cuenta;
  v_papel := coalesce(v_papel, 'ambas');

  select coalesce(bool_or(k.pase_activo), false) into v_activo
    from kitchen_station k
   where k.location_id = v_local
     and k.kind = 'expo';
  v_activo := coalesce(v_activo, false);

  with vivos as (
    select s.*
      from sale s
     where s.location_id = v_local
       and s.account_id  = v_cuenta
       and s.sold_at >= now() - interval '12 hours'
       and coalesce(s.status, '') <> 'cancelled'
       and coalesce(s.order_status, '') not in ('rejected', 'cancelled', 'delivery_failed')
       and (coalesce(s.order_status, '') <> 'completed'
            or s.delivered_at >= now() - interval '40 minutes'
            or s.delivery_state in ('in_delivery', 'picked_up'))
  ),
  bolsa as (
    select pj.sale_id,
           (array_agg(pj.status order by pj.created_at desc))[1]     as estado,
           max(pj.created_at)                                        as cuando,
           count(*) filter (where pj.status = 'error')::int           as fallidos
      from print_job pj
     where pj.sale_id in (select id from vivos) and pj.doc_type = 'bag'
     group by pj.sale_id
  )
  select jsonb_agg(jsonb_build_object(
           'sale_id',   v.id,
           'codigo',    coalesce(v.pos_short_code, v.platform_order_code),
           -- EL NÚMERO DEL DÍA · el mismo que va en el ticket y en la pegatina.
           'numero',    v.pase_numero,
           'marca',     b.name,
           'marca_logo_url', b.logo_url,
           'cliente',   v.customer_name,
           'channel',   coalesce(c.name, v.external_channel_text),
           'order_status',  v.order_status,
           'service_type',  v.service_type,
           'has_courier',   v.has_courier,
           'carrier_code',  v.carrier_code,
           'source',        v.source,
           'delivery_state', v.delivery_state,
           'repartidor_nombre',     v.rider_name,
           'repartidor_telefono',   v.rider_phone,
           'repartidor_transporte', v.rider_transport_type,
           'entro_at',   coalesce(v.opened_at, v.sold_at, v.created_at),
           'ready_at',   v.ready_at,
           'handed_to_courier_at', v.handed_to_courier_at,
           'delivered_at',         v.delivered_at,
           'lineas', coalesce((
             select jsonb_agg(jsonb_build_object('nombre', sl.product_name,
                                                 'cantidad', sl.quantity)
                              order by sl.created_at)
               from sale_line sl
              where sl.sale_id = v.id and sl.parent_sale_line_id is null
                and coalesce(sl.line_type, '') <> 'modifier'), '[]'::jsonb),
           'bolsa', jsonb_build_object(
             'estado', case
                         when bo.sale_id is null then 'sin_pedir'
                         when bo.estado = 'done'  then 'hecha'
                         when bo.estado = 'error' then 'rota'
                         else 'esperando' end,
             'cuando',  to_char(bo.cuando at time zone 'Europe/Madrid', 'HH24:MI'),
             'intentos', coalesce(bo.fallidos, 0)),
           'avanzo_por', case
                           when v.delivery_state is not null then 'flota'
                           when v.ready_at is not null       then 'persona'
                           else null end,
           'avanzo_quien', null
         ) order by coalesce(v.opened_at, v.sold_at, v.created_at))
    into v_res
    from vivos v
    left join brand b on b.id = v.brand_id
    left join sales_channel c on c.id = v.channel_id
    left join bolsa bo on bo.sale_id = v.id;

  return jsonb_build_object(
    'local',       v_nombre,
    'papel',       v_papel,
    'pase_activo', v_activo,
    'ahora',       now(),
    'tarjetas',    coalesce(v_res, '[]'::jsonb));
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- VUELTA ATRÁS (si hiciera falta, en la misma ventana):
--
--   drop trigger if exists trg_sale_pase_numero on public.sale;
--   drop function if exists public.tg_sale_pase_numero();
--   -- order_for_print / pase_board / ensure_label_tokens: volver a la
--   -- definición anterior, que está en el historial de esta migración.
--   -- Las COLUMNAS y la tabla se dejan: quitarlas no arregla nada y
--   -- borraría números ya impresos en papel.
-- ---------------------------------------------------------------------------
