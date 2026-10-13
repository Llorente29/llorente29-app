-- supabase/staging/sql/20261019_diez_documento_compartido_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261019T0130 antes del real: el fichero entero y
-- su prueba (20261019_diez_documento_compartido_prueba.sql) dentro de UNA
-- transacción que acaba en ROLLBACK. Va primero en el manifiesto: si falla,
-- el real no se aplica. Generado copiando los dos ficheros tal cual.

begin;

-- 1 y 2. La unicidad por asiento. Primero la nueva, después se quita la vieja.
create unique index if not exists external_document_sha_entry_uq
  on public.external_document (company_id, sha256, entry_id) nulls not distinct
  where sha256 is not null;
drop index if exists public.external_document_sha_uq;

-- 3. «no_requiere»: el CHECK de estados solo se amplía.
alter table public.external_document drop constraint if exists external_document_status_check;
alter table public.external_document add constraint external_document_status_check
  check (status in ('enlazado', 'revisar', 'pendiente_diez', 'no_requiere'));
alter table public.external_document add constraint external_document_no_requiere_check
  check (status <> 'no_requiere' or (entry_id is not null and storage_path is null and reason is not null));

comment on index public.external_document_sha_entry_uq is 'El mismo fichero no se enlaza dos veces al mismo asiento; sí a varios (Glovo: expedida y recibida con el mismo PDF).';
comment on column public.external_document.status is 'enlazado (fichero y asiento) · revisar (fichero que no casa, con porqué) · pendiente_diez (asiento sin fichero, se reintenta) · no_requiere (asiento que no lleva PDF propio, con porqué).';


select set_config('prueba.a', 'c01a0000-0000-4000-8000-00000000000a', true);
select set_config('prueba.empresa', '567b0264-7895-47b3-b9f9-81fae8a4aa2c', true);
select set_config('prueba.ejercicio', 'dec0f1cb-6e6f-42ce-9780-e70071c063a8', true);

-- ── 1 · Los índices ────────────────────────────────────────────────────────────
do $$ begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'external_document_sha_uq') then
    raise exception 'PRUEBA documento compartido · 1: external_document_sha_uq sigue existiendo.';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'external_document_sha_entry_uq') then
    raise exception 'PRUEBA documento compartido · 1: falta external_document_sha_entry_uq.';
  end if;
  raise notice 'PRUEBA documento compartido · 1: fuera external_document_sha_uq; está external_document_sha_entry_uq.';
end $$;

-- Tres asientos traídos de Diez: la expedida y la recibida de Glovo, y otro.
do $$
declare v_a uuid := current_setting('prueba.a')::uuid; v_e uuid := current_setting('prueba.empresa')::uuid;
        v_y uuid := current_setting('prueba.ejercicio')::uuid; v_id uuid;
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                    external_program, external_year, external_series, external_number)
  values (v_a, v_e, v_y, 1, '2026-09-15', 'Expedida (prueba)', 'migrated', 'borrador', 'diez', '2023', '1', '9') returning id into v_id;
  perform set_config('prueba.exp', v_id::text, true);
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                    external_program, external_year, external_series, external_number)
  values (v_a, v_e, v_y, 1, '2026-09-15', 'Recibida (prueba)', 'migrated', 'borrador', 'diez', '2023', '2', '14') returning id into v_id;
  perform set_config('prueba.rec', v_id::text, true);
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                    external_program, external_year, external_series, external_number)
  values (v_a, v_e, v_y, 1, '2026-09-15', 'Resumen de ventas (prueba)', 'migrated', 'borrador', 'diez', '2023', '1', '500') returning id into v_id;
  perform set_config('prueba.tique', v_id::text, true);
end $$;

-- ── 2, 3, 4 y 5 · El mismo fichero ─────────────────────────────────────────────
do $$
declare v_a uuid := current_setting('prueba.a')::uuid; v_e uuid := current_setting('prueba.empresa')::uuid;
        v_exp uuid := current_setting('prueba.exp')::uuid; v_rec uuid := current_setting('prueba.rec')::uuid;
