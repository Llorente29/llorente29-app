-- supabase/migrations/20261201T0450_c07_diez_todo.sql
-- cambia: public.conta_resumen_ventas · prueba: supabase/staging/sql/20261201_c07_diez_todo_prueba.sql
-- cambia: public.conta_recibida_envio · prueba: supabase/staging/sql/20261201_c07_diez_todo_prueba.sql
-- cambia: public.external_send · prueba: supabase/staging/sql/20261201_c07_diez_todo_prueba.sql
-- cambia: public.conta_diez_autorizo · prueba: supabase/staging/sql/20261201_c07_diez_todo_prueba.sql
--
-- C07 · TODO ASIENTO DE SUMIED VA A DIEZ AL MOMENTO (decisión de Julio, 22/10).
-- Provisional: sirve para comprobar durante poco tiempo que Sumied es fiable.
--
-- Hoy solo salen las ventas, y solo porque el Libro llama a conta-diez-enviar
-- al validar. Con esto:
--
--   1. «Enviar a Diez», un interruptor por empresa (conta_diez_envio_empresa).
--      Apagado (lo de siempre, sin fila): no se envía nada y las pantallas no
--      hablan de Diez. Encendido: todo lo validado desde «desde» sale solo.
--      Lo cambia un administrador con conta_diez_envio_poner, que dice qué ha
--      hecho y cuántos asientos salen ahora (regla 8).
--   2. Nada se pierde en silencio: lo validado de una empresa encendida que no
--      está en Diez lo recoge el servidor (conta_diez_reclamar → la función
--      conta-diez-cola), aunque nadie tenga la pantalla abierta. Si un envío
--      falla, el asiento sigue validado, el motivo queda en external_send y,
--      si se puede reintentar, external_send.next_try_at dice cuándo.
--      Un minuto de cron (conta-diez-despertar) solo llama a la función cuando
--      hay algo que mandar. Solo en producción: necesita el cron_secret del
--      Vault, que staging no tiene.
--   3. Anular en Sumied ya hace el contraasiento (journal_entry_anular); el
--      contraasiento es un asiento validado más y sale igual, solo si lo
--      anulado llegó a Diez. En Diez se anula así (medido en la C0009: 112
--      contraasientos con el debe y el haber cambiados, 0 en negativo).
--   4. El banco, los manuales y las liquidaciones van como asiento general
--      (external_send.kind = 'asiento', que ya existía), leídos con
--      conta_asiento_envio. Escribirlos en una base real sigue cerrado hasta
--      que Julio lo autorice: conta_diez_autorizo.incluye_asientos (por
--      defecto, no), como incluye_recibidas en la 0740.
--   5. Para que el servidor pueda leer las ventas y las recibidas sin la sesión
--      de nadie, conta_resumen_ventas y conta_recibida_envio admiten también la
--      clave de servicio (auth.role() = 'service_role'). Nada más cambia en
--      ellas: el cuerpo es el de producción (md5 62ba30b9… y e3c57e29…,
--      medidos el 22/10), con esa condición. La vuelta atrás los devuelve byte
--      a byte.
--
-- Solo añade, salvo esas dos funciones (misma firma) y dos columnas que
-- admiten nulos o llevan valor por defecto. Nada del camino del pedido:
-- journal_entry, external_send y las funciones de Diez no las toca ningún
-- pedido. No toca coste ni stock (regla 10: sin sus cuatro caminos).

-- 1. El interruptor ----------------------------------------------------------------
create table if not exists public.conta_diez_envio_empresa (
  company_id uuid primary key references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  enviar boolean not null default false,
  desde date not null default current_date,
  cambiado_por uuid,
  cambiado_por_nombre text,
  cambiado_en timestamptz not null default now()
);
comment on table public.conta_diez_envio_empresa is
  'C07 · «Enviar a Diez», por empresa. Sin fila o con enviar = false, no se envía nada a Diez y las pantallas no hablan de Diez. Encendido, todo asiento validado con fecha desde «desde» sale solo. Se cambia con conta_diez_envio_poner.';
alter table public.conta_diez_envio_empresa enable row level security;
revoke all on table public.conta_diez_envio_empresa from public, anon, authenticated;
grant select on table public.conta_diez_envio_empresa to authenticated;
drop policy if exists conta_diez_envio_empresa_leer on public.conta_diez_envio_empresa;
create policy conta_diez_envio_empresa_leer on public.conta_diez_envio_empresa
  for select to authenticated using (public.belongs_to_account(account_id));

