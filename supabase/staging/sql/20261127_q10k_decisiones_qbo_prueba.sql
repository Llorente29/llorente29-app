-- supabase/staging/sql/20261127_q10k_decisiones_qbo_prueba.sql
--
-- SOLO STAGING. La 1126 del Q10 · respuesta 9 (las 3 respuestas de QBO, como decisiones), con ROLLBACK:
--   1. Dos veces: sin la empresa de QBO, no decide nada.
--   2. Su vuelta atrás no toca una decisión que no es suya (una inventada de la cuenta A), y deja todo como estaba.
-- Datos inventados (T11). Nada sale a Cegid.
-- cambia: conta_banco_decision
-- sin usuario: la 1126 no tiene nada que haga una persona (solo escribe filas de QBO, y aquí no hay QBO); los botones ya los prueba como usuario 20261127_q10i_banco_a_cegid_prueba.sql.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q10 QBO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _antes on commit drop as select count(*) n from public.conta_banco_decision;
\i supabase/migrations/20261127T1126_q10k_decisiones_qbo.sql
\i supabase/migrations/20261127T1126_q10k_decisiones_qbo.sql
do $$ begin
  if (select count(*) from public.conta_banco_decision) <> (select n from _antes) then raise exception 'Q10 QBO · 1: la 1126 ha decidido algo en una base sin QBO.'; end if;
  raise notice 'Q10 QBO · 1: la 1126 carga, dos veces, y no hace nada aquí. OK';
end $$;

do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  insert into public.conta_banco_decision (company_id, account_id, clave, decision, concepto, cliente, quien)
  values (v_e, v_acc, 'mov:b346eefb-b9ed-436c-a235-4b9d28bc7792', 'facturar', '0017', 900001, 'QBO vía Julio (27/11)');
end $$;
\i supabase/vuelta-atras/20261127T1126_q10k_decisiones_qbo.down.sql
do $$ begin
  if (select count(*) from public.conta_banco_decision) <> (select n from _antes) + 1 then raise exception 'Q10 QBO · 2: la vuelta atrás ha quitado una decisión que no es suya.'; end if;
  raise notice 'Q10 QBO · 2: la vuelta atrás solo quita las suyas. OK';
end $$;

rollback;
