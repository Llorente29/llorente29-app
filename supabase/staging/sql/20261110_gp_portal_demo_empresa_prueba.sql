-- supabase/staging/sql/20261110_gp_portal_demo_empresa_prueba.sql
--
-- SOLO STAGING. Prueba de la 1345 (GP · nº 28: el portal de la demo como la
-- maqueta). Todo en una transacción con ROLLBACK, con datos inventados (T11): no
-- cambia staging.
--
--   1. Preparar crea la empresa de Talleres Ruiz en Sumied (cuenta demo propia,
--      con su sociedad), la enlaza, y siembra los 4 impuestos presentados, las
--      nóminas de los dos últimos meses (de los trabajadores de Gestión laboral
--      de entonces, con el nombre bien escrito) y los seguros sociales, a Lucía
--      Pardo con «Facturas y documentos», una conversación ya avisada y el
--      contacto de la gestoría.
--   2. Preparar otra vez no duplica nada.
--   3. Como Tomás: Inicio y Documentos con su empresa (sube documentos, ve los
--      impuestos y las nóminas, y «Lo último» los trae); «Correo para las
--      facturas» es el de GoCardless (adonde va la factura).
--   4. La vuelta atrás: las dos funciones como estaban y fuera lo sembrado en la
--      cuenta de la gestoría.
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; la lectura se prueba como la persona del portal.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-1345: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_portal_inicio(uuid)') is null as falta_la_1530 \gset
\if :falta_la_1530
\i supabase/migrations/20261109T1530_gp_portal_base.sql
\endif
select to_regprocedure('public.conta_portal_cuenta(uuid)') is null as falta_la_1720 \gset
\if :falta_la_1720
\i supabase/migrations/20261109T1720_gp_portal_cuenta.sql
\endif
select position('''recibidas''' in pg_get_functiondef('public.conta_portal_inicio(uuid)'::regprocedure)) = 0 as falta_la_0945 \gset
\if :falta_la_0945
\i supabase/migrations/20261110T0945_gp_portal_inicio_hecho.sql
\endif
select position('''pagada''' in pg_get_functiondef('public.conta_portal_facturas(uuid)'::regprocedure)) = 0 as falta_la_1010 \gset
\if :falta_la_1010
\i supabase/migrations/20261110T1010_gp_portal_facturas_pagada.sql
\endif
select to_regprocedure('public.conta_portal_demo_preparar(uuid)') is null as falta_la_2240 \gset
\if :falta_la_2240
\i supabase/migrations/20261109T2240_gp_portal_demo.sql
\endif
select position('0000000000b1' in pg_get_functiondef('public.conta_portal_demo_preparar(uuid)'::regprocedure)) > 0 as ya_esta_la_1345 \gset
\if :ya_esta_la_1345
\i supabase/vuelta-atras/20261110T1345_gp_portal_demo_empresa.down.sql
\endif

-- ── 0 · La cuenta demo con su sociedad, un Talleres Ruiz inventado, sus trabajadores y su cliente en GoCardless ─
create temp table _g on commit drop as
select 'de000000-0000-4000-8000-0000000000a0'::uuid as demo, null::uuid as soc, null::uuid as cliente,
       '0000a1a1-0000-4000-8000-000000001345'::uuid as tomas_u, (select exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000b1')) as ya_habia_empresa;
do $$
declare v_soc uuid; v_cli uuid; v_srv uuid; v_mes date := date_trunc('month', (now() at time zone 'Europe/Madrid')::date)::date;
begin
  if not exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0') then
    insert into public.accounts (id, name, slug, is_demo) values ('de000000-0000-4000-8000-0000000000a0', 'Gestoría Demo (prueba)', 'gestoria-demo-prueba-1345', true);
  end if;
  update public.accounts set is_demo = true where id = 'de000000-0000-4000-8000-0000000000a0';
  select id into v_soc from public.company where account_id = 'de000000-0000-4000-8000-0000000000a0' and is_active order by created_at limit 1;
  if v_soc is null then
    insert into public.company (account_id, legal_name, tax_id, entity_kind) values ('de000000-0000-4000-8000-0000000000a0', 'Gestoría Demo, S.L.', 'B00000000', 'company') returning id into v_soc;
  end if;
  select id into v_cli from public.party where account_id = 'de000000-0000-4000-8000-0000000000a0' and name = 'Talleres Ruiz, S.L.' order by created_at limit 1;
  if v_cli is null then
    insert into public.party (account_id, name, tax_id) values ('de000000-0000-4000-8000-0000000000a0', 'Talleres Ruiz, S.L.', 'B00001115') returning id into v_cli;
  end if;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values ('de000000-0000-4000-8000-0000000000a0', v_soc, 'prueba-1345-laboral', 'Gestión laboral', 'por_empleado') returning id into v_srv;
  -- Tres de antes (en mayúsculas, como las trae el CRM) y un alta que empieza el mes que viene (no lleva nóminas aún).
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, origen, desde) values
    ('de000000-0000-4000-8000-0000000000a0', v_soc, v_cli, v_srv, 'PERSONA PRUEBA UNO', 'manual', (v_mes - interval '6 months')::date),
    ('de000000-0000-4000-8000-0000000000a0', v_soc, v_cli, v_srv, 'PERSONA PRUEBA DOS', 'manual', (v_mes - interval '6 months')::date),
    ('de000000-0000-4000-8000-0000000000a0', v_soc, v_cli, v_srv, 'PERSONA PRUEBA TRES', 'manual', (v_mes - interval '6 months')::date),
    ('de000000-0000-4000-8000-0000000000a0', v_soc, v_cli, v_srv, 'PERSONA PRUEBA NUEVA', 'manual', (v_mes + interval '1 month')::date);
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, correo, party_id) values (v_soc, 'CU-PRUEBA-1345', 'de000000-0000-4000-8000-0000000000a0', 'facturas.1345@ejemplo.invalid', v_cli);
  -- Tomás, con su usuario (el enlace se lo pone al entrar).
  insert into auth.users (id, email) values ('0000a1a1-0000-4000-8000-000000001345', 'tomas.1345@ejemplo.invalid');
  update _g set soc = v_soc, cliente = v_cli;