-- 2. Cuándo se vuelve a intentar --------------------------------------------------
alter table public.external_send add column if not exists next_try_at timestamptz;
comment on column public.external_send.next_try_at is
  'C07 · Cuándo lo vuelve a intentar el servidor (conta-diez-cola). Null: no se reintenta solo (ya está en Diez, o lo tiene que mirar una persona: «Reintentar»).';

-- 3. Lo que Julio autoriza: también los asientos generales --------------------------
alter table public.conta_diez_autorizo add column if not exists incluye_asientos boolean not null default false;
comment on column public.conta_diez_autorizo.incluye_asientos is
  'C07 · ¿Abre también los asientos generales (banco, manuales, liquidaciones…) en esa base real? Por defecto, no: el primero lo autoriza Julio por asiento y lo mira en Diez antes de abrir la empresa.';

-- 4. Leer sin la sesión de nadie (el servidor) -------------------------------------
create or replace function public.conta_resumen_ventas(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_d public.sales_day_summary;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not (public.belongs_to_account(v_e.account_id) or auth.role() = 'service_role') then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  select * into v_d from public.sales_day_summary
   where entry_id = v_e.id and account_id = v_e.account_id and company_id = v_e.company_id;
  if v_d.id is null or v_d.channel_id is null then
    raise exception 'Ese asiento no es de las ventas de una plataforma: no lleva resumen de ventas.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id,
    'estado', v_e.status, 'serie', v_e.series, 'numero', v_e.number,
    'fecha', v_d.sales_day, 'validado_en', v_e.validated_at,
    'empresa', (select jsonb_build_object('nombre', c.legal_name, 'nif', c.tax_id)
                  from public.company c where c.id = v_e.company_id and c.account_id = v_e.account_id),
    'local', (select jsonb_build_object('id', l.id, 'nombre', l.name)
                from public.locations l where l.id = v_d.location_id and l.account_id = v_e.account_id),
    'canal', (select jsonb_build_object('id', ch.id, 'slug', ch.slug, 'nombre', ch.name)
                from public.sales_channel ch where ch.id = v_d.channel_id and ch.account_id = v_e.account_id),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'hora', to_char(s.sold_at at time zone 'Europe/Madrid', 'HH24:MI'),
               'codigo', coalesce(s.platform_order_code, left(s.id::text, 8)),
               'marca', b.name, 'total', s.total, 'base', s.taxable_base, 'cuota', s.tax,
               -- C06b (16/10): el descuento y el envío, y qué se hizo con el envío (conta_cargos_de_pedidos).
               'descuento', coalesce(c.descuento, 0), 'envio', coalesce(c.envio, 0), 'clase', coalesce(c.clase, 'ninguno')) order by s.sold_at, s.id)
        from public.sale s left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
        left join public.conta_cargos_de_pedidos(v_e.account_id, v_d.sale_ids) c on c.id = s.id
       where s.id = any (v_d.sale_ids) and s.account_id = v_e.account_id), '[]'::jsonb),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cuenta', a.code, 'debe', l.debit, 'haber', l.credit, 'marca', b.name,
               'tipoIva', t.rate, 'documento', l.document_ref,
               -- C06b (16/10): si la línea es la de promociones o la de envíos de su plataforma.
               'papel', (select v.papel from public.conta_ventas_canal_cuenta v
                          where v.company_id = v_e.company_id and v.channel_id = v_d.channel_id and v.company_account_id = a.id)) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.brand b on b.id = l.brand_id and b.account_id = v_e.account_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id and l.account_id = v_e.account_id), '[]'::jsonb),
    'documento', (
      select jsonb_build_object('id', x.id, 'ruta', x.storage_path, 'nombre', x.file_name, 'sha256', x.sha256,
                                'bytes', x.size_bytes, 'creado_en', x.created_at, 'creado_por', x.created_by_name)
        from public.journal_entry_document x
       where x.entry_id = v_e.id and x.account_id = v_e.account_id and x.kind = 'resumen_ventas'));
end $$;

