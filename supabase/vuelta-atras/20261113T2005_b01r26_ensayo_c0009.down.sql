-- supabase/vuelta-atras/20261113T2005_b01r26_ensayo_c0009.down.sql
--
-- B01r·26 · LA LIMPIEZA DEL ENSAYO DEL TRASPASO EN LA C0009 (Julio la lanza en
-- modo «vuelta_atras» cuando ha terminado el ensayo). Deja Sumied como antes
-- del ensayo; lo que llegó a la C0009 se queda allí (es la de pruebas):
--   1. Los enlaces de PDF (conta_pdf_llave y sus accesos) y las subcuentas
--      apuntadas como creadas en la C0009, de los traspasos del ensayo.
--   2. Si el ensayo cerró algún mes, se reabre, con su motivo.
--   3. Los traspasos de Foodint hechos durante el ensayo.
--   4. Los envíos a Diez: los nuevos (los que el ensayo creó) fuera; los 242 de
--      antes, exactamente como estaban.
--   5. La conexión, otra vez a la C0008.
--   6. Lo guardado por el ensayo, fuera (la tabla también).
-- Sin ensayo guardado (staging, o si ya se limpió), no hace nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_con constant uuid := '860fcb61-9b95-46da-bc1a-ad73d665f19b';
  v_marca timestamptz; v_envios jsonb; v_n int; v_env int; v_enl int; v_pen int; v_otros int;
begin
  if to_regclass('public.conta_b01r26_ensayo') is null then
    raise notice 'B01r26 limpieza: no hay ensayo guardado: nada que limpiar.';
    return;
  end if;
  execute 'select (valor #>> ''{}'')::timestamptz from public.conta_b01r26_ensayo where clave = ''marca''' into v_marca;
  execute 'select valor from public.conta_b01r26_ensayo where clave = ''envios''' into v_envios;
  if v_marca is null then
    raise notice 'B01r26 limpieza: la tabla del ensayo está vacía: nada que limpiar.';
  else
    -- 1. Enlaces de PDF y subcuentas apuntadas (si sus tablas existen: #662 y #663).
    if to_regclass('public.conta_pdf_llave') is not null then
      execute 'delete from public.conta_pdf_acceso where llave_id in (select k.id from public.conta_pdf_llave k join public.conta_diez_traspaso t on t.id = k.traspaso_id where t.company_id = $1 and t.confirmado_en >= $2)' using v_e, v_marca;
      execute 'delete from public.conta_pdf_llave where traspaso_id in (select t.id from public.conta_diez_traspaso t where t.company_id = $1 and t.confirmado_en >= $2)' using v_e, v_marca;
    end if;
    if to_regclass('public.conta_diez_subcuenta_creada') is not null then
      execute 'delete from public.conta_diez_subcuenta_creada where company_id = $1 and base = ''C0009'' and creada_en >= $2' using v_e, v_marca;
    end if;
    -- 2. Los meses que el ensayo cerró, reabiertos.
    update public.fiscal_period_lock
       set reopened_at = now(), reopened_by_name = 'Limpieza del ensayo en la C0009 (B01r26)',
           reopen_reason = 'Lo cerró el ensayo del traspaso a Diez en la C0009 (B01r26): se reabre al limpiarlo.'
     where company_id = v_e and locked_at >= v_marca and reopened_at is null;
    -- 3. Los traspasos del ensayo.
    delete from public.conta_diez_traspaso where company_id = v_e and confirmado_en >= v_marca;
    -- 4. Los envíos: fuera los nuevos; los de antes, como estaban.
    delete from public.external_send s
     where s.company_id = v_e and s.account_id = v_acc
       and s.id not in (select (x->>'id')::uuid from jsonb_array_elements(v_envios) x);
    update public.external_send s
       set status = o.status, attempts = o.attempts, last_error = o.last_error, ext_year = o.ext_year, ext_series = o.ext_series,
           ext_number = o.ext_number, ext_invoice_number = o.ext_invoice_number, ext_tax_id = o.ext_tax_id, payload_hash = o.payload_hash,
           sent_at = o.sent_at, next_try_at = o.next_try_at, account_connector_id = o.account_connector_id, kind = o.kind,
           document_id = o.document_id, document_status = o.document_status, document_error = o.document_error,
           document_attached_at = o.document_attached_at, document_attached_via = o.document_attached_via,
           document_attached_by = o.document_attached_by, document_attached_by_name = o.document_attached_by_name,
           created_at = o.created_at, updated_at = o.updated_at
      from jsonb_populate_recordset(null::public.external_send, v_envios) o
     where s.id = o.id;
    select count(*) filter (where status = 'enviado'), count(*) filter (where status = 'enlazado'), count(*) filter (where status = 'pendiente'),
           count(*) filter (where status not in ('enviado', 'enlazado', 'pendiente'))
      into v_env, v_enl, v_pen, v_otros
      from public.external_send where company_id = v_e and account_id = v_acc;
    if (v_env, v_enl, v_pen, v_otros) <> (213, 2, 27, 0) then
      raise exception 'B01r26 limpieza: los envíos no han vuelto a como estaban (213, 2, 27, 0): son %, %, %, %.', v_env, v_enl, v_pen, v_otros;
    end if;
    -- 5. La conexión, a la C0008.
    update public.account_connector
       set external_account_id = 'C0008', config = (config - 'ensayo_b01r26') || jsonb_build_object('nombre_bd', 'C0008')
     where id = v_con;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'B01r26 limpieza: no se ha devuelto la conexión a la C0008.'; end if;
  end if;
  -- 6. Lo guardado, fuera.
  drop table public.conta_b01r26_ensayo;
  raise notice 'B01r26 limpieza: Sumied como antes del ensayo; Foodint otra vez en la C0008.';
end $$;
