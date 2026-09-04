-- C9 · Lote 1 §2a · 04/09/2026 — label_token: LA ETIQUETA SE VUELVE IDENTIFICABLE.
-- ===========================================================================
-- HOY el QR de las etiquetas es `brand.shop_url` — la MISMA URL en las 18 marcas
--   de la cuenta. Verificado sobre una foto real: los seis QR decodifican a
--   `https://foodint.folvy.app/`. Como identificador no sirve para nada.
--
-- EL TOKEN ES OPACO, y esa es la condicion que manda: la etiqueta se va a casa
--   del cliente. Nada de sale_id en claro y nada enumerable desde fuera. 12
--   caracteres BASE36 EN MAYUSCULAS (A-Z0-9) de extensions.gen_random_bytes:
--   36^12 = 4,7e18, sobra de largo para que no se adivine.
--
-- ⚠️ POR QUE MAYUSCULAS Y NO base62 (Julio, 04/09) — y esta MEDIDO, no supuesto:
--   el modo ALFANUMERICO del QR admite 0-9 A-Z y unos pocos simbolos, pero NO
--   minusculas. Con la URL entera en mayusculas el simbolo entra en ese modo y
--   baja de version:
--     base62 minusculas, ECC Q ....... 40 car -> version 4, 33 modulos, byte
--     TODO mayusculas base36, ECC Q .. 40 car -> version 3, 29 modulos, alfanum.
--   A modulo 6 y 203 dpi son 24,8 mm frente a 21,8 mm de lado. Y en ECC Q sale
--   la MISMA version que saldria en M, asi que el repliegue a M deja de hacer
--   falta: se conserva el 25 % de correccion al precio del 15 %.
--   OJO: subir a mayusculas SOLO EL TOKEN no sirve de nada — medido, sigue
--   saliendo byte y version 4. Tiene que ir la URL ENTERA, dominio incluido, y
--   por eso /e/ se resuelve insensible a mayusculas (DNS ya lo es).
--
-- IDEMPOTENTE, Y AHI ESTA LA GRACIA: la reimpresion vuelve a pasar por
--   order_for_print (reprint_order encola el trabajo y la tablet re-consulta),
--   asi que si los tokens se acuñan aqui con `on conflict do nothing`, reimprimir
--   DEVUELVE LOS MISMOS. No hace falta codigo especial de reimpresion — que es
--   justo el requisito 4 del encargo, y el momento en que la etiqueta fisica y la
--   base dejarian de coincidir si se regeneraran.
--
-- ⚠️ ESTO NO PUEDE ROMPER UNA IMPRESION. Misma regla que B53: el registro es
--   contabilidad, la impresion es operacion. ensure_label_tokens NUNCA levanta
--   excepcion; si algo falla, no hay tokens y el renderizador cae al shop_url de
--   siempre. Se imprime peor, no se deja de imprimir.
--
-- LA TABLA NACE CERRADA (regla 16, B51): en `public` hay ALTER DEFAULT PRIVILEGES
--   con ALL a anon y authenticated, POR PARTIDA DOBLE. Se verifica aqui mismo.
--
-- LA BOLSA DE BEBIDAS lleva su propio token con line_id y unit_no a NULL. El
--   renderizador colapsa todas las bebidas en una etiqueta (limitacion aceptada:
--   su cantidad no sera verificable), y quien decide que es bebida es
--   `isDrinkOrDessert` en la tablet, no la base. Por eso se acuña SIEMPRE un
--   token de bolsa por venta: duplicar aqui esa heuristica seria tener dos
--   verdades que se separan con el tiempo. Una fila de mas por venta es barato.

begin;

create table if not exists public.label_token (
  token        text primary key,
  account_id   uuid not null,
  location_id  uuid,
  sale_id      uuid not null,
  line_id      uuid,          -- null = etiqueta de la bolsa de bebidas
  unit_no      int,           -- null = idem. 1..qty dentro de su linea
  created_at   timestamptz not null default now(),
  scanned_at   timestamptz,
  scan_count   int not null default 0,
  constraint label_token_unidad_unica unique nulls not distinct (sale_id, line_id, unit_no)
);

comment on table public.label_token is
  'C9 L1: identidad de una etiqueta impresa. (line_id, unit_no) la identifica; line_id/unit_no a NULL es la etiqueta de la bolsa de bebidas. El token es opaco a proposito: la etiqueta se va a casa del cliente. Escribe order_for_print via ensure_label_tokens (security definer); nadie mas.';
comment on column public.label_token.scanned_at is
  'De regalo: por primera vez se sabe cuantas etiquetas escanea la gente de verdad. Metrica que hoy no existe.';

create index if not exists ix_label_token_sale on public.label_token (sale_id);
create index if not exists ix_label_token_line on public.label_token (line_id, unit_no);

alter table public.label_token enable row level security;
revoke all on public.label_token from anon, authenticated;

drop policy if exists lt_read on public.label_token;
create policy lt_read on public.label_token
  for select to authenticated
  using (public.belongs_to_account(account_id));

-- ── El token: 12 caracteres base36 EN MAYUSCULAS (ver cabecera) ────────────
create or replace function public._label_token_nuevo()
returns text
language sql
volatile
set search_path to 'public'
as $function$
  select string_agg(
           substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                  1 + (get_byte(b.bytes, g.i) % 36), 1), '')
    from (select extensions.gen_random_bytes(12) as bytes) b,
         generate_series(0, 11) as g(i);
$function$;