create or replace function public.conta_recibida_envio(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_i public.supplier_invoice;
  v_s public.supplier;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not (public.belongs_to_account(v_e.account_id) or auth.role() = 'service_role') then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if v_e.source_type <> 'supplier_invoice' then
    raise exception 'Ese asiento no es de una factura recibida.' using errcode = '22023';
  end if;
  select * into v_i from public.supplier_invoice where id = v_e.source_id and account_id = v_e.account_id;
  if v_i.id is null then raise exception 'La factura de ese asiento no está.' using errcode = 'P0002'; end if;
  if v_i.source = 'liquidacion' and nullif(btrim(v_i.invoice_number), '') is null then
    raise exception 'La factura de comisión no tiene número: no va a Diez hasta tenerlo.' using errcode = '22023';
  end if;
  select * into v_s from public.supplier where id = v_i.supplier_id and account_id = v_e.account_id;

  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id, 'estado', v_e.status, 'fecha', v_e.entry_date,
    'factura', jsonb_build_object('numero', v_i.invoice_number, 'fecha', coalesce(v_i.invoice_date, v_e.document_date, v_e.entry_date)),
    -- E05: si la factura lleva su emisor (los riders y flotas de Catcher, en el
    -- proveedor genérico «Riders»), es el emisor el que va a Diez.
    'proveedor', jsonb_build_object('nombre', coalesce(nullif(trim(v_i.issuer_name), ''), nullif(trim(v_s.legal_name), ''), v_s.name),
                                    'nif', coalesce(nullif(trim(v_i.issuer_tax_id), ''), nullif(trim(v_s.tax_id), '')),
                                    -- I01f: su país (de la ficha; sin él, España), para saber si su
                                    -- inversión del sujeto pasivo es de fuera de la UE o nacional.
                                    'pais', coalesce(nullif(upper(btrim(v_s.country_code)), ''), 'ES')),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('cuenta', a.code, 'debe', l.debit, 'haber', l.credit,
                                          'tipoIva', t.rate, 'baseIva', l.tax_base,
                                          -- I01f: cómo va el IVA de la línea (taxed, intra_eu, reverse_charge…).
                                          'tratamiento', t.treatment) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id), '[]'::jsonb),
    'documento', (select jsonb_build_object('id', d.id, 'ruta', d.storage_path, 'nombre', d.file_name, 'sha256', d.sha256)
                    from public.journal_entry_document d where d.entry_id = v_e.id and d.kind = 'factura_recibida'));
end $$;

-- 5. Un asiento cualquiera, como lo lee el envío ----------------------------------
create or replace function public.conta_asiento_envio(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_o text;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not (public.belongs_to_account(v_e.account_id) or auth.role() = 'service_role') then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if v_e.reverses_entry_id is not null then
    select o.source_type into v_o from public.journal_entry o where o.id = v_e.reverses_entry_id and o.account_id = v_e.account_id;
  end if;
  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id,
    'estado', v_e.status, 'origen', v_e.source_type, 'serie', v_e.series, 'numero', v_e.number,
    'fecha', v_e.entry_date, 'concepto', v_e.concept, 'anula', v_e.reverses_entry_id, 'anulaOrigen', v_o,
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('cuenta', a.code, 'debe', l.debit, 'haber', l.credit, 'concepto', l.concept) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
       where l.entry_id = v_e.id and l.account_id = v_e.account_id), '[]'::jsonb));
end $$;
comment on function public.conta_asiento_envio(uuid) is
  'C07 · Lo que el envío a Diez lee de un asiento que va como asiento general (banco, manual, liquidación…) o de su contraasiento: cabecera, origen, lo que anula y sus líneas con la cuenta. Para los de la cuenta, o el servidor.';
revoke all on function public.conta_asiento_envio(uuid) from public, anon;
grant execute on function public.conta_asiento_envio(uuid) to authenticated, service_role;