end $$;

\i supabase/migrations/20261110T1345_gp_portal_demo_empresa.sql

-- ── 1 y 2 · Preparar (la migración ya lo llamó una vez) y preparar otra vez ────
do $$
declare g _g; v jsonb; n1 int; n2 int; c int; nom int; ss int;
begin
  select * into g from _g;
  if not exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000b1' and is_demo is true)
     or not exists (select 1 from public.company where id = 'de000000-0000-4000-8000-0000000000b2' and account_id = 'de000000-0000-4000-8000-0000000000b1') then
    raise exception 'PRUEBA GP-1345 · 1: no está la empresa de Talleres Ruiz (cuenta demo y sociedad).';
  end if;
  if public._conta_portal_cuenta_propia(g.demo, g.cliente) is distinct from 'de000000-0000-4000-8000-0000000000b1' then
    raise exception 'PRUEBA GP-1345 · 1: la ficha de Talleres Ruiz no apunta a su empresa.';
  end if;
  select count(*) into c from public.tax_return where account_id = 'de000000-0000-4000-8000-0000000000b1' and status = 'filed' and receipt_document_path like 'demo/%' and form_code in ('303', '111', '115', '200');
  if c <> 4 then raise exception 'PRUEBA GP-1345 · 1: % impuestos presentados con justificante (4).', c; end if;
  select count(*) filter (where d.carpeta = 'nominas'), count(*) filter (where d.carpeta = 'ss_sepe') into nom, ss
    from public.documents d join public.employees e on e.id = d.employee_id where e.account_id = 'de000000-0000-4000-8000-0000000000b1';
  if nom <> 6 or ss <> 1 then raise exception 'PRUEBA GP-1345 · 1: % nóminas y % seguros sociales (6 y 1: tres personas, dos meses; el alta nueva, no).', nom, ss; end if;
  if exists (select 1 from public.employees where account_id = 'de000000-0000-4000-8000-0000000000b1' and (name = upper(name) or name ilike '%nueva%')) then
    raise exception 'PRUEBA GP-1345 · 1: un trabajador en mayúsculas o el alta nueva con nóminas.';
  end if;
  if not exists (select 1 from public.conta_portal_acceso where party_id = g.cliente and correo = 'administracion@talleresruiz.example' and permiso = 'facturas_documentos' and user_id is null) then
    raise exception 'PRUEBA GP-1345 · 1: falta Lucía Pardo con «Facturas y documentos».';
  end if;
  if (select count(*) from public.conta_portal_mensaje where party_id = g.cliente and avisado_at is not null) <> 4
     or exists (select 1 from public.conta_portal_mensaje where party_id = g.cliente and avisado_at is null) then
    raise exception 'PRUEBA GP-1345 · 1: la bienvenida y la conversación (4, ya avisados) no están, o alguno mandaría un correo.';
  end if;
  if not exists (select 1 from public.company where id = g.soc and email = 'hola@gestoriademo.example' and phone = '910000000') then
    raise exception 'PRUEBA GP-1345 · 1: el contacto de la gestoría no es el inventado.';
  end if;
  select (select count(*) from public.conta_portal_acceso where party_id = g.cliente) + (select count(*) from public.conta_portal_mensaje where party_id = g.cliente)
       + (select count(*) from public.tax_return where account_id = 'de000000-0000-4000-8000-0000000000b1')
       + (select count(*) from public.documents d join public.employees e on e.id = d.employee_id where e.account_id = 'de000000-0000-4000-8000-0000000000b1')
       + (select count(*) from public.employees where account_id = 'de000000-0000-4000-8000-0000000000b1') into n1;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v := public.conta_portal_demo_preparar(g.demo);
  perform set_config('request.jwt.claims', '', true);
  select (select count(*) from public.conta_portal_acceso where party_id = g.cliente) + (select count(*) from public.conta_portal_mensaje where party_id = g.cliente)
       + (select count(*) from public.tax_return where account_id = 'de000000-0000-4000-8000-0000000000b1')
       + (select count(*) from public.documents d join public.employees e on e.id = d.employee_id where e.account_id = 'de000000-0000-4000-8000-0000000000b1')
       + (select count(*) from public.employees where account_id = 'de000000-0000-4000-8000-0000000000b1') into n2;
  if n1 <> n2 or v ->> 'frase' not like 'El portal de la demo ya estaba preparado%' then
    raise exception 'PRUEBA GP-1345 · 2: preparar otra vez cambia algo (% → % filas): «%».', n1, n2, v ->> 'frase';
  end if;
  raise notice 'GP-1345 · 1 y 2: la empresa de Talleres Ruiz enlazada, 4 impuestos, 6 nóminas y los seguros sociales, Lucía Pardo, la conversación ya avisada y el contacto; otra vez, nada más. OK';
