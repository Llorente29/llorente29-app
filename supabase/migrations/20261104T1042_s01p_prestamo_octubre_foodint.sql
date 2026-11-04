-- supabase/migrations/20261104T1042_s01p_prestamo_octubre_foodint.sql
--
-- S01p · 1 · DATOS de Foodint: la cuota de octubre en el cuadro del préstamo
-- BBVA 0830149268 (contrato 80cc1993-…). El cuadro empezaba en la cuota del
-- 03/11, y «Cerrar el mes» habría dicho que en octubre no había cuota. La hubo:
-- BBVA la cargó el lunes 05/10 (el 03/10 fue sábado), 674,36 €.
--
-- La fila sale del propio cuadro, sin redondeos dudosos. Medido en producción el
-- 04/11 (solo lectura): las 57 cuotas del cuadro cumplen intereses =
-- redondeo(capital pendiente antes de la cuota × 3,90 % / 12) al céntimo, sin
-- ninguna excepción. Antes de la del 03/11 quedaban 35.036,59 €, así que la de
-- octubre es:
--   pendiente antes: 35.036,59 + capital  ·  intereses = 3,90 %/12 de eso
--   35.595,27 × 0,00325 = 115,68 €  ·  capital 674,36 − 115,68 = 558,68 €
--   35.036,59 + 558,68 = 35.595,27 € (cuadra con la línea de arriba).
--
-- Se guarda igual que lo guardaría bank_contrato_guardar: lo prestado pasa a
-- ser la suma del capital del cuadro (35.595,27), 58 cuotas, y el pendiente de
-- cada fila se rehace con conta_cuadro_con_pendiente. La cuota del 03/11 sigue
-- dejando 34.476,10.
--
-- Lo que NO hace: el asiento del 05/10 apuntó los 674,36 € a la 52000001 sin
-- separar los intereses (115,68 € que faltan en la 662). Eso es un asiento
-- validado y se corrige en Bancos (deshacer y casar con la cuota), no aquí.
--
-- Anclada por cuenta, empresa y contrato (regla 9). En otra base (staging) no
-- encuentra el contrato y no hace nada. Se puede pasar dos veces.
-- Mueve una fila que existe: va con «autorizo».

create table if not exists public.conta_s01p_prestamo_antes (
  id uuid primary key,
  account_id uuid not null,
  schedule jsonb,
  principal numeric,
  installments int,
  guardado_at timestamptz not null default now()
);
comment on table public.conta_s01p_prestamo_antes is
  'S01p · 1042 · El cuadro del préstamo de Foodint antes de añadirle la cuota de octubre, para su vuelta atrás.';
alter table public.conta_s01p_prestamo_antes enable row level security;
revoke all on public.conta_s01p_prestamo_antes from public, anon, authenticated;

do $$
declare
  v_cuenta   constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa  constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_contrato constant uuid := '80cc1993-7429-404f-b2dc-97337364c7eb';
  v_oct constant jsonb := '{"fecha": "2026-10-03", "cuota": 674.36, "capital": 558.68, "intereses": 115.68}';
  c public.recurring_contract;
  v_cuadro jsonb; v_primera jsonb;
begin
  select * into c from public.recurring_contract
   where id = v_contrato and account_id = v_cuenta and company_id = v_empresa and kind = 'prestamo';
  if c.id is null then
    raise notice 'S01p·1042: no está el préstamo de Foodint en esta base: no se hace nada.';
    return;
  end if;
  if exists (select 1 from jsonb_array_elements(c.schedule) f where (f->>'fecha')::date = date '2026-10-03') then
    raise notice 'S01p·1042: el cuadro ya tiene la cuota de octubre: no se hace nada.';
    return;
  end if;

  -- Lo que se midió el 04/11: si ha cambiado algo, no se toca.
  select f into v_primera from jsonb_array_elements(c.schedule) f order by (f->>'fecha')::date limit 1;
  if round(c.principal, 2) <> 35036.59 or c.installments <> 57 or jsonb_array_length(c.schedule) <> 57
     or (v_primera->>'fecha')::date <> date '2026-11-03' or (v_primera->>'capital')::numeric <> 560.49
     or (v_primera->>'intereses')::numeric <> 113.87 or (v_primera->>'pendiente')::numeric <> 34476.10 then
    raise exception 'S01p·1042: el préstamo ya no es como se midió el 04/11 (lo prestado %, % cuotas, la primera del %): no se toca.',
      c.principal, c.installments, v_primera->>'fecha';
  end if;
  if round(35595.27 * 0.039 / 12, 2) <> (v_oct->>'intereses')::numeric
     or (v_oct->>'capital')::numeric + (v_oct->>'intereses')::numeric <> (v_oct->>'cuota')::numeric then
    raise exception 'S01p·1042: la cuota de octubre no cuadra consigo misma: no se toca.';
  end if;

  insert into public.conta_s01p_prestamo_antes (id, account_id, schedule, principal, installments)
  values (c.id, c.account_id, c.schedule, c.principal, c.installments)
  on conflict (id) do nothing;

  v_cuadro := public.conta_cuadro_con_pendiente(
    (select jsonb_agg(f order by (f->>'fecha')::date) from (
       select v_oct f
       union all
       select f - 'pendiente' from jsonb_array_elements(c.schedule) f) z),
    35595.27);

  if (v_cuadro->0->>'pendiente')::numeric <> 35036.59 or (v_cuadro->1->>'pendiente')::numeric <> 34476.10 then
    raise exception 'S01p·1042: con la cuota de octubre, lo pendiente no sale como antes (% y %): no se toca.',
      v_cuadro->0->>'pendiente', v_cuadro->1->>'pendiente';
  end if;

  update public.recurring_contract
     set schedule = v_cuadro, principal = 35595.27, installments = 58
   where id = c.id and account_id = v_cuenta;
  raise notice 'S01p·1042: el préstamo, con la cuota del 03/10 (558,68 de capital y 115,68 de intereses): 58 cuotas, 35.595,27 prestados.';
end $$;
