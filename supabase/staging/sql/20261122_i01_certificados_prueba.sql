-- supabase/staging/sql/20261122_i01_certificados_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0130_i01_certificados (la 0100, la 0110 y
-- la 0120 ya están aplicadas en staging). La 0130 se aplica DENTRO de la
-- transacción (\i) y todo acaba en ROLLBACK: staging no cambia, y el secreto
-- que se crea en el Vault se va con el ROLLBACK.
--
-- El «certificado» es texto inventado con forma de PEM: aquí no se lee, solo
-- se guarda, se abre y se quita. Leer y validar un .p12 de verdad lo prueban
-- las pruebas unitarias de _shared/certificados (con uno generado al vuelo).
--
-- Staging no tiene la cuenta de Foodint. Para el camino que guarda se crea
-- DENTRO de la transacción una cuenta con su id (y se va con el ROLLBACK).
--
--   1. Con el Vault, una cuenta que no es Foodint no guarda: mensaje claro, y
--      ni ficha ni secreto. Y desde el front no se puede llamar a guardar.
--   2. Foodint: guarda (el material va al Vault y la ficha a la tabla, con
--      «puede presentar» para quien lo sube y el uso «upload»). No guarda
--      quien no es administrador, ni el mismo certificado dos veces, ni uno
--      caducado. El texto de custodia del Vault no promete «tampoco en Sumied».
--   3. El front no lee el Vault.
--   4. El token de un solo uso: de otra persona, no; el bueno abre una vez y
--      solo una; caducado, no. Cada «no» queda apuntado. Cerrar un uso de
--      prueba deja «probado» en la ficha.
--   5. Permisos: «solo ver» no presenta; «puede presentar», sí.
--   6. «Quitar ahora»: solo un administrador; borra el secreto, la ficha queda
--      retirada, el registro se queda y ya no se puede confirmar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA certificados: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/migrations/20261122T0130_i01_certificados.sql

create temp table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated;
insert into _p values ('material', '{"cert":"-----BEGIN CERTIFICATE-----\nPRUEBAI01aNOESUNCERTIFICADODEVERDADPRUEBAI01aNOESUNCERTIFICADODEVERDAD\n-----END CERTIFICATE-----\n","key":"-----BEGIN PRIVATE KEY-----\nPRUEBAI01aNOESUNACLAVEDEVERDADPRUEBAI01aNOESUNACLAVEDEVERDAD\n-----END PRIVATE KEY-----\n"}');
insert into _p values ('ficha', jsonb_build_object(
  'subject_name', 'EMPRESA DE PRUEBA I01A SL', 'subject_tax_id_hash', repeat('a', 64), 'subject_tax_id_tail', '00X',
  'issuer', 'Emisor de prueba', 'serial', '0a0b0c', 'valid_from', (now() - interval '30 days')::text, 'valid_to', (now() + interval '300 days')::text,
  'fingerprint_sha256', repeat('b', 64), 'kind', 'legal_representative')::text);

-- 1 · Con el Vault, solo Foodint.
do $$
declare v_err text; v_secretos int := (select count(*) from vault.secrets);
begin
  begin
    perform public.conta_cert_guardar('c01a0000-0000-4000-8000-0000000000a1', 'c01a0000-0000-4000-8000-00000000000a',
                                      (select val::jsonb from _p where k = 'ficha'), (select val from _p where k = 'material'));
    raise exception 'PRUEBA certificados 1: se ha guardado un certificado en una cuenta que no es Foodint.';
  exception when insufficient_privilege then get stacked diagnostics v_err = message_text;
  end;
  if v_err <> 'Todavía no se pueden guardar certificados en esta cuenta: falta el almacén con clave externa (KMS), y hasta que esté solo se admite la cuenta de Foodint. No se ha guardado nada.' then
    raise exception 'PRUEBA certificados 1: el mensaje es «%».', v_err;
  end if;
  if (select count(*) from vault.secrets) <> v_secretos or exists (select 1 from public.tax_certificate) then
    raise exception 'PRUEBA certificados 1: sin guardar, ha quedado un secreto o una ficha.';
  end if;
  raise notice 'PRUEBA certificados 1: fuera de Foodint no se guarda nada: «%».', v_err;
