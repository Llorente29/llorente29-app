-- supabase/vuelta-atras/20261204T0480_e05_releer_riders.down.sql
--
-- Vuelta atrás de 20261204T0480_e05_releer_riders, en orden inverso:
--   5. conta_lote_pedidos_app y conta_lote_cruce_guardar, las de antes, byte a
--      byte (md5 7586a749… y 79a57d0b…);
--   4–2. fuera las funciones de pedir, lanzar, empezar, guardar y apuntar;
--   1. fuera conta_lote_relectura.
-- PARA, sin tocar nada, si ya se ha hecho alguna relectura: su fila diría qué
-- se releyó y quién lo pidió. Las lecturas ya guardadas en las facturas se
-- quedan (son su lectura, como la de subir).

do $$
declare n bigint;
begin
  if to_regclass('public.conta_lote_relectura') is not null then
    execute 'select count(*) from public.conta_lote_relectura' into n;
    if n > 0 then
      raise exception 'E05 0480 vuelta atrás: hay % relecturas apuntadas (conta_lote_relectura) y se perdería quién las pidió y qué salió. No se toca nada.', n;
    end if;
  end if;
end $$;

-- 5 · las de producción del 22/10, tal cual.
create or replace function public.conta_lote_pedidos_app(p_lote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_l public.supplier_batch;
begin
  select * into v_l from public.supplier_batch where id = p_lote;
  if v_l.id is null or not public.belongs_to_account(v_l.account_id) then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
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
  if v_l.id is null or not public.belongs_to_account(v_l.account_id) then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_l.account_id) then
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

-- 4–2
drop function if exists public.conta_lote_relectura_empezar(uuid);
drop function if exists public.conta_lote_relectura_hecha(uuid, jsonb, text);
drop function if exists public.conta_lote_relectura_guardar(uuid, jsonb);
drop function if exists public.conta_lote_releer_lanzar(uuid, text);
drop function if exists public.conta_lote_releer_pedir(uuid, text);

-- 1
drop table if exists public.conta_lote_relectura;