-- ── Acuñado idempotente. NUNCA levanta excepcion. ───────────────────────────
create or replace function public.ensure_label_tokens(p_sale_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_acc uuid; v_loc uuid; v_n int := 0;
begin
  select account_id, location_id into v_acc, v_loc from sale where id = p_sale_id;
  if v_acc is null then return 0; end if;

  with objetivo as (
    -- lineas padre que NO son combo: la etiqueta es la linea
    select p.id as line_id, greatest(1, round(p.quantity)::int) as uds
      from sale_line p
     where p.sale_id = p_sale_id and p.parent_sale_line_id is null
       and not exists (select 1 from sale_line h
                        where h.parent_sale_line_id = p.id and h.line_type = 'combo_item')
    union all
    -- componentes de combo: la etiqueta es el COMPONENTE, no el padre
    select h.id, greatest(1, round(h.quantity)::int)
      from sale_line h
     where h.sale_id = p_sale_id and h.line_type = 'combo_item'
  ),
  unidades as (
    select o.line_id, g.n as unit_no from objetivo o, generate_series(1, o.uds) as g(n)
    union all
    select null::uuid, null::int              -- la bolsa de bebidas, siempre
  ),
  puestos as (
    insert into public.label_token (token, account_id, location_id, sale_id, line_id, unit_no)
    select public._label_token_nuevo(), v_acc, v_loc, p_sale_id, u.line_id, u.unit_no
      from unidades u
    on conflict on constraint label_token_unidad_unica do nothing
    returning 1
  )
  select count(*)::int into v_n from puestos;

  return v_n;
exception when others then
  -- La contabilidad no puede parar una impresion (regla de B53). Sin tokens, el
  -- renderizador cae al shop_url de siempre: se imprime peor, no se deja de
  -- imprimir. La señal duradera es que la etiqueta sale sin token, no el warning.
  raise warning 'ensure_label_tokens: venta % sin tokens (%): %', p_sale_id, sqlstate, sqlerrm;
  return 0;
end;
$function$;

revoke all on function public.ensure_label_tokens(uuid) from public, anon, authenticated;
grant execute on function public.ensure_label_tokens(uuid) to service_role;

-- ── Lectores para el JSON de order_for_print ────────────────────────────────
create or replace function public.label_tokens_for(p_line_id uuid)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select array_agg(t.token order by t.unit_no)
    from public.label_token t
   where t.line_id = p_line_id;
$function$;

create or replace function public.label_token_bolsa(p_sale_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.token from public.label_token t
   where t.sale_id = p_sale_id and t.line_id is null and t.unit_no is null
   limit 1;
$function$;

-- ── EL ENDPOINT: registrar el escaneo y decir a donde redirigir ─────────────
-- Devuelve la tienda de la marca. Un token DESCONOCIDO devuelve null y NO
-- escribe nada (requisito 6): quien llama redirige igual, usando el dominio por
-- el que entro. Un QR que alguien fotografia de una etiqueta vieja, o que se
-- inventa, no puede romper nada ni dejar rastro falso.
--
-- scanned_at se sella SOLO la primera vez; scan_count cuenta todas. Asi se
-- distingue «cuantas etiquetas se escanean» de «cuantas veces se escanea una».
create or replace function public.label_scan_register(p_token text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_url text;
begin
  if p_token is null or length(p_token) not between 8 and 32 then
    return null;
  end if;

  -- Insensible a mayusculas: el QR va todo en mayusculas (modo alfanumerico),
  -- pero alguien puede teclear la URL a mano en minusculas. Los tokens se
  -- guardan siempre en mayusculas, asi que basta con normalizar la entrada.
  update public.label_token t
     set scanned_at = coalesce(t.scanned_at, now()),
         scan_count = t.scan_count + 1
   where t.token = upper(p_token)
  returning (select b.shop_url from sale s join brand b on b.id = s.brand_id where s.id = t.sale_id)
    into v_url;

  return v_url;
exception when others then
  raise warning 'label_scan_register: token % (%): %', left(coalesce(p_token,''), 4), sqlstate, sqlerrm;
  return null;
end;
$function$;

revoke all on function public.label_scan_register(text) from public, anon, authenticated;
grant execute on function public.label_scan_register(text) to service_role;

-- ── VERIFICACION EN EL MISMO MOVIMIENTO (regla 16) ──────────────────────────
do $verif$
declare v_rol text; v_priv text;
begin
  foreach v_rol in array array['anon','authenticated'] loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if has_table_privilege(v_rol, 'public.label_token', v_priv) then
        raise exception 'C9 L1: % conserva % sobre label_token. La tabla NO nace cerrada.', v_rol, v_priv;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('service_role', 'public.label_token', 'SELECT') then
    raise exception 'C9 L1: service_role sin SELECT sobre label_token.';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relname='label_token' and c.relrowsecurity) then
    raise exception 'C9 L1: RLS no esta encendida en label_token.';
  end if;
  if length(public._label_token_nuevo()) <> 12 then
    raise exception 'C9 L1: el generador de token no da 12 caracteres.';
  end if;
  -- Si algun dia alguien mete una minuscula aqui, el QR se cae a modo byte y
  -- sube de version sin que nadie lo note hasta imprimir. Se comprueba.
  if public._label_token_nuevo() !~ '^[A-Z0-9]{12}$' then
    raise exception 'C9 L1: el token no es base36 en mayusculas; el QR perderia el modo alfanumerico.';
  end if;
end
$verif$;

commit;
