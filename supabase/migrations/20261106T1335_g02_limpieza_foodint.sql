-- supabase/migrations/20261106T1335_g02_limpieza_foodint.sql
--
-- G02 · Quitar de la cuenta Foodint las dos empresas de prueba de QBO (Julio,
-- 06/11, respuestas a la tarea 1 del G02). Mueve filas: va con autorizo.
--
--   · El 06/11 se dieron de alta por error, DENTRO de Foodint, las dos empresas
--     de prueba de QBO (11:24 y 11:30 UTC). Ya están bien en su cuenta propia,
--     «Asesoría QBO» (f4e8032d…), que esta tanda NO toca.
--   · Se borra, en este orden, todo lo que cuelga de ellas (medido el 06/11 a
--     las 12:30 UTC, solo leyendo; 16 tablas), después las dos empresas, y al
--     final el registro del programa anterior, también las 2 filas de «baja»
--     que apunta su disparador al borrar.
--   · Foodint deja de ser asesoría: tax_advisor_since y tax_advisor_by vuelven a
--     vacío (se rellenaron el 06/11 a las 11:26:20 UTC al contestar «Sí, soy una
--     asesoría» en el alta; conta_despacho_marcar hace coalesce, así que antes
--     estaban vacíos).
--   · Cada borrado va anclado por el id de las dos empresas Y por el account_id
--     de Foodint (regla 9), nunca por nombre.
--   · Recuentos EXACTOS; si uno no es el medido, para y no borra nada. Salvo
--     sales_day_proposal_log (el cierre del día corre cada hora y puede haber
--     añadido filas): se borran todas, pero solo si TODAS son «sin_propuesta» y
--     sin asiento.
--   · Antes de borrar las empresas, ninguna otra tabla con clave ajena a
--     `company` les apunta (si no, el cascade borraría algo sin copia).
--   · Cada fila borrada queda en public.conta_g02_copia (jsonb), para la vuelta
--     atrás con los mismos ids. La copia SE QUEDA hasta que Julio confirme que
--     Foodint está bien; después se quita en otra tanda.
--
-- No toca la empresa real de Foodint (658728c0…) ni ninguna de sus facturas,
-- documentos, asientos o esperados. Nada en el camino del pedido.
-- Sin Foodint (staging), no hace nada.
-- Vuelta atrás: supabase/vuelta-atras/20261106T1335_g02_limpieza_foodint.down.sql

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';      -- Foodint
  v_real constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';     -- su empresa de verdad: no se toca
  v_asesoria constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655'; -- la cuenta «Asesoría QBO»: no se toca
  v_emp constant uuid[] := array['ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1']::uuid[];
  v_desde constant timestamptz := timestamptz '2026-11-06 11:26:20.49281+00';
  v_por constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  -- Lo medido el 06/11 (12:30 UTC), en el orden en que se borra. El registro del
  -- programa anterior va aparte, al final.
  v_orden constant text[] := array[
    'company_account_link', 'company_account_log', 'company_account', 'ai_data_origin', 'ai_action_log',
    'bank_activity_log', 'bank_agent_run', 'company_doubt', 'company_tax_facts', 'tax_obligation',
    'company_tax_profile', 'conta_programa_anterior', 'fiscal_year', 'supplier_expected_invoice'];
  v_medido constant jsonb := jsonb_build_object(
    'company_account_link', 182, 'company_account_log', 2, 'company_account', 1376, 'ai_data_origin', 15,
    'ai_action_log', 15, 'bank_activity_log', 1, 'bank_agent_run', 1, 'company_doubt', 8,
    'company_tax_facts', 4, 'tax_obligation', 16, 'company_tax_profile', 2, 'conta_programa_anterior', 2,
    'fiscal_year', 2, 'supplier_expected_invoice', 4);
  t text; n int; i int := 0; v_reg_max bigint; r record;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'G02: sin la cuenta de Foodint (staging), no hay nada que quitar.';
    return;
  end if;
  if to_regclass('public.conta_g02_copia') is not null then
    raise exception 'G02: ya existe public.conta_g02_copia (de una pasada anterior): no se borra nada encima de una copia.';
  end if;

  -- ── 1 · Que todo es lo medido ─────────────────────────────────────────────
  select count(*) into n from public.company c
   where c.id = any(v_emp) and c.account_id = v_acc
     and c.created_at between timestamptz '2026-11-06 11:24:00+00' and timestamptz '2026-11-06 11:31:00+00';
  if n <> 2 then raise exception 'G02: las dos empresas de prueba no están en Foodint como se midieron (alta del 06/11, 11:24–11:31 UTC): % de 2. No se borra nada.', n; end if;
  if not exists (select 1 from public.company where id = v_real and account_id = v_acc) or v_real = any(v_emp) then
    raise exception 'G02: la empresa real de Foodint no está como se midió. No se borra nada.';
  end if;
  select count(*) into n from public.company where account_id = v_acc;
  if n <> 3 then raise exception 'G02: Foodint tenía que tener 3 empresas (la real y las dos de prueba) y tiene %. No se borra nada.', n; end if;

  -- La marca de asesoría: la del 06/11, y Foodint sin clientes de despacho.
  if not exists (select 1 from public.accounts where id = v_acc and tax_advisor_since = v_desde and tax_advisor_by = v_por) then
    raise exception 'G02: tax_advisor_since / tax_advisor_by de Foodint no son los del 06/11 (11:26:20 UTC). No se borra nada.';
  end if;
  if exists (select 1 from public.company_tax_presenter where advisor_account_id = v_acc)
     or exists (select 1 from public.tax_advisor_invitation where advisor_account_id = v_acc) then
    raise exception 'G02: Foodint ya tiene clientes o invitaciones de despacho: no se le quita la marca de asesoría. No se borra nada.';
  end if;

  -- Cada tabla, el recuento exacto (y siempre de Foodint).
  foreach t in array v_orden loop
    execute format('select count(*) from public.%I where company_id = any($1)', t) into n using v_emp;
    if n <> (v_medido->>t)::int then
      raise exception 'G02: % tiene % filas de las dos empresas de prueba y se midieron %. No se borra nada.', t, n, v_medido->>t;
    end if;
    execute format('select count(*) from public.%I where company_id = any($1) and account_id is distinct from $2', t) into n using v_emp, v_acc;
    if n <> 0 then raise exception 'G02: % tiene % filas de las empresas de prueba que no son de la cuenta de Foodint. No se borra nada.', t, n; end if;
  end loop;
  select count(*) into n from public.conta_programa_anterior_registro where company_id = any(v_emp);
  if n <> 2 then raise exception 'G02: conta_programa_anterior_registro tiene % filas de las empresas de prueba y se midieron 2. No se borra nada.', n; end if;

  -- El cierre del día: todas «sin_propuesta» y sin asiento (pueden ser más de 628).
  select count(*) into n from public.sales_day_proposal_log
   where company_id = any(v_emp) and (result is distinct from 'sin_propuesta' or entry_id is not null or account_id is distinct from v_acc);
  if n <> 0 then raise exception 'G02: % filas del cierre del día de las empresas de prueba tienen propuesta o asiento (o no son de Foodint). No se borra nada.', n; end if;

  -- Nada de la empresa real ni de ninguna otra apunta al plan de cuentas de las de prueba.
  select count(*) into n from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where (a.company_id = any(v_emp)) <> (l.company_id = any(v_emp));
  if n <> 0 then raise exception 'G02: % enlaces cruzan entre el plan de las empresas de prueba y otra empresa. No se borra nada.', n; end if;
  select count(*) into n from public.journal_line l join public.company_account a on a.id = l.company_account_id where a.company_id = any(v_emp);
  if n <> 0 then raise exception 'G02: % apuntes usan una subcuenta de las empresas de prueba. No se borra nada.', n; end if;

  -- ── 2 · La copia, para la vuelta atrás con los mismos ids ──────────────────
  create table public.conta_g02_copia (
    orden int not null,
    tabla text not null,
    fila jsonb not null,
    copiada_en timestamptz not null default now()
  );
  alter table public.conta_g02_copia enable row level security;
  revoke all on table public.conta_g02_copia from public, anon, authenticated;
  comment on table public.conta_g02_copia is
    'G02 (06/11) · Copia de lo borrado de Foodint (las dos empresas de prueba de QBO y su marca de asesoría), para la vuelta atrás. Se quita en otra tanda cuando Julio confirme que Foodint está bien.';

  insert into public.conta_g02_copia (orden, tabla, fila)
  select 0, 'accounts', jsonb_build_object('id', a.id, 'tax_advisor_since', a.tax_advisor_since, 'tax_advisor_by', a.tax_advisor_by)
    from public.accounts a where a.id = v_acc;
  select coalesce(max(id), 0) into v_reg_max from public.conta_programa_anterior_registro;

  -- ── 3 · Lo que cuelga de ellas, en orden, cada fila a la copia ─────────────
  -- tax_obligation, sin su espejo: si no, reescribiría tax_forms del perfil
  -- antes de copiarlo, y la vuelta atrás no lo dejaría como estaba.
  perform set_config('conta.i01_desde_columna', 'si', true);
  foreach t in array v_orden loop
    i := i + 1;
    execute format(
      'with d as (delete from public.%I x where x.company_id = any($1) and x.account_id = $2 returning x.*)
       insert into public.conta_g02_copia (orden, tabla, fila) select $3, %L, to_jsonb(d) from d', t, t)
      using v_emp, v_acc, i;
    get diagnostics n = row_count;
    if n <> (v_medido->>t)::int then
      raise exception 'G02: en % se iban a borrar % filas y se han borrado %. No se borra nada.', t, v_medido->>t, n;
    end if;
    raise notice 'G02: % · % filas borradas (a la copia).', t, n;
  end loop;
  perform set_config('conta.i01_desde_columna', '', true);

  i := i + 1;
  with d as (delete from public.sales_day_proposal_log x
              where x.company_id = any(v_emp) and x.account_id = v_acc and x.result = 'sin_propuesta' and x.entry_id is null
              returning x.*)
  insert into public.conta_g02_copia (orden, tabla, fila) select i, 'sales_day_proposal_log', to_jsonb(d) from d;
  get diagnostics n = row_count;
  if n < 628 then raise exception 'G02: del cierre del día se han borrado % filas y se midieron al menos 628. No se borra nada.', n; end if;
  if exists (select 1 from public.sales_day_proposal_log where company_id = any(v_emp)) then
    raise exception 'G02: quedan filas del cierre del día de las empresas de prueba con propuesta o asiento. No se borra nada.';
  end if;
  raise notice 'G02: sales_day_proposal_log · % filas borradas (a la copia), todas «sin_propuesta» y sin asiento.', n;

  -- Antes de borrar las empresas: NINGUNA tabla con clave ajena a company les
  -- apunta ya (el cascade borraría algo sin copia).
  for r in
    select c.conrelid::regclass::text tabla, a.attname col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.company'::regclass
  loop
    execute format('select count(*) from %s where %I = any($1)', r.tabla, r.col) into n using v_emp;
    if n <> 0 then raise exception 'G02: % (%) tiene todavía % filas de las empresas de prueba. No se borra nada.', r.tabla, r.col, n; end if;
  end loop;

  -- ── 4 · Las dos empresas ──────────────────────────────────────────────────
  i := i + 1;
  with d as (delete from public.company x where x.id = any(v_emp) and x.account_id = v_acc returning x.*)
  insert into public.conta_g02_copia (orden, tabla, fila) select i, 'company', to_jsonb(d) from d;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'G02: se iban a borrar 2 empresas y se han borrado %. No se borra nada.', n; end if;
  raise notice 'G02: company · 2 empresas de prueba borradas (a la copia).';

  -- ── 5 · Al final, el registro del programa anterior ───────────────────────
  -- Las 2 de antes van a la copia; las 2 «baja» que acaba de apuntar el
  -- disparador (id > v_reg_max) no existían antes de la tanda: se borran sin copia.
  i := i + 1;
  with d as (delete from public.conta_programa_anterior_registro x
              where x.company_id = any(v_emp) and x.account_id = v_acc and x.id <= v_reg_max returning x.*)
  insert into public.conta_g02_copia (orden, tabla, fila) select i, 'conta_programa_anterior_registro', to_jsonb(d) from d;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'G02: del registro del programa anterior se iban a copiar y borrar 2 filas y han sido %. No se borra nada.', n; end if;
  delete from public.conta_programa_anterior_registro x
   where x.company_id = any(v_emp) and x.account_id = v_acc and x.id > v_reg_max and x.accion = 'baja';
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'G02: el disparador tenía que apuntar 2 «baja» al borrar el programa anterior y se han borrado %. No se borra nada.', n; end if;
  if exists (select 1 from public.conta_programa_anterior_registro where company_id = any(v_emp)) then
    raise exception 'G02: quedan filas del registro del programa anterior de las empresas de prueba. No se borra nada.';
  end if;
  raise notice 'G02: conta_programa_anterior_registro · 2 filas a la copia y 2 «baja» del disparador, borradas.';

  -- ── 6 · Foodint deja de ser asesoría ──────────────────────────────────────
  update public.accounts set tax_advisor_since = null, tax_advisor_by = null
   where id = v_acc and tax_advisor_since = v_desde and tax_advisor_by = v_por;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'G02: no se ha podido quitar la marca de asesoría de Foodint (% filas). No se borra nada.', n; end if;

  -- ── 7 · Cómo queda ────────────────────────────────────────────────────────
  if (select count(*) from public.company where account_id = v_acc) <> 1 or not exists (select 1 from public.company where id = v_real) then
    raise exception 'G02: Foodint tenía que quedar con su empresa real sola. No se borra nada.';
  end if;
  if (select count(*) from public.company where account_id = v_asesoria) <> 2 then
    raise exception 'G02: la cuenta «Asesoría QBO» tenía que seguir con sus 2 empresas. No se borra nada.';
  end if;
  raise notice 'G02: Foodint queda con 1 empresa y sin marca de asesoría; «Asesoría QBO» sigue con sus 2. Copia: % filas en public.conta_g02_copia.',
    (select count(*) from public.conta_g02_copia);
end $$;
