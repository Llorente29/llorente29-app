-- supabase/staging/sql/20261122_i01_modelo_datos_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0110_i01_modelo_datos (y de la 0100 de
-- plazos, que va antes). Las dos migraciones se aplican DENTRO de la
-- transacción (\i) y todo acaba en ROLLBACK: staging no cambia. Lo de los
-- usuarios va como usuario (role authenticated y su sub), con la empresa de la
-- cuenta A y, de asesoría, la cuenta C (no tiene empresas).
--
--   1. El espejo de tax_forms: lo que había pasa a tax_obligation tal cual; lo
--      que se escribe a la antigua en tax_forms se traduce a obligaciones
--      («añadido» y «quitado», con el motivo que dice que no lo hubo); lo que
--      se escribe en tax_obligation sale en tax_forms y en company_tax_forms.
--   2. Las respuestas del alta se guardan como datos con quién y cuándo; «No
--      lo sé» queda como null; una respuesta que no es sí, no ni «No lo sé», para.
--   3. El estado de una declaración es un dato: los cambios que no valen
--      paran; «No hay que presentarlo» pide motivo; cada cambio queda en
--      tax_return_event, con su texto.
--   4. La asesoría (otra cuenta) no ve nada de la empresa sin consentimiento;
--      con el consentimiento de un administrador de la empresa ve y gestiona;
--      la asesoría no puede darse el consentimiento; al retirarlo deja de ver.
--   5. Del certificado, el front no lee dónde está guardado.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA modelo de datos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Antes: lo que dice hoy tax_forms de cada empresa.
create temp table _antes on commit drop as select company_id, tax_forms from public.company_tax_profile;
-- Y las obligaciones que ya hubiera (si la 0110 ya está aplicada en staging,
-- esta pasada es la segunda: solo cuenta lo que escribe ella).
create temp table _obl_antes (id uuid primary key) on commit drop;
do $$ begin
  if to_regclass('public.tax_obligation') is not null then
    insert into _obl_antes select id from public.tax_obligation;
  end if;
end $$;

\i supabase/migrations/20261122T0100_i01_plazos.sql
\i supabase/migrations/20261122T0110_i01_modelo_datos.sql

-- 1 · El espejo (como el servidor).
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_n int; v_lista text[]; r record;
begin
  -- Lo que había, tal cual.
  -- Cada empresa: su lista de antes (ordenada, solo modelos que existen en tax_form) es la de company_tax_forms.
  select count(*) into v_n from _antes a
   where array(select distinct x from unnest(a.tax_forms) x where exists (select 1 from public.tax_form t where t.code = x) order by 1)
         is distinct from (select f.tax_forms from public.company_tax_forms f where f.company_id = a.company_id);
  if v_n > 0 then raise exception 'PRUEBA modelo 1: % empresas tienen en company_tax_forms otra lista que en tax_forms.', v_n; end if;
  select count(*) into v_n from public.tax_obligation o where not exists (select 1 from _obl_antes a where a.id = o.id);
  raise notice 'PRUEBA modelo 1: % modelos pasan de tax_forms a tax_obligation (% ya estaban).', v_n, (select count(*) from _obl_antes);
  if exists (select 1 from public.company_tax_profile p join _antes a using (company_id) where p.tax_forms is distinct from a.tax_forms) then
    raise exception 'PRUEBA modelo 1: la migración ha cambiado tax_forms de alguna empresa.';
  end if;
  if exists (select 1 from public.tax_obligation o where (o.origin <> 'rule' or o.rule_key <> 'alta_c00')
               and not exists (select 1 from _obl_antes a where a.id = o.id)) then
    raise exception 'PRUEBA modelo 1: lo que había no ha pasado como «lo propuso el alta».';
  end if;

  -- A la antigua: quitar el 115 (si lo tiene) y añadir el 349.
  update public.company_tax_profile set tax_forms = array_remove(tax_forms, '115') || array['349'] where company_id = v_e;
  select * into r from public.tax_obligation where company_id = v_e and form_code = '349' and valid_to is null;
  if r.origin <> 'added' or r.reason not like 'Cambiado en los datos de la empresa, sin motivo%' or not r.active then
    raise exception 'PRUEBA modelo 1: el 349 añadido a la antigua sale %, «%».', r.origin, r.reason;
  end if;
  if exists (select 1 from _antes where company_id = v_e and '115' = any (tax_forms)) then
    select * into r from public.tax_obligation where company_id = v_e and form_code = '115' and valid_to is null;
    if r.origin <> 'removed' or r.active then raise exception 'PRUEBA modelo 1: el 115 quitado a la antigua sale %.', r.origin; end if;
  end if;
  -- La misma lista en otro orden se queda como se escribió (la marca de la IA
  -- compara lo que guardó); un código que no está en tax_form no rompe el
  -- guardado ni pasa a ser una obligación.
  select array_agg(x order by x desc) into v_lista from unnest((select tax_forms from public.company_tax_forms where company_id = v_e)) x;
  update public.company_tax_profile set tax_forms = v_lista where company_id = v_e;
  if (select tax_forms from public.company_tax_profile where company_id = v_e) is distinct from v_lista then
    raise exception 'PRUEBA modelo 1: la misma lista en otro orden no se queda como se escribió: %.', (select tax_forms from public.company_tax_profile where company_id = v_e);
  end if;
  update public.company_tax_profile set tax_forms = v_lista || array['ZZ9'] where company_id = v_e;
  if exists (select 1 from public.tax_obligation where company_id = v_e and form_code = 'ZZ9') then
    raise exception 'PRUEBA modelo 1: un código que no existe se ha vuelto una obligación.';
  end if;
  -- Escribir en tax_obligation sale en tax_forms.
  update public.tax_obligation set valid_to = current_date where company_id = v_e and form_code = '349' and valid_to is null;
  insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, why, reason, decided_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', v_e, '349', 'quarterly', false, 'removed', 'Quitado.', 'Prueba: no hace operaciones con la UE.', 'Prueba');
  select tax_forms into v_lista from public.company_tax_profile where company_id = v_e;
  if '349' = any (v_lista) then raise exception 'PRUEBA modelo 1: tax_forms no sigue a tax_obligation: %.', v_lista; end if;
  if v_lista is distinct from (select tax_forms from public.company_tax_forms where company_id = v_e) then
    raise exception 'PRUEBA modelo 1: tax_forms (%) y company_tax_forms no dicen lo mismo.', v_lista;
  end if;
  -- Quitar o añadir sin motivo, a mano, no entra.
  begin
    insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, why, decided_by_name)
    values ('c01a0000-0000-4000-8000-00000000000a', v_e, '180', 'annual', true, 'added', 'Añadido.', 'Prueba');
    raise exception 'PRUEBA modelo 1: se ha añadido un modelo sin motivo.';
  exception when check_violation then null;
  end;
  raise notice 'PRUEBA modelo 1: lo que había pasa tal cual; lo de antes se traduce a obligaciones y lo nuevo sale en tax_forms.';
