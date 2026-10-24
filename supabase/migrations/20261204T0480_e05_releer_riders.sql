-- supabase/migrations/20261204T0480_e05_releer_riders.sql
-- cambia: public.conta_lote_pedidos_app · prueba: supabase/staging/sql/20261204_e05_releer_riders_prueba.sql
-- cambia: public.conta_lote_cruce_guardar · prueba: supabase/staging/sql/20261204_e05_releer_riders_prueba.sql
--
-- E05 · VOLVER A LEER LOS PDF DE UNA QUINCENA DE CATCHER, EN EL SERVIDOR
-- (Julio, 22/10).
--
-- La lectura de cada PDF (comprobarPdf) se guarda al subir la quincena, en el
-- navegador, y «Volver a comprobar» solo volvía a cruzar con esa lectura. La 1.ª
-- quincena de octubre se subió con el texto en el orden de dibujo, antes del
-- arreglo del #278, y pdf_pedidos falló en las 83: siguen «en duda» aunque sus
-- PDF digan lo mismo que el Excel. Con esto lo hace el servidor (la función
-- conta-lote-releer), sin depender de la sesión de nadie:
--
--   1. conta_lote_relectura: cada vez que se pide volver a leer un lote, quién
--      y cuándo, y lo que salió (cuántas se releyeron, cuántas quedaron
--      seguras al leer, cuántas no se tocaron y el cruce), o el error.
--   2. conta_lote_releer_pedir: la pide un administrador o un encargado de la
--      cuenta (lo llama la función con la sesión de quien pulsa «Volver a
--      comprobar»), y conta_lote_releer_lanzar la pide desde la base, sin
--      sesión: llama a la función con el cron_secret del Vault. Solo postgres.
--   3. conta_lote_relectura_guardar: guarda la lectura nueva del PDF (las
--      comprobaciones pdf_*) y su confianza, SOLO de las facturas del lote que
--      siguen en revisión. Lo que ya decidió una persona (aprobada, descartada…)
--      no se toca, y las cosas por aclarar decididas tampoco: las respeta el
--      cruce (conta_lote_cruce_guardar, como siempre).
--   4. conta_lote_relectura_hecha: apunta lo que salió, o el error.
--   5. Para que el servidor pueda cruzar, conta_lote_pedidos_app y
--      conta_lote_cruce_guardar admiten también la clave de servicio
--      (auth.role() = 'service_role'), la condición de la 0450. Nada más cambia
--      en ellas: los cuerpos son los de producción (md5 7586a749… y 79a57d0b…,
--      medidos el 22/10), con esa condición. La vuelta atrás los devuelve byte
--      a byte.
--
-- Solo añade, salvo esas dos funciones (misma firma). No toca ninguna fila al
-- aplicarse. conta_lote_pedidos_app lee sale (el camino del pedido) y sigue
-- solo leyendo; nada de esto escribe en el camino del pedido. No toca coste ni
-- stock (regla 10: sin sus cuatro caminos).

-- 1. Las relecturas -------------------------------------------------------------------
create table if not exists public.conta_lote_relectura (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  batch_id uuid not null references public.supplier_batch(id) on delete cascade,
  pedida_en timestamptz not null default now(),
  pedida_por uuid,
  pedida_por_nombre text,
  empezada_en timestamptz,
  hecha_en timestamptz,
  releidas integer,
  seguras integer,
  sin_tocar integer,
  cruce jsonb,
  error text
);
comment on table public.conta_lote_relectura is
  'E05 · Cada vez que se vuelven a leer en el servidor los PDF de una quincena de Catcher (conta-lote-releer): quién lo pidió, cuántas facturas se releyeron, cuántas quedaron seguras al leer, cuántas no se tocaron (ya decididas) y el cruce de después; o el error.';
create index if not exists conta_lote_relectura_lote on public.conta_lote_relectura (batch_id, pedida_en desc);
alter table public.conta_lote_relectura enable row level security;
revoke all on table public.conta_lote_relectura from public, anon, authenticated;
grant select on table public.conta_lote_relectura to authenticated;
drop policy if exists conta_lote_relectura_leer on public.conta_lote_relectura;
create policy conta_lote_relectura_leer on public.conta_lote_relectura for select to authenticated
  using (public.belongs_to_account(account_id));

-- 2. Pedirla ------------------------------------------------------------------------
create or replace function public.conta_lote_releer_pedir(p_lote uuid, p_quien_nombre text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_l public.supplier_batch; v_id uuid;
begin
  select * into v_l from public.supplier_batch where id = p_lote;
  if v_l.id is null or not public.belongs_to_account(v_l.account_id) then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_l.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta vuelve a comprobar las facturas.' using errcode = '42501';
  end if;
  insert into public.conta_lote_relectura (account_id, batch_id, pedida_por, pedida_por_nombre)
  values (v_l.account_id, v_l.id, auth.uid(), nullif(trim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), ''))
  returning id into v_id;
  return v_id;