end $$;

-- ── 3 · Como Tomás ─────────────────────────────────────────────────────────────
update public.conta_portal_acceso set user_id = '0000a1a1-0000-4000-8000-000000001345'
 where party_id = (select cliente from _g) and lower(correo) = 'tomas.ruiz@talleresruiz.example';
grant select on _g to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '0000a1a1-0000-4000-8000-000000001345', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare g _g; i jsonb; d jsonb; c jsonb;
begin
  select * into g from _g;
  i := public.conta_portal_inicio(g.cliente); d := public.conta_portal_documentos(g.cliente); c := public.conta_portal_cuenta(g.cliente);
  if (i ->> 'puede_subir')::boolean is not true or (d ->> 'puede_subir')::boolean is not true then
    raise exception 'PRUEBA GP-1345 · 3: Tomás no puede subir documentos: %', i ->> 'puede_subir';
  end if;
  if jsonb_array_length(d -> 'impuestos') <> 4 or jsonb_array_length(d -> 'nominas') <> 7 then
    raise exception 'PRUEBA GP-1345 · 3: Documentos no trae los 4 impuestos y los 7 de laboral: %', d;
  end if;
  if not exists (select 1 from jsonb_array_elements(i -> 'novedades') x where x ->> 'tipo' = 'impuesto')
     or not exists (select 1 from jsonb_array_elements(i -> 'novedades') x where x ->> 'tipo' = 'nomina' and (x ->> 'n')::int = 3) then
    raise exception 'PRUEBA GP-1345 · 3: «Lo último» no trae los impuestos y las nóminas del último mes: %', i -> 'novedades';
  end if;
  if c -> 'datos' ->> 'correo_facturas' is distinct from 'facturas.1345@ejemplo.invalid' then
    raise exception 'PRUEBA GP-1345 · 3: «Correo para las facturas» no es adonde va la factura (GoCardless): %', c -> 'datos';
  end if;
  if jsonb_array_length(c -> 'personas') <> 2 then raise exception 'PRUEBA GP-1345 · 3: Tu cuenta no trae las dos personas: %', c -> 'personas'; end if;
  raise notice 'GP-1345 · 3: Tomás sube documentos, ve 4 impuestos y 7 de laboral, «Lo último» con impuestos y nóminas, el correo de GoCardless y dos personas. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 4 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261110T1345_gp_portal_demo_empresa.down.sql
do $$
declare g _g;
begin
  select * into g from _g;
  if position('0000000000b1' in pg_get_functiondef('public.conta_portal_demo_preparar(uuid)'::regprocedure)) > 0
     or position('conta_gc_cliente' in pg_get_functiondef('public.conta_portal_cuenta(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA GP-1345 · 4: la vuelta atrás no deja las dos funciones como estaban.';
  end if;
  if public._conta_portal_cuenta_propia(g.demo, g.cliente) is not null
     or exists (select 1 from public.conta_portal_acceso where party_id = g.cliente and correo = 'administracion@talleresruiz.example')
     or (select count(*) from public.conta_portal_mensaje where party_id = g.cliente) <> 1 then
    raise exception 'PRUEBA GP-1345 · 4: la vuelta atrás deja el enlace, a Lucía Pardo o la conversación.';
  end if;
  raise notice 'GP-1345 · 4: la vuelta atrás deja las dos funciones como estaban y quita lo sembrado en la cuenta de la gestoría. OK';
end $$;

rollback;