end $$;

-- 2 · Las respuestas del alta (como el administrador de la cuenta A).
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; r record; v_n int;
begin
  v_n := public.conta_impuesto_datos_del_alta(v_e, '{"retiene":"si","alquiler":"__nolose","periodo":"quarterly"}');
  if v_n <> 2 then raise exception 'PRUEBA modelo 2: se han guardado % respuestas y eran 2.', v_n; end if;
  select * into r from public.company_tax_facts where company_id = v_e and fact = 'pays_with_withholding';
  if r.value <> 'true'::jsonb or r.origin <> 'alta' or r.said_by <> 'c01a0000-0000-4000-8000-0000000000a1' or r.said_at is null then
    raise exception 'PRUEBA modelo 2: «retiene» se guarda como % / % / %.', r.value, r.origin, r.said_by;
  end if;
  select * into r from public.company_tax_facts where company_id = v_e and fact = 'rents_premises_with_withholding';
  if r.value is not null then raise exception 'PRUEBA modelo 2: «No lo sé» se guarda como %.', r.value; end if;
  begin
    perform public.conta_impuesto_datos_del_alta(v_e, '{"retiene":"quizá"}');
    raise exception 'PRUEBA modelo 2: «quizá» ha valido.';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PRUEBA modelo 2: las respuestas del alta, guardadas con quién y cuándo; «No lo sé», null.';
end $$;
reset role;

-- 3 · El estado como dato (como el servidor).
do $$
declare v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_id uuid; v_n int; v_err text;
begin
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, due_date_direct_debit)
  select 'c01a0000-0000-4000-8000-00000000000a', v_e, '202', 2026, 'instalments_202', '3P', p.presentacion, p.domiciliacion
    from public.conta_impuesto_plazo('202', 'instalments_202', 2026, '3P') p
  returning id into v_id;
  begin
    update public.tax_return set status = 'filed' where id = v_id;
    raise exception 'PRUEBA modelo 3: «Por calcular» ha pasado a «Presentado».';
  exception when sqlstate '22023' then get stacked diagnostics v_err = message_text;
    if v_err <> 'Una declaración no pasa de «Por calcular» a «Presentado».' then raise exception 'PRUEBA modelo 3: mensaje «%».', v_err; end if;
  end;
  begin
    update public.tax_return set status = 'not_required' where id = v_id;
    raise exception 'PRUEBA modelo 3: «No hay que presentarlo» sin motivo.';
  exception when check_violation then null;
  end;
  update public.tax_return set status = 'not_required', not_required_reason = 'La cuota del último Impuesto sobre Sociedades salió a cero.' where id = v_id;
  select count(*) into v_n from public.tax_return_event where tax_return_id = v_id and kind = 'status';
  if v_n <> 2 then raise exception 'PRUEBA modelo 3: % cambios de estado en el registro y eran 2.', v_n; end if;
  if not exists (select 1 from public.tax_return_event where tax_return_id = v_id and to_status = 'not_required'
                  and message = 'No hay que presentarlo: La cuota del último Impuesto sobre Sociedades salió a cero.') then
    raise exception 'PRUEBA modelo 3: el registro no dice el motivo.';
  end if;
  perform set_config('prueba_i01.declaracion', v_id::text, true);
  raise notice 'PRUEBA modelo 3: el estado es un dato; lo que no vale para; «No hay que presentarlo» con motivo; cada cambio, al registro.';