-- 6. Lo que falta por mandar -------------------------------------------------------
-- De las empresas encendidas, lo validado desde «desde» que no está en Diez:
--   · sin envío, validado hace más de 2 minutos (si lo valida una pantalla, la
--     pantalla lo manda al momento; esto es lo que se queda atrás);
--   · o con un envío pendiente cuyo reintento ya toca (next_try_at), con menos
--     de 3 intentos y quieto hace más de 2 minutos (no uno en marcha).
-- Un contraasiento, solo si lo que anula está en Diez. Lo traído de Diez, la
-- apertura, el cierre y las plantillas no van nunca.
create or replace function public.conta_diez_por_enviar(p_limite integer default 10)
returns table (entry_id uuid, account_id uuid, company_id uuid, origen text, kind text, tiene_envio boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.account_id, e.company_id, e.source_type,
         case when e.source_type in ('sales_day', 'supplier_invoice') or o.source_type in ('sales_day', 'supplier_invoice') then 'factura' else 'asiento' end,
         s.id is not null
    from public.journal_entry e
    join public.conta_diez_envio_empresa z on z.company_id = e.company_id and z.account_id = e.account_id and z.enviar
    left join public.journal_entry o on o.id = e.reverses_entry_id and o.account_id = e.account_id
    left join public.external_send s on s.entry_id = e.id and s.account_id = e.account_id and s.status <> 'rechazado'
   where e.status = 'validado'
     and e.entry_date >= z.desde
     and e.source_type not in ('migrated', 'opening', 'closing', 'template')
     and (e.reverses_entry_id is null or exists (
           select 1 from public.external_send x
            where x.entry_id = e.reverses_entry_id and x.account_id = e.account_id and x.status in ('enviado', 'enlazado')))
     and (
           (s.id is null and e.validated_at < now() - interval '2 minutes')
        or (s.status = 'pendiente' and s.next_try_at is not null and s.next_try_at <= now() and s.attempts < 3 and s.updated_at < now() - interval '2 minutes')
     )
   order by e.validated_at, e.id
   limit greatest(1, least(coalesce(p_limite, 10), 50))
$$;
comment on function public.conta_diez_por_enviar(integer) is
  'C07 · Lo validado de las empresas con «Enviar a Diez» encendido que no está en Diez y le toca salir ahora (ver la migración 0450). Solo el servidor.';
revoke all on function public.conta_diez_por_enviar(integer) from public, anon, authenticated;
grant execute on function public.conta_diez_por_enviar(integer) to service_role;

-- 7. Cogerlo para mandarlo (sin que lo coja otra pasada) ---------------------------
-- Deja a cada uno su fila de envío con next_try_at a 10 minutos: si la pasada se
-- corta, se vuelve a coger entonces; si acaba, la función pone el bueno.
create or replace function public.conta_diez_reclamar(p_limite integer default 10)
returns table (entry_id uuid, account_id uuid, company_id uuid, origen text)
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('conta_diez_reclamar'));
  create temp table if not exists _c07_reclamo (entry_id uuid, account_id uuid, company_id uuid, origen text, kind text, tiene_envio boolean) on commit drop;
  truncate _c07_reclamo;
  insert into _c07_reclamo select * from public.conta_diez_por_enviar(p_limite);
  insert into public.external_send (entry_id, account_id, company_id, kind, payload_hash, status, attempts, next_try_at, updated_at)
  select r.entry_id, r.account_id, r.company_id, r.kind, 'sin-enviar', 'pendiente', 0, now() + interval '10 minutes', now()
    from _c07_reclamo r where not r.tiene_envio
  on conflict do nothing;
  update public.external_send s set next_try_at = now() + interval '10 minutes', updated_at = now()
    from _c07_reclamo r
   where r.tiene_envio and s.entry_id = r.entry_id and s.account_id = r.account_id and s.status = 'pendiente';
  return query select r.entry_id, r.account_id, r.company_id, r.origen from _c07_reclamo r;
end $$;
comment on function public.conta_diez_reclamar(integer) is
  'C07 · Coge lo que le toca salir a Diez (conta_diez_por_enviar) y lo aparta 10 minutos para que no lo coja otra pasada. Solo el servidor (conta-diez-cola).';
revoke all on function public.conta_diez_reclamar(integer) from public, anon, authenticated;
grant execute on function public.conta_diez_reclamar(integer) to service_role;

