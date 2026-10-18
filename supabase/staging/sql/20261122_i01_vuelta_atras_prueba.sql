-- supabase/staging/sql/20261122_i01_vuelta_atras_prueba.sql
--
-- SOLO STAGING. La vuelta atrás de la tanda del I01a (supabase/vuelta-atras/
-- 20261122T01x0_*.down.sql), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia.
--   1. La tanda entera hacia delante (0100 a 0150), y se guarda tax_forms de
--      cada empresa.
--   2. La vuelta atrás entera, en orden inverso: no queda ninguna tabla ni
--      función de la tanda, ni el disparador de company_tax_profile, ni las dos
--      fuentes del BOE; y tax_forms de cada empresa sigue igual (la lista de
--      modelos no se pierde).
--   3. Otra vez hacia delante: se puede volver a aplicar.
-- sin usuario: la vuelta atrás no la ejecuta nadie desde la app; la aplica el
-- workflow de producción como dueño (S01d: faltaba esta línea y antes-de-subir paraba).
-- Lo que hace parar a cada vuelta atrás (lo que decidió una persona) no se
-- ensaya aquí: un raise para el workflow. Está escrito en cada .down.sql.
-- sin usuario: la tanda y su vuelta atrás las aplica el workflow como postgres, y así se prueban aquí.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA vuelta atrás I01a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- ── 1 · Hacia delante ───────────────────────────────────────────────────────
\i supabase/migrations/20261122T0100_i01_plazos.sql
\i supabase/migrations/20261122T0110_i01_modelo_datos.sql
\i supabase/migrations/20261122T0120_i01_obligaciones.sql
\i supabase/migrations/20261122T0130_i01_certificados.sql
\i supabase/migrations/20261122T0140_i01_calculo_303.sql
\i supabase/migrations/20261122T0150_i01_presentar.sql
create temporary table _antes on commit drop as
  select company_id, tax_forms from public.company_tax_profile;
create temporary table _f (n text) on commit drop;
insert into _f values
    ('public.conta_cert_abrir(uuid,uuid)'),
    ('public.conta_cert_confirmar(uuid,text,uuid,uuid)'),
    ('public.conta_cert_cuenta_vault()'),
    ('public.conta_cert_custodia(text)'),
    ('public.conta_cert_es_admin(uuid,uuid)'),
    ('public.conta_cert_guardar(uuid,uuid,jsonb,text)'),
    ('public.conta_cert_nombre(uuid,uuid)'),
    ('public.conta_cert_permiso(uuid,uuid,text)'),
    ('public.conta_cert_puede_usar(uuid,uuid)'),
    ('public.conta_cert_quitar(uuid)'),
    ('public.conta_cert_uso_terminar(uuid,text,text,text)'),
    ('public.conta_impuesto_303_calcular(uuid,int,text)'),
    ('public.conta_impuesto_303_fichero(uuid)'),
    ('public.conta_impuesto_303_fichero_comprobado(uuid,boolean,jsonb,text)'),
    ('public.conta_impuesto_303_preparar(uuid,uuid,uuid)'),
    ('public.conta_impuesto_aviso_aceptar(uuid,text)'),
    ('public.conta_impuesto_cadencia_de(uuid,text)'),
    ('public.conta_impuesto_dato_poner(uuid,text,jsonb,text)'),
    ('public.conta_impuesto_datos_del_alta(uuid,jsonb)'),
    ('public.conta_impuesto_desde_tax_forms()'),
    ('public.conta_impuesto_espejo_tax_forms()'),
    ('public.conta_impuesto_estado()'),
    ('public.conta_impuesto_estado_antes()'),
    ('public.conta_impuesto_estado_texto(text)'),
    ('public.conta_impuesto_estado_vale(text,text)'),
    ('public.conta_impuesto_fin_periodo(text,text)'),
    ('public.conta_impuesto_fuera(uuid,uuid,text,boolean,text,timestamptz,uuid)'),
    ('public.conta_impuesto_gestiona(uuid,uuid)'),
    ('public.conta_impuesto_habil(date,text[])'),
    ('public.conta_impuesto_hacienda_apunte(uuid,uuid,text,text,text[],text,jsonb)'),
    ('public.conta_impuesto_justificante_guardar(uuid,text,text,bigint)'),
    ('public.conta_impuesto_nombre_de(uuid)'),
    ('public.conta_impuesto_obligacion_decidir(uuid,text,boolean,text)'),
    ('public.conta_impuesto_obligaciones_calcular(uuid)'),
    ('public.conta_impuesto_periodo_fechas(int,text)'),
    ('public.conta_impuesto_plazo(text,text,int,text,text)'),
    ('public.conta_impuesto_presentada(uuid,uuid,uuid,text,text,text,timestamptz,jsonb)'),
    ('public.conta_impuesto_presentador_poner(uuid,text,uuid,text)'),
    ('public.conta_impuesto_presentador_retirar(uuid)'),
    ('public.conta_impuesto_puede_gestionar(uuid)'),
    ('public.conta_impuesto_puede_ver(uuid)'),
    ('public.conta_impuesto_quien()'),
    ('public.conta_impuesto_reglas(uuid)'),
    ('public.conta_impuesto_revisar(uuid)');
create temporary table _t (n text) on commit drop;
insert into _t values
    ('public.company_tax_facts'),
    ('public.company_tax_forms'),
    ('public.company_tax_presenter'),
    ('public.tax_certificate'),
    ('public.tax_certificate_confirmation'),
    ('public.tax_certificate_grant'),
    ('public.tax_certificate_use'),
    ('public.tax_form_deadline'),
    ('public.tax_holiday'),
    ('public.tax_holiday_year'),
    ('public.tax_obligation'),
    ('public.tax_return'),
    ('public.tax_return_box'),
    ('public.tax_return_check'),
    ('public.tax_return_event'),
    ('public.tax_return_line');
