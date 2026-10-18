-- supabase/staging/sql/20261122_i01b_certificados_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0220_i01b_certificados (la 0100 a la 0150
-- ya están en staging de verdad), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia. Como usuario de la empresa A y de la cuenta B. Los
-- certificados son fichas de mentira (sin material: el secreto no existe).
--
--   1. A (no es Foodint) no puede subir uno, y el porqué es, letra a letra, el
--      mismo con que se para conta_cert_guardar.
--   2. Con una ficha de A, «presentar con este»: la empresa presenta con él, y
--      la lectura lo dice; nada del material ni la huella sale.
--   3. Un certificado de otra cuenta no se puede poner para A.
--   4. B no ve los de A ni decide quién presenta.
--   5. Su vuelta atrás quita las dos funciones, y se puede volver a aplicar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA certificados: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261122T0220_i01b_certificados.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated, service_role;

-- Las fichas de mentira, una de A y otra de B (como las dejaría conta_cert_guardar, sin secreto de verdad).
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_acc_a uuid; v_acc_b uuid; v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid();
begin
  select account_id into v_acc_a from public.company where id = v_a;
  select account_id into v_acc_b from public.user_profiles where user_id = 'c01b0000-0000-4000-8000-0000000000b1' and active limit 1;
  if v_acc_b is null or v_acc_b = v_acc_a then raise exception 'PRUEBA certificados: no encuentro la cuenta B.'; end if;
  insert into public.tax_certificate (id, owner_account_id, subject_name, subject_tax_id_hash, subject_tax_id_tail, issuer, serial, valid_from, valid_to,
                                      fingerprint_sha256, kind, storage, vault_secret_id, uploaded_by_name)
  values (v1, v_acc_a, 'EMPRESA DE PRUEBA A SL', repeat('a', 64), '00T', 'AC DE PRUEBA', '01', now() - interval '1 year', now() + interval '1 year',
          md5(v1::text) || md5(v1::text), 'legal_representative', 'vault', gen_random_uuid(), 'Prueba'),
         (v2, v_acc_b, 'EMPRESA DE PRUEBA B SL', repeat('b', 64), '00T', 'AC DE PRUEBA', '02', now() - interval '1 year', now() + interval '1 year',
          md5(v2::text) || md5(v2::text), 'legal_representative', 'vault', gen_random_uuid(), 'Prueba');
  insert into _p values ('cert_a', v1::text), ('cert_b', v2::text), ('cuenta_a', v_acc_a::text);
end $$;

-- ── 1 · A no puede subir uno, con el mismo porqué que la base ────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_guardar text; v jsonb;
begin
  begin
    perform public.conta_cert_guardar('c01a0000-0000-4000-8000-0000000000a1', (select val::uuid from _p where k = 'cuenta_a'), '{}'::jsonb, 'nada');
    raise exception 'PRUEBA certificados · 1: conta_cert_guardar deja guardar en la cuenta de A.';
  exception when insufficient_privilege then v_guardar := sqlerrm;
  end;
  insert into _p values ('motivo', v_guardar);
end $$;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb;
begin
  v := public.conta_impuesto_certificados_ver(v_a);
  if not (v->>'es_admin')::boolean or (v->>'puede_subir')::boolean or v->>'por_que_no_subir' <> (select val from _p where k = 'motivo') then
    raise exception 'PRUEBA certificados · 1: subir sale %/%: «%» frente a «%».', v->>'es_admin', v->>'puede_subir', v->>'por_que_no_subir', (select val from _p where k = 'motivo');
  end if;
  raise notice 'PRUEBA certificados · 1: A no puede subir; el porqué es el de la base: «%».', v->>'por_que_no_subir';
end $$;

-- ── 2 · Presentar con este ───────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; c jsonb;
begin
  v := public.conta_impuesto_certificado_presenta(v_a, (select val::uuid from _p where k = 'cert_a'));
  if not exists (select 1 from public.company_tax_presenter where company_id = v_a and mode = 'company' and certificate_id = (select val::uuid from _p where k = 'cert_a')) then
    raise exception 'PRUEBA certificados · 2: la empresa no presenta con el certificado.';
  end if;
  v := public.conta_impuesto_certificados_ver(v_a);
  select x into c from jsonb_array_elements(v->'certificados') x where x->>'id' = (select val from _p where k = 'cert_a');
  if c is null or not (c->>'presenta')::boolean or c ? 'fingerprint_sha256' or c ? 'vault_secret_id' or c ? 'subject_tax_id_hash' or v::text ~ repeat('a', 64) then
    raise exception 'PRUEBA certificados · 2: la ficha sale %.', c;
  end if;
  if jsonb_array_length(v->'personas') = 0 then raise exception 'PRUEBA certificados · 2: el administrador no ve a las personas de su cuenta.'; end if;
  raise notice 'PRUEBA certificados · 2: presenta la propia empresa con su certificado; la ficha, sin material ni huella.';
end $$;

-- ── 3 · Un certificado de otra cuenta, no ────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  begin
    perform public.conta_impuesto_certificado_presenta(v_a, (select val::uuid from _p where k = 'cert_b'));
    raise exception 'PRUEBA certificados · 3: A presenta con un certificado de B.';
  exception when insufficient_privilege then
    raise notice 'PRUEBA certificados · 3: un certificado de otra cuenta no se puede poner para A.';
  end;
end $$;

-- ── 4 · B no ve ni decide ────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  begin
    perform public.conta_impuesto_certificados_ver(v_a);
    raise exception 'PRUEBA certificados · 4: B ve los certificados de A.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_impuesto_certificado_presenta(v_a, (select val::uuid from _p where k = 'cert_b'));
    raise exception 'PRUEBA certificados · 4: B decide quién presenta en A.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA certificados · 4: B no ve ni decide.';
end $$;

-- ── 5 · Su vuelta atrás ──────────────────────────────────────────────────────
reset role;
\i supabase/vuelta-atras/20261122T0220_i01b_certificados.down.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_certificados_ver(uuid)') is not null or to_regprocedure('public.conta_impuesto_certificado_presenta(uuid, uuid)') is not null then
    raise exception 'PRUEBA certificados · 5: la vuelta atrás deja funciones de la 0220.';
  end if;
  raise notice 'PRUEBA certificados · 5: vuelta atrás, fuera las dos funciones.';
end $$;
\i supabase/migrations/20261122T0220_i01b_certificados.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_certificados_ver(uuid)') is null then raise exception 'PRUEBA certificados · 5: no se vuelve a aplicar.'; end if;
  raise notice 'PRUEBA certificados · 5: y otra vez delante.';
end $$;

\echo '>>> Prueba de certificados (0220) en verde. ROLLBACK: no queda nada.'
rollback;