end $$;
comment on function public.conta_lote_releer_pedir(uuid, text) is
  'E05 · Un administrador o un encargado pide volver a leer los PDF de un lote (lo llama conta-lote-releer con su sesión). Devuelve la relectura.';
revoke all on function public.conta_lote_releer_pedir(uuid, text) from public, anon;
grant execute on function public.conta_lote_releer_pedir(uuid, text) to authenticated;

create or replace function public.conta_lote_releer_lanzar(p_lote uuid, p_quien_nombre text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_l public.supplier_batch; v_id uuid; v_secreto text;
begin
  select * into v_l from public.supplier_batch where id = p_lote;
  if v_l.id is null then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
  if nullif(trim(coalesce(p_quien_nombre, '')), '') is null then raise exception 'Hay que decir quién la pide.' using errcode = '22023'; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede llamar a conta-lote-releer.' using errcode = '55000';
  end if;
  insert into public.conta_lote_relectura (account_id, batch_id, pedida_por_nombre)
  values (v_l.account_id, v_l.id, trim(p_quien_nombre))
  returning id into v_id;
  perform net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-lote-releer',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := jsonb_build_object('lote', v_l.id, 'relectura', v_id), timeout_milliseconds := 150000);
  return v_id;
end $$;
comment on function public.conta_lote_releer_lanzar(uuid, text) is
  'E05 · Pide volver a leer los PDF de un lote desde la base, sin sesión: apunta la relectura y llama a conta-lote-releer con el cron_secret. Solo postgres (lo que se lanza a mano por encargo).';
revoke all on function public.conta_lote_releer_lanzar(uuid, text) from public, anon, authenticated, service_role;

-- 3. Guardar la lectura nueva ----------------------------------------------------------
-- p_lecturas: [{ factura: <supplier_invoice.id>, contraPdf: [{id: 'pdf_…', ok, texto}…], sha256 }]
create or replace function public.conta_lote_relectura_guardar(p_relectura uuid, p_lecturas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.conta_lote_relectura; v_f public.supplier_invoice; x jsonb; v_comp jsonb; v_conf text;
  v_rel int := 0; v_seg int := 0; v_sin int := 0;
begin
  select * into v_r from public.conta_lote_relectura where id = p_relectura for update;
  if v_r.id is null then raise exception 'Esa relectura no está.' using errcode = 'P0002'; end if;
  if v_r.hecha_en is not null then raise exception 'Esa relectura ya está hecha.' using errcode = '23505'; end if;
  if coalesce(jsonb_typeof(p_lecturas), '') <> 'array' then raise exception 'Las lecturas tienen que ser una lista.' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_lecturas) loop
    select * into v_f from public.supplier_invoice f where f.id = (x->>'factura')::uuid and f.batch_id = v_r.batch_id and f.account_id = v_r.account_id for update;
    if v_f.id is null then raise exception 'Una de las facturas no es de este lote.' using errcode = '22023'; end if;
    if coalesce(jsonb_typeof(x->'contraPdf'), '') <> 'array' or jsonb_array_length(x->'contraPdf') = 0
       or exists (select 1 from jsonb_array_elements(x->'contraPdf') c where coalesce(c->>'id', '') !~ '^pdf_' or jsonb_typeof(c->'ok') <> 'boolean') then
      raise exception 'La lectura de la % no es una lista de comprobaciones del PDF.', v_f.invoice_number using errcode = '22023';
    end if;
    -- Lo que ya decidió una persona no se toca.
    if v_f.status <> 'en_revision' then v_sin := v_sin + 1; continue; end if;
    v_comp := coalesce((select jsonb_agg(c) from jsonb_array_elements(coalesce(v_f.reading->'comprobaciones', '[]'::jsonb)) c where coalesce(c->>'id', '') !~ '^pdf_'), '[]'::jsonb)
              || (x->'contraPdf');
    -- Segura al leer con la misma regla que conta_lote_registrar: todo bien, con su
    -- PDF, con proveedor y cada tienda con su local.
    v_conf := case when not exists (select 1 from jsonb_array_elements(v_comp) c where (c->>'ok')::boolean is not true)
                     and v_f.raw_document_url is not null and v_f.supplier_id is not null
                     and (v_f.location_id is not null or (jsonb_array_length(coalesce(v_f.reading->'lote'->'reparto', '[]'::jsonb)) > 0
                          and not exists (select 1 from jsonb_array_elements(v_f.reading->'lote'->'reparto') r where coalesce(r->>'localId', '') = '')))
                   then 'seguro' else 'duda' end;
    update public.supplier_invoice f
       set reading = jsonb_set(jsonb_set(jsonb_set(coalesce(f.reading, '{}'::jsonb), '{comprobaciones}', v_comp), '{confianza}', to_jsonb(v_conf)),
                               '{relectura}', jsonb_build_object('id', v_r.id, 'cuando', now(), 'sha256', x->>'sha256')),
           updated_at = now()
     where f.id = v_f.id;
    v_rel := v_rel + 1;
    if v_conf = 'seguro' then v_seg := v_seg + 1; end if;
  end loop;
  update public.conta_lote_relectura set releidas = v_rel, seguras = v_seg, sin_tocar = v_sin where id = v_r.id;
  return jsonb_build_object('releidas', v_rel, 'seguras', v_seg, 'sin_tocar', v_sin);
end $$;
comment on function public.conta_lote_relectura_guardar(uuid, jsonb) is
  'E05 · Guarda la lectura nueva de los PDF de un lote (las comprobaciones pdf_* y la confianza al leer), solo de las facturas que siguen en revisión. Solo el servidor (conta-lote-releer).';
revoke all on function public.conta_lote_relectura_guardar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.conta_lote_relectura_guardar(uuid, jsonb) to service_role;

-- 4. Lo que salió -------------------------------------------------------------------
create or replace function public.conta_lote_relectura_hecha(p_relectura uuid, p_cruce jsonb, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conta_lote_relectura
     set hecha_en = now(), cruce = p_cruce, error = left(nullif(trim(coalesce(p_error, '')), ''), 500)
   where id = p_relectura and hecha_en is null;
  if not found then raise exception 'Esa relectura no está o ya está hecha.' using errcode = 'P0002'; end if;
end $$;
comment on function public.conta_lote_relectura_hecha(uuid, jsonb, text) is
  'E05 · Apunta lo que salió de una relectura (el cruce) o su error. Solo el servidor (conta-lote-releer).';
revoke all on function public.conta_lote_relectura_hecha(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.conta_lote_relectura_hecha(uuid, jsonb, text) to service_role;

create or replace function public.conta_lote_relectura_empezar(p_relectura uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_lote_relectura;
begin
  update public.conta_lote_relectura set empezada_en = now()
   where id = p_relectura and empezada_en is null and hecha_en is null
  returning * into v_r;
  if v_r.id is null then raise exception 'Esa relectura no está, o ya empezó.' using errcode = 'P0002'; end if;
  return jsonb_build_object('lote', v_r.batch_id, 'cuenta', v_r.account_id, 'quien', v_r.pedida_por_nombre);
end $$;
comment on function public.conta_lote_relectura_empezar(uuid) is
  'E05 · Marca que una relectura empieza (una sola vez) y dice de qué lote es. Solo el servidor (conta-lote-releer).';
revoke all on function public.conta_lote_relectura_empezar(uuid) from public, anon, authenticated;
grant execute on function public.conta_lote_relectura_empezar(uuid) to service_role;

-- 5. Las dos de cruzar, también para el servidor --------------------------------------
-- Los cuerpos de producción (22/10) con «or auth.role() = 'service_role'». Nada más.
create or replace function public.conta_lote_pedidos_app(p_lote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_l public.supplier_batch;
begin
  select * into v_l from public.supplier_batch where id = p_lote;
  if v_l.id is null or not (public.belongs_to_account(v_l.account_id) or auth.role() = 'service_role') then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
  -- Un día antes y uno después: un pedido de las 23:50 puede ir en la factura del día siguiente.
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'codigo', coalesce(s.pos_short_code, s.platform_order_code, ''), 'momento', s.sold_at,
                                        'localId', s.location_id, 'marcaId', s.brand_id, 'canalId', s.channel_id,
                                        'estado', coalesce(s.delivery_state, ''), 'precio', s.transport_price) order by s.sold_at)
      from public.sale s
     where s.account_id = v_l.account_id and s.carrier_code = v_l.provider
       and s.sold_at >= ((v_l.period_from - 1)::timestamp at time zone 'Europe/Madrid')
       and s.sold_at <  ((v_l.period_to + 2)::timestamp at time zone 'Europe/Madrid')), '[]'::jsonb);
end $$;

create or replace function public.conta_lote_cruce_guardar(p_lote uuid, p_cruce jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_l public.supplier_batch; a jsonb; k text; v jsonb;
  v_bien int := 0; v_mal int := 0; v_n int; v_abiertas int;
begin
  select * into v_l from public.supplier_batch where id = p_lote for update;
  if v_l.id is null or not (public.belongs_to_account(v_l.account_id) or auth.role() = 'service_role') then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
  if not (public.current_user_is_admin_or_manager_of(v_l.account_id) or auth.role() = 'service_role') then
    raise exception 'Solo un administrador o un encargado de la cuenta cruza las facturas.' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_cruce->'facturas'), '') <> 'object' or coalesce(jsonb_typeof(p_cruce->'porAclarar'), '') <> 'array' then
    raise exception 'El cruce no trae sus facturas y lo que hay que aclarar.' using errcode = '22023';
  end if;

  -- Lo abierto se rehace; lo que ya decidió una persona se queda.
  delete from public.supplier_batch_issue where batch_id = p_lote and status = 'abierta';
  for a in select * from jsonb_array_elements(p_cruce->'porAclarar') loop
    -- Si la persona ya decidió sobre ese mismo pedido y motivo, no se vuelve a abrir.
    if exists (select 1 from public.supplier_batch_issue i where i.batch_id = p_lote and i.status <> 'abierta' and i.reason = a->>'motivo'
                and i.order_code is not distinct from a->'pedido'->>'codigo' and i.ordered_at is not distinct from nullif(a->'pedido'->>'momento', '')::timestamptz
                and i.supplier_invoice_id is not distinct from (select f.id from public.supplier_invoice f where f.batch_id = p_lote and f.invoice_number = a->>'factura' limit 1)) then
      continue;
    end if;
    insert into public.supplier_batch_issue (account_id, batch_id, supplier_invoice_id, reason, order_code, ordered_at, text, difference_cents)
    values (v_l.account_id, p_lote, (select f.id from public.supplier_invoice f where f.batch_id = p_lote and f.invoice_number = a->>'factura' limit 1),
            a->>'motivo', a->'pedido'->>'codigo', nullif(a->'pedido'->>'momento', '')::timestamptz, a->>'texto', nullif(a->>'diferencia', '')::int);
  end loop;

  -- Con qué venta casó cada pedido.
  update public.supplier_batch_order o set sale_id = null where o.batch_id = p_lote;
  for k, v in select * from jsonb_each(coalesce(p_cruce->'casados', '{}'::jsonb)) loop
    update public.supplier_batch_order o set sale_id = (v #>> '{}')::uuid
     where o.batch_id = p_lote and o.invoice_number || '|' || o.order_code || '|' || coalesce(to_char(o.ordered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '') = k;
  end loop;

  -- Cada factura en revisión: segura solo si el cruce la da por buena, no le queda nada
  -- abierto ni reclamado y ya era segura al leerla.
  for k, v in select * from jsonb_each(p_cruce->'facturas') loop
    select count(*) into v_abiertas from public.supplier_batch_issue i join public.supplier_invoice f on f.id = i.supplier_invoice_id
     where f.batch_id = p_lote and f.invoice_number = k and i.status <> 'aceptada';
    update public.supplier_invoice f
       set reading = jsonb_set(coalesce(f.reading, '{}'::jsonb), '{cruce}', jsonb_build_object('estado', v->>'estado', 'aclarar', v_abiertas, 'cruzada', now())),
           reading_confidence = case when v->>'estado' = 'seguro' and v_abiertas = 0 and f.reading->>'confianza' = 'seguro' then 'seguro' else 'duda' end,
           needs_review = not (v->>'estado' = 'seguro' and v_abiertas = 0 and f.reading->>'confianza' = 'seguro'),
           updated_at = now()
     where f.batch_id = p_lote and f.invoice_number = k and f.status = 'en_revision';
    if v->>'estado' = 'seguro' and v_abiertas = 0 then v_bien := v_bien + 1; else v_mal := v_mal + 1; end if;
  end loop;
  select count(*) into v_n from public.supplier_batch_issue where batch_id = p_lote and status = 'abierta';

  update public.supplier_batch set crossed_at = now(),
         cross_summary = jsonb_build_object('cuadran', v_bien, 'aclarar', v_mal, 'abiertas', v_n, 'totales', p_cruce->'totales', 'coste', coalesce(p_cruce->'coste', '[]'::jsonb), 'por', p_quien_nombre)
   where id = p_lote;
  return jsonb_build_object('cuadran', v_bien, 'aclarar', v_mal, 'abiertas', v_n,
    'texto', 'Cruzada la ' || v_l.label || ': ' || (v_bien + v_mal) || case when v_bien + v_mal = 1 then ' factura' else ' facturas' end || ', '
             || v_bien || case v_bien when 1 then ' cuadra' else ' cuadran' end
             || case when v_mal > 0 then ' y ' || v_mal || ' por aclarar' else '' end
             || case when v_n > 0 then ' (' || v_n || case v_n when 1 then ' cosa que mirar' else ' cosas que mirar' end || ')' else '' end || '.');
end $$;

-- conta_lote_relectura la leen los agentes (conta_lectura), si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.conta_lote_relectura to conta_lectura;
  end if;
end $$;
