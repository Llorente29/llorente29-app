-- supabase/staging/sql/20261127_q10j_tarjeta_decidida_prueba.sql
--
-- SOLO STAGING. La 0905 del Q10 · respuesta 8 (los 5 pagos con tarjeta de QBO, decididos), con ROLLBACK:
--   1. Dos veces: sin la empresa de QBO, no decide nada.
--   2. Su vuelta atrás no toca una decisión que no es suya (una inventada de la cuenta A), y deja todo como estaba.
-- Datos inventados (T11). Nada sale a Cegid.
-- cambia: conta_banco_decision
-- sin usuario: la 0905 no tiene nada que haga una persona (solo escribe filas de QBO, y aquí no hay QBO); los botones ya los prueba como usuario 20261127_q10i_banco_a_cegid_prueba.sql.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q10 TARJETA: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _antes on commit drop as select count(*) n from public.conta_banco_decision;
\i supabase/migrations/20261127T0905_q10j_tarjeta_decidida.sql
\i supabase/migrations/20261127T0905_q10j_tarjeta_decidida.sql
do $$ begin
  if (select count(*) from public.conta_banco_decision) <> (select n from _antes) then raise exception 'Q10 TARJETA · 1: la 0905 ha decidido algo en una base sin QBO.'; end if;
  raise notice 'Q10 TARJETA · 1: la 0905 carga, dos veces, y no hace nada aquí. OK';
end $$;

do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  insert into public.conta_banco_decision (company_id, account_id, clave, decision, concepto, cliente, quien)
  values (v_e, v_acc, 'tpv:2026-11-19T12:41:55Z|48.40', 'facturar', '0022', 900001, 'Julio (27/11)');
end $$;
\i supabase/vuelta-atras/20261127T0905_q10j_tarjeta_decidida.down.sql
do $$ begin
  if (select count(*) from public.conta_banco_decision) <> (select n from _antes) + 1 then raise exception 'Q10 TARJETA · 2: la vuelta atrás ha quitado una decisión que no es suya.'; end if;
  raise notice 'Q10 TARJETA · 2: la vuelta atrás solo quita las suyas. OK';
end $$;

rollback;