begin
  insert into public.external_document (account_id, company_id, source, status, entry_id, invoice_kind, storage_path, sha256)
  values (v_a, v_e, 'diez_zip', 'enlazado', v_exp, 'expedida', 'x/sha-glovo.pdf', 'sha-glovo');
  insert into public.external_document (account_id, company_id, source, status, entry_id, invoice_kind, storage_path, sha256)
  values (v_a, v_e, 'diez_zip', 'enlazado', v_rec, 'recibida', 'x/sha-glovo.pdf', 'sha-glovo');
  if (select count(*) from public.external_document where sha256 = 'sha-glovo') <> 2 then
    raise exception 'PRUEBA documento compartido · 2: el mismo fichero no se ha enlazado a los dos asientos.';
  end if;
  raise notice 'PRUEBA documento compartido · 2: el mismo fichero respalda la expedida y la recibida, con un solo storage_path.';

  begin
    insert into public.external_document (account_id, company_id, source, status, entry_id, storage_path, sha256, reason)
    values (v_a, v_e, 'diez_zip', 'revisar', v_exp, 'x/sha-glovo.pdf', 'sha-glovo', 'otra vez');
    raise exception 'PRUEBA documento compartido · 3: el mismo fichero se ha enlazado dos veces al mismo asiento.';
  exception when unique_violation then null;
  end;
  raise notice 'PRUEBA documento compartido · 3: el mismo fichero no se enlaza dos veces al mismo asiento.';

  insert into public.external_document (account_id, company_id, source, status, storage_path, sha256, reason)
  values (v_a, v_e, 'diez_zip', 'revisar', 'x/sha-suelto.pdf', 'sha-suelto', 'ninguna factura con esa clave');
  begin
    insert into public.external_document (account_id, company_id, source, status, storage_path, sha256, reason)
    values (v_a, v_e, 'diez_zip', 'revisar', 'x/sha-suelto.pdf', 'sha-suelto', 'el mismo, repetido en el zip');
    raise exception 'PRUEBA documento compartido · 4: el mismo fichero sin asiento ha entrado dos veces.';
  exception when unique_violation then null;
  end;
  raise notice 'PRUEBA documento compartido · 4: un fichero sin asiento, una vez (los nombres repetidos de septiembre).';

  begin
    insert into public.external_document (account_id, company_id, source, status, entry_id, storage_path, sha256)
    values (v_a, v_e, 'diez_zip', 'enlazado', v_exp, 'x/otro.pdf', 'sha-otro');
    raise exception 'PRUEBA documento compartido · 5: un asiento ha quedado con dos documentos vivos.';
  exception when unique_violation then null;
  end;
  raise notice 'PRUEBA documento compartido · 5: un asiento, un documento vivo como mucho.';
end $$;

-- ── 6 y 7 · Los estados ────────────────────────────────────────────────────────
do $$
declare v_a uuid := current_setting('prueba.a')::uuid; v_e uuid := current_setting('prueba.empresa')::uuid;
        v_t uuid := current_setting('prueba.tique')::uuid; v_rec uuid := current_setting('prueba.rec')::uuid;
begin
  begin
    insert into public.external_document (account_id, company_id, source, status, entry_id) values (v_a, v_e, 'diez_zip', 'no_requiere', v_t);
    raise exception 'PRUEBA documento compartido · 6: «no_requiere» sin porqué ha entrado.';
  exception when check_violation then null;
  end;
  begin
    insert into public.external_document (account_id, company_id, source, status, entry_id, storage_path, sha256, reason)
    values (v_a, v_e, 'diez_zip', 'no_requiere', v_t, 'x/t.pdf', 'sha-t', 'resumen de ventas del día');
    raise exception 'PRUEBA documento compartido · 6: «no_requiere» con fichero ha entrado.';
  exception when check_violation then null;
  end;
  begin
    insert into public.external_document (account_id, company_id, source, status, reason) values (v_a, v_e, 'diez_zip', 'no_requiere', 'sin asiento');
    raise exception 'PRUEBA documento compartido · 6: «no_requiere» sin asiento ha entrado.';
  exception when check_violation then null;
  end;
  insert into public.external_document (account_id, company_id, source, status, entry_id, invoice_kind, reason)
  values (v_a, v_e, 'diez_zip', 'no_requiere', v_t, 'expedida', 'resumen de ventas del día: no lleva PDF propio');
  raise notice 'PRUEBA documento compartido · 6: «no_requiere» va con asiento, sin fichero y con su porqué.';

  begin
    insert into public.external_document (account_id, company_id, source, status) values (v_a, v_e, 'diez_zip', 'perdido');
    raise exception 'PRUEBA documento compartido · 7: un estado inventado ha entrado.';
  exception when check_violation then null;
  end;
  delete from public.external_document where entry_id = v_rec;
  insert into public.external_document (account_id, company_id, source, status, entry_id, invoice_kind, reason)
  values (v_a, v_e, 'diez_api', 'pendiente_diez', v_rec, 'recibida', 'factura de plataforma: la traerá el robot de portales (E04)');
  raise notice 'PRUEBA documento compartido · 7: pendiente_diez, revisar y enlazado siguen valiendo; un estado inventado no.';
end $$;

rollback;