do $$ begin
  if exists (select 1 from _t where to_regclass(n) is null) or exists (select 1 from _f where to_regprocedure(n) is null) then
    raise exception 'PRUEBA vuelta atrás I01a 1: falta algo de la tanda: % / %.',
      (select string_agg(n, ', ') from _t where to_regclass(n) is null), (select string_agg(n, ', ') from _f where to_regprocedure(n) is null);
  end if;
  raise notice 'PRUEBA vuelta atrás I01a 1: la tanda deja % tablas y % funciones; % empresas con su lista de modelos.',
    (select count(*) from _t), (select count(*) from _f), (select count(*) from _antes);
end $$;

-- ── 2 · Vuelta atrás ────────────────────────────────────────────────────────
-- Con el I01b vivo en staging (desde el 18/10, la 0180 a la 0220), primero se
-- deshace el I01b, como se haría en producción: bank_match_item.tax_return_id
-- apunta a tax_return y, sin eso, la 0110 no puede quitar la tabla. Si staging
-- ya tiene liquidaciones o pagos casados con una declaración, la vuelta atrás
-- de la 0180 para (como debe) y la del I01a no se puede ensayar: se dice y se
-- acaba aquí, sin tocar nada.
select to_regprocedure('public.conta_impuesto_303_contabilizar(uuid)') is not null as hay_i01b \gset
\if :hay_i01b
select exists (select 1 from public.journal_entry e where e.source_type = 'vat_settlement' and exists (select 1 from public.tax_return r where r.id = e.source_id))
    or exists (select 1 from public.bank_match_item where tax_return_id is not null) as i01b_con_datos \gset
\if :i01b_con_datos
\echo '>>> PRUEBA vuelta atrás I01a: staging tiene liquidaciones del I01b; la vuelta atrás de la 0180 para, como debe, y la del I01a no se ensaya. ROLLBACK: no queda nada.'
rollback;
\q
\endif
\echo '>>> PRUEBA vuelta atrás I01a: primero se deshace el I01b (0220 a 0180).'
\i supabase/vuelta-atras/20261122T0220_i01b_certificados.down.sql
\i supabase/vuelta-atras/20261122T0210_i01b_presentados.down.sql
\i supabase/vuelta-atras/20261122T0200_i01b_declaracion.down.sql
\i supabase/vuelta-atras/20261122T0190_i01b_calendario.down.sql
\i supabase/vuelta-atras/20261122T0180_i01b_asiento_303.down.sql
\endif
\i supabase/vuelta-atras/20261122T0150_i01_presentar.down.sql
\i supabase/vuelta-atras/20261122T0140_i01_calculo_303.down.sql
\i supabase/vuelta-atras/20261122T0130_i01_certificados.down.sql
\i supabase/vuelta-atras/20261122T0120_i01_obligaciones.down.sql
\i supabase/vuelta-atras/20261122T0110_i01_modelo_datos.down.sql
\i supabase/vuelta-atras/20261122T0100_i01_plazos.down.sql
do $$ begin
  if exists (select 1 from _t where to_regclass(n) is not null) or exists (select 1 from _f where to_regprocedure(n) is not null) then
    raise exception 'PRUEBA vuelta atrás I01a 2: queda algo de la tanda: % / %.',
      (select string_agg(n, ', ') from _t where to_regclass(n) is not null), (select string_agg(n, ', ') from _f where to_regprocedure(n) is not null);
  end if;
  if exists (select 1 from pg_trigger where tgname = 'company_tax_profile_tax_forms' and tgrelid = 'public.company_tax_profile'::regclass) then
    raise exception 'PRUEBA vuelta atrás I01a 2: queda el disparador de tax_forms.';
  end if;
  if exists (select 1 from public.official_source where key in ('boe-fiestas-laborales-2026', 'boe-fiestas-laborales-2027')) then
    raise exception 'PRUEBA vuelta atrás I01a 2: quedan las fuentes del BOE.';
  end if;
  if exists (select 1 from _antes a full join public.company_tax_profile p using (company_id) where a.tax_forms is distinct from p.tax_forms) then
    raise exception 'PRUEBA vuelta atrás I01a 2: cambia tax_forms de alguna empresa.';
  end if;
  raise notice 'PRUEBA vuelta atrás I01a 2: no queda nada de la tanda y tax_forms de las % empresas sigue igual.', (select count(*) from _antes);
end $$;

-- ── 3 · Otra vez hacia delante ─────────────────────────────────────────────
\i supabase/migrations/20261122T0100_i01_plazos.sql
\i supabase/migrations/20261122T0110_i01_modelo_datos.sql
\i supabase/migrations/20261122T0120_i01_obligaciones.sql
\i supabase/migrations/20261122T0130_i01_certificados.sql
\i supabase/migrations/20261122T0140_i01_calculo_303.sql
\i supabase/migrations/20261122T0150_i01_presentar.sql
do $$ begin
  if exists (select 1 from _t where to_regclass(n) is null) or exists (select 1 from _f where to_regprocedure(n) is null) then
    raise exception 'PRUEBA vuelta atrás I01a 3: al volver a aplicar falta algo.';
  end if;
  raise notice 'PRUEBA vuelta atrás I01a 3: la tanda se vuelve a aplicar entera.';
end $$;

rollback;