end $$;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_cert_guardar('c01a0000-0000-4000-8000-0000000000a1', '51ad1792-6629-4ef7-833a-b57b09a86710', '{}'::jsonb, 'x');
    raise exception 'PRUEBA certificados 1: el front llama a conta_cert_guardar.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_cert_abrir(gen_random_uuid(), 'c01a0000-0000-4000-8000-0000000000a1');
    raise exception 'PRUEBA certificados 1: el front llama a conta_cert_abrir.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA certificados 1: guardar y abrir no se pueden llamar desde el front.';
end $$;
reset role;

-- 2 · Foodint (la cuenta con su id, solo dentro de esta transacción).
insert into public.accounts (id, name, slug) values ('51ad1792-6629-4ef7-833a-b57b09a86710', 'Prueba I01a (no es Foodint)', 'prueba-i01a-vault');
insert into public.user_profiles (user_id, account_id, role, active, display_name) values
  ('c01a0000-0000-4000-8000-0000000000a1', '51ad1792-6629-4ef7-833a-b57b09a86710', 'admin', true, 'Administradora de prueba'),
  ('c01b0000-0000-4000-8000-0000000000b1', '51ad1792-6629-4ef7-833a-b57b09a86710', 'worker', true, 'Persona de prueba');
do $$
declare v jsonb; c public.tax_certificate; v_err text; v_ficha jsonb := (select val::jsonb from _p where k = 'ficha');
begin
  v := public.conta_cert_guardar('c01a0000-0000-4000-8000-0000000000a1', '51ad1792-6629-4ef7-833a-b57b09a86710', v_ficha, (select val from _p where k = 'material'));
  select * into c from public.tax_certificate where id = (v->>'id')::uuid;
  if c.storage <> 'vault' or c.vault_secret_id is null or c.status <> 'active' or c.uploaded_by_name <> 'Administradora de prueba' then
    raise exception 'PRUEBA certificados 2: la ficha queda %.', row_to_json(c);
  end if;
  if (select decrypted_secret from vault.decrypted_secrets where id = c.vault_secret_id) <> (select val from _p where k = 'material') then
    raise exception 'PRUEBA certificados 2: lo que hay en el Vault no es lo que se guardó.';
  end if;
  if not exists (select 1 from public.tax_certificate_grant where certificate_id = c.id and user_id = 'c01a0000-0000-4000-8000-0000000000a1' and permission = 'file' and revoked_at is null)
     or not exists (select 1 from public.tax_certificate_use where certificate_id = c.id and action = 'upload' and result = 'ok') then
    raise exception 'PRUEBA certificados 2: falta el permiso de quien lo sube o el uso «upload».';
  end if;
  if v->>'custodia' like '%tampoco en Sumied%' or public.conta_cert_custodia('kms') not like '%tampoco en Sumied%' then
    raise exception 'PRUEBA certificados 2: el texto de custodia no depende del almacén: «%».', v->>'custodia';
  end if;
  insert into _p values ('cert', c.id::text);
  -- Quien no es administrador, no.
  begin
    perform public.conta_cert_guardar('c01b0000-0000-4000-8000-0000000000b1', '51ad1792-6629-4ef7-833a-b57b09a86710',
                                      v_ficha || '{"fingerprint_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}', (select val from _p where k = 'material'));
    raise exception 'PRUEBA certificados 2: lo ha guardado quien no es administrador.';
  exception when insufficient_privilege then get stacked diagnostics v_err = message_text;
    if v_err <> 'Solo un administrador de la cuenta puede subir un certificado.' then raise exception 'PRUEBA certificados 2: mensaje «%».', v_err; end if;
  end;
  -- El mismo, dos veces, no.
  begin
    perform public.conta_cert_guardar('c01a0000-0000-4000-8000-0000000000a1', '51ad1792-6629-4ef7-833a-b57b09a86710', v_ficha, (select val from _p where k = 'material'));
    raise exception 'PRUEBA certificados 2: se ha guardado el mismo certificado dos veces.';
  exception when unique_violation then null;
  end;
  -- Caducado, no.
  begin
    perform public.conta_cert_guardar('c01a0000-0000-4000-8000-0000000000a1', '51ad1792-6629-4ef7-833a-b57b09a86710',
      v_ficha || jsonb_build_object('fingerprint_sha256', repeat('d', 64), 'valid_from', (now() - interval '400 days')::text, 'valid_to', (now() - interval '1 day')::text),
      (select val from _p where k = 'material'));
    raise exception 'PRUEBA certificados 2: se ha guardado un certificado caducado.';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'PRUEBA certificados 2: Foodint guarda (material al Vault, ficha a la tabla); no guarda quien no es administrador, ni repetido, ni caducado. Custodia: «%».', v->>'custodia';
