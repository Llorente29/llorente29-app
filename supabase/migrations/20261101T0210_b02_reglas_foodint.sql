-- ============================================================================
-- B02 · LAS REGLAS DE FOODINT, CORREGIDAS (tanda T3; Julio, 15/10).
-- ----------------------------------------------------------------------------
-- Por su id (los textos no hacen falta: la regla se reescribe con el suyo):
--   · f2afd853… («UBER ONE»: suscripción mensual) → 62900000 Otros servicios, encendida.
--   · a094fd3a… («SHELL BARAJAS»: gasolina)       → 62800000 Suministros, encendida.
--   · 11f54405… (recargas de saldo prepago)        → 40700001 Saldo prepago, encendida,
--     y su condición pasa de «CATCHER DISCO» a «CATCHER», sin importe: en el
--     extracto «DISCOS» va en el tipo y «CATCHER» en la contraparte, así que la
--     de antes no casaba ninguno de los 13 pagos (los pagos con tarjeta a
--     Catcher son recargas: Julio, 15/10).
--   · 103ccdd6… («LIQ OP TRANSFEREN»: lo usan varias plataformas) → se queda apagada.
-- Encendidas proponen; ninguna casa sola (confirmaciones a 0). Medido el 15/10
-- en solo lectura: las cuatro apagadas, sin confirmaciones, y 0 casados por
-- regla en toda la base.
--
-- ANTES DE ESCRIBIR NADA, PARA si: la empresa de esas reglas no tiene la
-- 40700001 (la crea la tanda de A, que va antes), alguna regla no está como se
-- midió, o alguna ha casado algo. Lo de antes de cada una queda en su registro
-- (bank_rule_log, «Tanda B02 · 0210»), y de ahí lo devuelve la vuelta atrás.
-- Vuelta atrás: supabase/vuelta-atras/20261101T0210_b02_reglas_foodint.down.sql
-- ============================================================================

create temp table _b02_reglas (id uuid primary key, cuenta_antes text, estado_antes text, cuenta text, estado text, contiene_antes text, contiene text) on commit drop;
insert into _b02_reglas values
  ('f2afd853-b93a-43b8-bc1c-fdd5136a0c13', '60000001', 'apagada', '62900000', 'activa',  null, null),
  ('a094fd3a-c8e5-4209-a989-52ecb3c862a3', '62400000', 'apagada', '62800000', 'activa',  null, null),
  ('11f54405-a466-455d-be9c-6583d9ae58be', '40700000', 'apagada', '40700001', 'activa',  'CATCHER DISCO', 'CATCHER'),
  ('103ccdd6-ce74-4464-ab6a-645e43dff288', '43000002', 'apagada', '43000002', 'apagada', null, null);

do $$
declare n int; v_empresa uuid; f record;
begin
  select count(distinct r.company_id), min(r.company_id::text)::uuid into n, v_empresa from public.bank_rule r join _b02_reglas x on x.id = r.id;
  if (select count(*) from public.bank_rule r join _b02_reglas x on x.id = r.id) <> 4 or n <> 1 then
    raise exception 'B02 · 0210: no están las cuatro reglas, o no son de la misma empresa.';
  end if;
  for f in select x.*, r.status, r.target->>'cuenta' ahora, r.condition->>'contiene' contiene_ahora from _b02_reglas x join public.bank_rule r on r.id = x.id loop
    if f.status <> f.estado_antes or f.ahora <> f.cuenta_antes or (f.contiene_antes is not null and f.contiene_ahora is distinct from f.contiene_antes) then
      raise exception 'B02 · 0210: la regla % está «%» → % y se midió «%» → %: ha cambiado, vuelve a medir.', left(f.id::text, 8), f.status, f.ahora, f.estado_antes, f.cuenta_antes;
    end if;
  end loop;
  if exists (select 1 from public.bank_match b join _b02_reglas x on x.id = b.rule_id) then
    raise exception 'B02 · 0210: alguna de las reglas ya ha casado algo: no se corrige por tanda.';
  end if;
  select count(*) into n from _b02_reglas x where not exists (select 1 from public.company_account ca where ca.company_id = v_empresa and ca.code = x.cuenta);
  if n > 0 then
    raise exception 'B02 · 0210: la empresa no tiene % de las cuentas de destino (la 40700001 la crea la tanda de A, que va antes): PARO.', n;
  end if;
end $$;

-- Lo de antes, al registro de cada regla (de ahí lo devuelve la vuelta atrás).
insert into public.bank_rule_log (account_id, rule_id, action, before, after, created_by, created_by_name)
select r.account_id, r.id, case when x.estado = 'activa' and r.status = 'apagada' then 'encendida' else 'cambiada' end,
       jsonb_build_object('palabras', r.words, 'condicion', r.condition, 'destino', r.target, 'estado', r.status, 'confirmaciones', r.confirmations, 'correcciones', r.corrections),
       jsonb_build_object('destino', jsonb_build_object('cuenta', x.cuenta), 'estado', x.estado)
         || case when x.contiene is not null then jsonb_build_object('condicion', jsonb_build_object('contiene', x.contiene)) else '{}'::jsonb end,
       null, 'Tanda B02 · 0210'
  from public.bank_rule r join _b02_reglas x on x.id = r.id
 where r.target->>'cuenta' <> x.cuenta or r.status <> x.estado;

update public.bank_rule r
   set target = jsonb_build_object('cuenta', x.cuenta), status = x.estado, confirmations = 0, corrections = 0, updated_at = now(),
       condition = case when x.contiene is not null then jsonb_build_object('contiene', x.contiene) else r.condition end,
       words = 'Cuando el concepto tenga «' || coalesce(x.contiene, r.condition->>'contiene') || '» → '
               || coalesce((select coalesce(ca.plain_name, ca.name) from public.company_account ca where ca.company_id = r.company_id and ca.code = x.cuenta), x.cuenta)
               || ' · ' || x.cuenta
  from _b02_reglas x
 where x.id = r.id and (r.target->>'cuenta' <> x.cuenta or r.status <> x.estado);

do $$
begin
  if exists (select 1 from public.bank_rule r join _b02_reglas x on x.id = r.id
              where r.target->>'cuenta' <> x.cuenta or r.status <> x.estado or (x.contiene is not null and r.condition is distinct from jsonb_build_object('contiene', x.contiene))) then
    raise exception 'B02 · 0210: alguna regla no ha quedado como tenía que quedar.';
  end if;
  raise notice 'B02 · 0210: tres reglas corregidas y encendidas (proponen, no casan solas), la de las recargas con «CATCHER»; «LIQ OP TRANSFEREN», apagada.';
end $$;