-- 8. El interruptor, con lo que ha hecho -----------------------------------------
create or replace function public.conta_diez_envio_poner(p_company uuid, p_enviar boolean, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c public.company;
  v_z public.conta_diez_envio_empresa;
  v_quien text;
  v_salen integer;
  v_desde date;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta enciende o apaga el envío a Diez.' using errcode = '42501';
  end if;
  if p_enviar is null then raise exception 'Hay que decir si se enciende o se apaga.' using errcode = '22023'; end if;
  if p_enviar and not exists (
    select 1 from public.account_connector ac join public.connector k on k.id = ac.connector_id
     where ac.account_id = v_c.account_id and ac.company_id = v_c.id and ac.scope = 'company' and k.code = 'diez' and ac.status = 'connected') then
    raise exception 'Esta empresa no está conectada con Diez: primero, la conexión.' using errcode = '23514';
  end if;
  v_quien := nullif(trim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
  select * into v_z from public.conta_diez_envio_empresa where company_id = v_c.id for update;
  if v_z.company_id is null then
    insert into public.conta_diez_envio_empresa (company_id, account_id, enviar, desde, cambiado_por, cambiado_por_nombre)
    -- «desde»: el día después del corte con el programa anterior (lo que asienta
    -- Sumied), para que no se quede fuera nada validado antes de encender
    -- (EUROPASTRY 24048027, validada desde el libro el 16/10, nunca salió). Sin
    -- corte, hoy.
    values (v_c.id, v_c.account_id, p_enviar,
            coalesce((select max(f.imported_until) + 1 from public.fiscal_year f
                       where f.company_id = v_c.id and f.account_id = v_c.account_id), current_date),
            auth.uid(), v_quien)
    returning * into v_z;
  elsif v_z.enviar is distinct from p_enviar then
    update public.conta_diez_envio_empresa
       set enviar = p_enviar, cambiado_por = auth.uid(), cambiado_por_nombre = v_quien, cambiado_en = now()
     where company_id = v_c.id
    returning * into v_z;
  end if;
  v_desde := v_z.desde;
  -- Lo validado desde «desde» que no está en Diez: lo que sale ahora (o lo que se queda sin salir).
  select count(*) into v_salen
    from public.journal_entry e
   where e.company_id = v_c.id and e.account_id = v_c.account_id and e.status = 'validado' and e.entry_date >= v_desde
     and e.source_type not in ('migrated', 'opening', 'closing', 'template')
     and not exists (select 1 from public.external_send s where s.entry_id = e.id and s.account_id = e.account_id and s.status in ('enviado', 'enlazado'));
  return jsonb_build_object('enviar', v_z.enviar, 'desde', v_desde, 'sin_enviar', v_salen,
    'texto', case when v_z.enviar
      then format('Encendido: todo lo que se valide sale solo a Diez. %s', case v_salen when 0 then 'No hay nada validado pendiente.' when 1 then '1 asiento validado desde el ' || to_char(v_desde, 'DD/MM/YYYY') || ' sale ahora.' else v_salen || ' asientos validados desde el ' || to_char(v_desde, 'DD/MM/YYYY') || ' salen ahora.' end)
      else format('Apagado: no se envía nada a Diez.%s', case when v_salen > 0 then format(' %s %s sin enviar se quedan aquí, validados.', v_salen, case v_salen when 1 then 'asiento' else 'asientos' end) else '' end) end);
end $$;
comment on function public.conta_diez_envio_poner(uuid, boolean, text) is
  'C07 · Enciende o apaga «Enviar a Diez» en una empresa. Solo un administrador; para encender, la empresa tiene que estar conectada con Diez. La primera vez, «desde» es el día después del corte con el programa anterior (sin corte, hoy). Devuelve qué ha hecho y cuántos asientos validados quedan sin enviar.';
revoke all on function public.conta_diez_envio_poner(uuid, boolean, text) from public, anon;
grant execute on function public.conta_diez_envio_poner(uuid, boolean, text) to authenticated;

-- 9. Despertar al servidor cuando hay algo que mandar -----------------------------
create or replace function public.conta_diez_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_secreto text;
begin
  if not exists (select 1 from public.conta_diez_por_enviar(1)) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-diez-cola.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-diez-cola',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $$;
comment on function public.conta_diez_despertar() is
  'C07 · Cada minuto (cron conta-diez-despertar, solo en producción): si hay algo que mandar a Diez, llama a conta-diez-cola. Si falta el secreto, falla (cron lo apunta como failed), no calla.';
revoke all on function public.conta_diez_despertar() from public, anon, authenticated;

-- Solo donde está el secreto de los vigías (producción); en staging se llama a la función a mano.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from vault.secrets where name = 'cron_secret') then
    if exists (select 1 from cron.job where jobname = 'conta-diez-despertar') then
      perform cron.unschedule('conta-diez-despertar');
    end if;
    perform cron.schedule('conta-diez-despertar', '* * * * *', $cron$select public.conta_diez_despertar()$cron$);
  end if;
end $$;

-- conta_lectura (los agentes) lee el interruptor, si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.conta_diez_envio_empresa to conta_lectura;
  end if;
end $$;
