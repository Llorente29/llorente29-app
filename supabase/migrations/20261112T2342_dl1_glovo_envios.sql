-- supabase/migrations/20261112T2342_dl1_glovo_envios.sql
--
-- DL1 · Las 12 ventas del día de Glovo de Carabanchel de octubre (Julio, DL1·20,
-- 12/11). Tienen 22 pedidos (06–18/10) repartidos por Glovo con su envío de
-- 4,50 € por aclarar. Julio (12/11, literal): «Los envíos los paga el cliente y
-- Glovo nos los abona.» Es la opción «lo_paga» de conta_envio_aclarar: lo paga
-- la plataforma (nos lo abona) y va a «Envíos cobrados». Se aclaran por el
-- camino de la aplicación, como Julio; la función quita el asiento propuesto de
-- cada día y el cierre del día lo vuelve a proponer, ya aclarado.
--
-- Dónde están en la liquidación: en «otros» de la tienda de Carabanchel
-- (905411): 18 pedidos del 06–14/10 (81,00) en la I170326000544676 (01–15/10,
-- otros 112,50) y 4 del 16–18/10 (18,00) en la I170326000578241 (16–31/10,
-- otros 34,50). Los 4 del 04–05/10 (18,00) están en asientos ya validados y no
-- se tocan aquí.
--
-- Validar los 12 días no es de esta tanda: un asiento de ventas de plataforma
-- se valida con su «Resumen de ventas», y ese PDF lo hace la pantalla al
-- validar (validarConPdf). Lo valida Julio desde Contabilidad.
--
-- SIN VUELTA ATRÁS, a propósito: lo aclarado se cambia volviéndolo a aclarar,
-- no deshaciéndolo.

create or replace function public._dl1_envio_aclarar(p_actor uuid, p_nombre text, p_sale uuid, p_decision text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_claims text := current_setting('request.jwt.claims', true); v_activa text := current_setting('folvy.cuenta_activa', true); v_r jsonb;
begin
  select account_id into v_acc from public.sale where id = p_sale;
  if v_acc is null then raise exception 'DL1 envío: ese pedido no está.'; end if;
  -- Como si lo aclarara la persona: su usuario y su cuenta activa, solo en esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', p_actor::text || ':' || v_acc::text, true);
  v_r := public.conta_envio_aclarar(p_sale, p_decision, p_motivo, p_nombre);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('folvy.cuenta_activa', coalesce(v_activa, ''), true);
  return v_r;
end $$;
revoke all on function public._dl1_envio_aclarar(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
comment on function public._dl1_envio_aclarar(uuid, text, uuid, text, text) is
  'DL1. Aclara el envío de un pedido con conta_envio_aclarar, como una persona de la cuenta. Solo una tanda.';

-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_car constant uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';
  r record; v_n int := 0; v_suma numeric := 0;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 envíos: sin la cuenta de Foodint, no hay nada que aclarar.';
    return;
  end if;
  create temp table dl1_envios on commit drop as
    select s.id, (s.sold_at at time zone 'Europe/Madrid')::date dia, s.service_type, c.envio
      from public.sales_day_summary d
      join public.journal_entry e on e.id = d.entry_id and e.account_id = d.account_id
      cross join lateral unnest(d.sale_ids) x(sid)
      join public.sale s on s.id = x.sid and s.account_id = d.account_id
      cross join lateral public.conta_cargos_de_pedidos(d.account_id, array[s.id]) c
     where e.company_id = v_e and e.account_id = v_acc and e.status = 'propuesto' and e.source_type = 'sales_day'
       and e.entry_date between date '2026-10-01' and date '2026-10-31' and d.location_id = v_car and c.clase = 'por_aclarar';
  if (select count(*) from dl1_envios) <> 22 or (select sum(envio) from dl1_envios) <> 99.00
     or exists (select 1 from dl1_envios where service_type <> 'platform_delivery' or envio <> 4.50) then
    raise exception 'DL1 envíos: los envíos por aclarar no son los 22 de 4,50 de Glovo que se midieron: no se aclara nada.';
  end if;
  for r in select * from dl1_envios order by dia, id loop
    perform public._dl1_envio_aclarar(v_julio, 'Julio', r.id, 'lo_paga',
      'Julio (12/11): el envío lo paga el cliente y Glovo nos lo abona. Va en «otros» de la liquidación '
      || case when r.dia <= date '2026-10-15' then 'I170326000544676 (01–15/10)' else 'I170326000578241 (16–31/10)' end || '.');
    v_n := v_n + 1; v_suma := v_suma + r.envio;
  end loop;
  if exists (select 1 from public.journal_entry e where e.company_id = v_e and e.status = 'propuesto' and e.source_type = 'sales_day'
              and e.entry_date between date '2026-10-01' and date '2026-10-31') then
    raise exception 'DL1 envíos: después de aclarar quedan ventas del día de octubre propuestas sin quitar.';
  end if;
  raise notice 'DL1 envíos: % envíos aclarados como Julio (lo paga Glovo), %; el cierre del día vuelve a proponer sus días.', v_n, v_suma;
end $$;