end $$;

-- 3 · El front no lee el Vault, y 4 · el token (lo pide la administradora).
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform 1 from vault.decrypted_secrets limit 1;
    raise exception 'PRUEBA certificados 3: el front lee vault.decrypted_secrets.';
  exception when insufficient_privilege then null;
  end;
  insert into _p values ('token', public.conta_cert_confirmar((select val::uuid from _p where k = 'cert'), 'test')::text);
  raise notice 'PRUEBA certificados 3: el front no lee el Vault.';
end $$;
reset role;
do $$
declare v jsonb; v_cert uuid := (select val::uuid from _p where k = 'cert'); v_token uuid := (select val::uuid from _p where k = 'token');
begin
  v := public.conta_cert_abrir(v_token, 'c01b0000-0000-4000-8000-0000000000b1');
  if (v->>'ok')::boolean or v->>'mensaje' <> 'Esa confirmación es de otra persona.' then raise exception 'PRUEBA certificados 4: con el token de otra persona sale %.', v; end if;
  v := public.conta_cert_abrir(v_token, 'c01a0000-0000-4000-8000-0000000000a1');
  if not (v->>'ok')::boolean or v->>'material' <> (select val from _p where k = 'material') then raise exception 'PRUEBA certificados 4: el token bueno no abre: %.', v->>'mensaje'; end if;
  insert into _p values ('uso', v->>'uso_id');
  if (select message from public.tax_certificate_use where id = (v->>'uso_id')::uuid) not like 'Sin terminar%' then
    raise exception 'PRUEBA certificados 4: el uso abierto no queda «sin terminar».';
  end if;
  v := public.conta_cert_abrir(v_token, 'c01a0000-0000-4000-8000-0000000000a1');
  if (v->>'ok')::boolean or v->>'mensaje' not like 'Esa confirmación ya se usó%' then raise exception 'PRUEBA certificados 4: el token se usa dos veces: %.', v; end if;
  perform public.conta_cert_uso_terminar((select val::uuid from _p where k = 'uso'), 'ok', 'Probado con Hacienda: el certificado funciona.', null);
  if (select last_test_result from public.tax_certificate where id = v_cert) <> 'ok' then raise exception 'PRUEBA certificados 4: la ficha no dice que se probó.'; end if;
  begin
    perform public.conta_cert_uso_terminar((select val::uuid from _p where k = 'uso'), 'error', 'Otra vez.', null);
    raise exception 'PRUEBA certificados 4: un uso se cierra dos veces.';
  exception when no_data_found then null;
  end;
  if (select count(*) from public.tax_certificate_use where certificate_id = v_cert and result = 'denied') <> 2 then
    raise exception 'PRUEBA certificados 4: los «no» no han quedado apuntados.';
  end if;
  raise notice 'PRUEBA certificados 4: el token de otra persona no abre; el bueno, una vez; los dos «no», apuntados; probado, en la ficha.';