end $$;

-- 4 · La asesoría: la cuenta C, su administrador.
select set_config('request.jwt.claims', '{"sub":"c01c0000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_n int;
begin
  select count(*) into v_n from public.tax_return where company_id = v_e;
  if v_n <> 0 then raise exception 'PRUEBA modelo 4: la asesoría ve % declaraciones sin consentimiento.', v_n; end if;
  select count(*) into v_n from public.tax_obligation where company_id = v_e;
  if v_n <> 0 then raise exception 'PRUEBA modelo 4: la asesoría ve % obligaciones sin consentimiento.', v_n; end if;
  begin
    perform public.conta_impuesto_dato_poner(v_e, 'roi_registered', 'false');
    raise exception 'PRUEBA modelo 4: la asesoría ha cambiado un dato sin consentimiento.';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.conta_impuesto_presentador_poner(v_e, 'advisor', 'c01c0000-0000-4000-8000-00000000000c', 'social_collaborator');
    raise exception 'PRUEBA modelo 4: la asesoría se ha dado el consentimiento a sí misma.';
  exception when sqlstate '42501' then null;
  end;
end $$;
reset role;

-- El administrador de la empresa lo consiente.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.conta_impuesto_presentador_poner('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'advisor', 'c01c0000-0000-4000-8000-00000000000c', 'social_collaborator');
reset role;

select set_config('request.jwt.claims', '{"sub":"c01c0000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_n int;
begin
  select count(*) into v_n from public.tax_return where company_id = v_e;
  if v_n <> 1 then raise exception 'PRUEBA modelo 4: con consentimiento, la asesoría ve % declaraciones (1).', v_n; end if;
  perform public.conta_impuesto_dato_poner(v_e, 'roi_registered', 'false', 'asesoria');
  if not exists (select 1 from public.company_tax_facts where company_id = v_e and fact = 'roi_registered' and origin = 'asesoria'
                  and said_by = 'c01c0000-0000-4000-8000-0000000000c1') then
    raise exception 'PRUEBA modelo 4: el dato de la asesoría no queda con quién lo dijo.';
  end if;
  -- Solo los impuestos: el resto de la empresa sigue siendo de su cuenta.
  select count(*) into v_n from public.company where id = v_e;
  if v_n <> 0 then raise exception 'PRUEBA modelo 4: la asesoría ve la empresa entera.'; end if;
end $$;
reset role;

-- La empresa lo retira.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.conta_impuesto_presentador_retirar('3b34403a-a7d6-4a48-a8d7-737e8cababdc');
reset role;

select set_config('request.jwt.claims', '{"sub":"c01c0000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.tax_return where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  if v_n <> 0 then raise exception 'PRUEBA modelo 4: retirado el consentimiento, la asesoría sigue viendo % declaraciones.', v_n; end if;
  raise notice 'PRUEBA modelo 4: sin consentimiento, nada; con el de la empresa, ve y gestiona sus impuestos (no la empresa entera); retirado, nada.';
end $$;
reset role;

-- 5 · Del certificado, el front no lee dónde está guardado (como el administrador de A).
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform vault_secret_id from public.tax_certificate limit 1;
    raise exception 'PRUEBA modelo 5: el front lee vault_secret_id.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ciphertext from public.tax_certificate limit 1;
    raise exception 'PRUEBA modelo 5: el front lee ciphertext.';
  exception when insufficient_privilege then null;
  end;
  perform subject_name, valid_to, storage, status from public.tax_certificate limit 1;
  begin
    insert into public.tax_certificate_use (certificate_id, owner_account_id, action, result) values (gen_random_uuid(), 'c01a0000-0000-4000-8000-00000000000a', 'test', 'ok');
    raise exception 'PRUEBA modelo 5: el front escribe en el registro de usos.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA modelo 5: del certificado se lee la ficha, no dónde está; el registro de usos no se escribe desde el front.';
end $$;
reset role;

rollback;