end $$;

-- 5 · Permisos: «solo ver» no presenta; «puede presentar», sí. Y caducado, no.
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.conta_cert_confirmar((select val::uuid from _p where k = 'cert'), 'file');
  raise exception 'PRUEBA certificados 5: sin permiso se confirma.';
exception when insufficient_privilege then null;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if public.conta_cert_permiso((select val::uuid from _p where k = 'cert'), 'c01b0000-0000-4000-8000-0000000000b1', 'view') <> 'Ahora puede verlo, pero no presentar.' then
    raise exception 'PRUEBA certificados 5: el mensaje de «solo ver» no es el esperado.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.conta_cert_confirmar((select val::uuid from _p where k = 'cert'), 'file');
  raise exception 'PRUEBA certificados 5: con «solo ver» se confirma.';
exception when insufficient_privilege then null;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.conta_cert_permiso((select val::uuid from _p where k = 'cert'), 'c01b0000-0000-4000-8000-0000000000b1', 'file');
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  insert into _p values ('token_b', public.conta_cert_confirmar((select val::uuid from _p where k = 'cert'), 'file')::text);
end $$;
reset role;
do $$
declare v jsonb;
begin
  update public.tax_certificate_confirmation set created_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes'
   where id = (select val::uuid from _p where k = 'token_b');
  v := public.conta_cert_abrir((select val::uuid from _p where k = 'token_b'), 'c01b0000-0000-4000-8000-0000000000b1');
  if (v->>'ok')::boolean or v->>'mensaje' not like 'Esa confirmación ha caducado%' then raise exception 'PRUEBA certificados 5: un token caducado abre: %.', v; end if;
  raise notice 'PRUEBA certificados 5: sin permiso y con «solo ver», no; con «puede presentar», sí; y el token caducado no abre.';
end $$;

-- 6 · Quitar ahora.
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.conta_cert_quitar((select val::uuid from _p where k = 'cert'));
  raise exception 'PRUEBA certificados 6: quita el certificado quien no es administrador.';
exception when insufficient_privilege then null;
end $$;
reset role;
create temp table _secreto on commit drop as select vault_secret_id as id from public.tax_certificate where id = (select val::uuid from _p where k = 'cert');
grant all on _secreto to authenticated;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_msg text;
begin
  v_msg := public.conta_cert_quitar((select val::uuid from _p where k = 'cert'));
  if v_msg not like 'Quitado.%' then raise exception 'PRUEBA certificados 6: quitar dice «%».', v_msg; end if;
  begin
    perform public.conta_cert_confirmar((select val::uuid from _p where k = 'cert'), 'test');
    raise exception 'PRUEBA certificados 6: un certificado quitado se confirma.';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'PRUEBA certificados 6: «%»', v_msg;
end $$;
reset role;
do $$
declare c public.tax_certificate;
begin
  select * into c from public.tax_certificate where id = (select val::uuid from _p where k = 'cert');
  if c.status <> 'removed' or c.vault_secret_id is not null or c.removed_by_name <> 'Administradora de prueba' then raise exception 'PRUEBA certificados 6: la ficha queda %.', row_to_json(c); end if;
  if exists (select 1 from vault.secrets where id = (select id from _secreto)) then raise exception 'PRUEBA certificados 6: el secreto sigue en el Vault.'; end if;
  if (select count(*) from public.tax_certificate_use where certificate_id = c.id) < 5 then raise exception 'PRUEBA certificados 6: se ha perdido el registro de usos.'; end if;
  if exists (select 1 from public.tax_certificate_confirmation where certificate_id = c.id and used_at is null) then raise exception 'PRUEBA certificados 6: queda un token vivo.'; end if;
  raise notice 'PRUEBA certificados 6: secreto borrado del Vault, ficha retirada, % usos en el registro, ningún token vivo.', (select count(*) from public.tax_certificate_use where certificate_id = c.id);
end $$;

rollback;
