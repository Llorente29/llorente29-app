-- 20261125T1830_v05_verifactu_pruebas_empresas.sql
--
-- V05 · LAS PRUEBAS DE VERIFACTU DE UNA EMPRESA DE VERDAD, DESDE PRODUCCIÓN,
-- CON SU PROPIO CERTIFICADO (respuesta de Julio al V05, 25/11: el certificado
-- de la empresa vive en el Vault de producción, así que sus pruebas salen de
-- aquí, solo al entorno de pruebas de la AEAT).
--
-- SOLO AÑADE cinco funciones; no toca ninguna de las que existen, ni datos,
-- ni nada del camino del pedido:
--   · verifactu_cert_abrir_pruebas(empresa): para la prueba de conexión.
--   · verifactu_cert_abrir_pruebas_envio(envío): para un envío de pruebas.
--     Las dos, solo la clave de servicio (conta-verifactu), con las mismas
--     condiciones que verifactu_cert_abrir (2341) salvo el entorno: la empresa
--     ha autorizado su certificado para Verifactu, sigue en vigor y está en el
--     Vault; y nunca para una cuenta de demostración.
--   · verifactu_despertar_empresa(empresa, acción): lo que pulsa un
--     administrador o encargado en Ajustes › Verifactu («Probar la conexión»,
--     las facturas de prueba, enviar). Llama a conta-verifactu con
--     {"entorno":"pruebas_empresas"}; la puerta de la función solo la abre con
--     CONTA_VERIFACTU_EMPRESAS = «pruebas:AAAA-MM-DD» de ese día (Julio).
--   · verifactu_conexion_ultima(empresa): la última prueba de conexión de esa
--     empresa, para que la pantalla diga qué pasó (regla 8).
--   · verifactu_pruebas_resumen(empresa): cómo van sus registros de pruebas
--     (cuántos en cada estado, el último rechazo con su código y texto, el
--     último fallo de envío y una aceptada para su QR), para «Enviar a
--     Hacienda» (regla 8).
--
-- El certificado no sale nunca de la base más que hacia conta-verifactu, y el
-- real sigue cerrado: la dirección de producción de Hacienda no está en la
-- lista de destinos del programa (_shared/certificados/mtls.ts).

-- ── Abrir para la prueba de conexión ────────────────────────────────────────
create or replace function public.verifactu_cert_abrir_pruebas(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co public.company; v_emp public.verifactu_empresa; v_a public.verifactu_autorizacion; c public.tax_certificate; v_material text; v_motivo text; v_demo boolean;
begin
  select * into v_co from public.company where id = p_company;
  if v_co.id is null then return jsonb_build_object('ok', false, 'mensaje', 'Esa empresa no está.'); end if;
  select coalesce(a.is_demo, false) into v_demo from public.accounts a where a.id = v_co.account_id;
  select * into v_emp from public.verifactu_empresa where company_id = p_company;
  select * into v_a from public.verifactu_autorizacion where company_id = p_company and retirada_at is null;
  select * into c from public.tax_certificate where id = v_a.certificate_id;
  v_motivo := case
    when coalesce(v_demo, false) then 'Una empresa de demostración no habla con Hacienda.'
    when v_emp.via is distinct from 'certificado' then 'La empresa no envía con su certificado: autorízalo para Verifactu primero.'
    when v_a.id is null then 'La empresa no ha autorizado usar su certificado para Verifactu (o lo ha retirado).'
    when c.id is null or c.status = 'removed' then 'El certificado autorizado se ha quitado: autoriza uno nuevo.'
    when c.valid_to <= now() then 'El certificado autorizado ha caducado: sube uno nuevo y autorízalo.'
    when c.storage <> 'vault' then 'El certificado está en el almacén con clave externa (KMS), que todavía no está preparado.'
    else null end;
  if v_motivo is not null then return jsonb_build_object('ok', false, 'mensaje', v_motivo); end if;
  select decrypted_secret into v_material from vault.decrypted_secrets where id = c.vault_secret_id;
  if v_material is null then return jsonb_build_object('ok', false, 'mensaje', 'El certificado no está en el almacén: vuelve a subirlo.'); end if;
  return jsonb_build_object('ok', true, 'material', v_material, 'autorizacion_id', v_a.id,
    'nif', regexp_replace(upper(btrim(coalesce(v_co.tax_id, ''))), '^ES', ''), 'nombre', coalesce(v_co.legal_name, v_co.trade_name));
end $$;
revoke all on function public.verifactu_cert_abrir_pruebas(uuid) from public, anon, authenticated;
comment on function public.verifactu_cert_abrir_pruebas(uuid) is
  'V05. Solo la clave de servicio (conta-verifactu): abre el certificado que la empresa autorizó para Verifactu, para UNA prueba de conexión con el entorno de pruebas de la AEAT. Nunca para una demo. Para nada más.';

-- ── Abrir para un envío de pruebas ──────────────────────────────────────────
create or replace function public.verifactu_cert_abrir_pruebas_envio(p_envio uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.verifactu_envio; v_emp public.verifactu_empresa; v_r jsonb;
begin
  select * into v_e from public.verifactu_envio where id = p_envio for update;
  if v_e.id is null then return jsonb_build_object('ok', false, 'mensaje', 'Ese envío no está.'); end if;
  if v_e.entorno <> 'pruebas' then return jsonb_build_object('ok', false, 'mensaje', 'Solo se abre para enviar al entorno de pruebas.'); end if;
  select * into v_emp from public.verifactu_empresa where company_id = v_e.company_id;
  if v_emp.modo is distinct from 'pruebas' then return jsonb_build_object('ok', false, 'mensaje', 'La empresa no está en pruebas.'); end if;
  v_r := public.verifactu_cert_abrir_pruebas(v_e.company_id);
  if (v_r->>'ok')::boolean then
    update public.verifactu_envio set autorizacion_id = (v_r->>'autorizacion_id')::uuid where id = p_envio;
  end if;
  return v_r - 'nif' - 'nombre';
end $$;
revoke all on function public.verifactu_cert_abrir_pruebas_envio(uuid) from public, anon, authenticated;
comment on function public.verifactu_cert_abrir_pruebas_envio(uuid) is
  'V05. Solo la clave de servicio (conta-verifactu): abre el certificado autorizado de la empresa para UN envío de pruebas, si la empresa está en pruebas, y apunta la autorización en el envío.';

-- ── Lo que pulsa un administrador ───────────────────────────────────────────
create or replace function public.verifactu_despertar_empresa(p_company uuid, p_accion text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co public.company; v_emp public.verifactu_empresa; v_secreto text; v_id bigint;
begin
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_co.account_id) then raise exception 'Solo un administrador o un encargado de la cuenta prueba Verifactu.' using errcode = '42501'; end if;
  if p_accion not in ('probar_conexion', 'preparar_pruebas', 'enviar') then raise exception 'Eso no se puede pedir.' using errcode = '22023'; end if;
  if exists (select 1 from public.accounts a where a.id = v_co.account_id and a.is_demo) then
    raise exception 'Una empresa de demostración no habla con Hacienda.' using errcode = '42501';
  end if;
  select * into v_emp from public.verifactu_empresa where company_id = p_company;
  if p_accion <> 'probar_conexion' and v_emp.modo is distinct from 'pruebas' then
    raise exception 'Primero pon Verifactu en pruebas.' using errcode = '23514';
  end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-verifactu.' using errcode = '55000';
  end if;
  select net.http_post(
    url := public._project_url() || '/functions/v1/conta-verifactu',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := jsonb_build_object('entorno', 'pruebas_empresas', 'accion', p_accion, 'company_id', p_company),
    timeout_milliseconds := 150000) into v_id;
  return jsonb_build_object('pedido', true, 'accion', p_accion, 'pedido_at', now());
end $$;
revoke all on function public.verifactu_despertar_empresa(uuid, text) from public, anon;
grant execute on function public.verifactu_despertar_empresa(uuid, text) to authenticated;
comment on function public.verifactu_despertar_empresa(uuid, text) is
  'V05. Un administrador o encargado pide a conta-verifactu, para su empresa y solo en el entorno de pruebas: probar la conexión, lanzar las facturas de prueba o enviar. La función solo lo hace si Julio ha abierto ese día (CONTA_VERIFACTU_EMPRESAS); si no, contesta cerrada y no sale nada.';

-- ── La última prueba de conexión de una empresa ─────────────────────────────
create or replace function public.verifactu_conexion_ultima(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_co public.company; v_c public.verifactu_conexion;
begin
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select * into v_c from public.verifactu_conexion c
   where c.entorno = 'pruebas' and c.nif = regexp_replace(upper(btrim(coalesce(v_co.tax_id, ''))), '^ES', '')
   order by c.probada_at desc limit 1;
  if v_c.id is null then return null; end if;
  return jsonb_build_object('ok', v_c.ok, 'codigo', v_c.codigo, 'mensaje', v_c.mensaje, 'probada_at', v_c.probada_at);
end $$;
revoke all on function public.verifactu_conexion_ultima(uuid) from public, anon;
grant execute on function public.verifactu_conexion_ultima(uuid) to authenticated;
comment on function public.verifactu_conexion_ultima(uuid) is
  'V05. La última prueba de conexión con el entorno de pruebas de la AEAT con el NIF de la empresa: si salió bien, qué contestó y cuándo. Para la pantalla.';

-- ── Cómo van los registros de pruebas de una empresa ────────────────────────
create or replace function public.verifactu_pruebas_resumen(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_co public.company; v_res jsonb;
begin
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select jsonb_build_object(
    'total', count(*),
    'pendientes', count(*) filter (where r.estado in ('pendiente', 'enviando')),
    'correctas', count(*) filter (where r.estado = 'correcto'),
    'con_errores', count(*) filter (where r.estado = 'aceptado_con_errores'),
    'rechazadas', count(*) filter (where r.estado = 'incorrecto'),
    'ultimo_rechazo', (select jsonb_build_object('num_serie', x.num_serie, 'codigo', x.codigo_error, 'texto', x.descripcion_error)
                         from public.verifactu_registro x
                        where x.company_id = p_company and x.entorno = 'pruebas' and x.estado = 'incorrecto'
                        order by x.respondido_at desc nulls last limit 1),
    'ultimo_fallo', (select jsonb_build_object('error', left(e.error, 300), 'cuando', e.terminado_at)
                       from public.verifactu_envio e
                      where e.company_id = p_company and e.entorno = 'pruebas' and e.error is not null
                      order by e.empezado_at desc limit 1),
    'para_qr', (select jsonb_build_object('nif', x.nif_emisor, 'num_serie', x.num_serie, 'fecha', to_char(x.fecha_expedicion, 'DD-MM-YYYY'),
                                          'importe', to_char(x.importe_total, 'FM999999999990.00'))
                  from public.verifactu_registro x
                 where x.company_id = p_company and x.entorno = 'pruebas' and x.tipo = 'alta' and x.estado in ('correcto', 'aceptado_con_errores')
                 order by x.respondido_at desc nulls last limit 1))
    into v_res
    from public.verifactu_registro r
   where r.company_id = p_company and r.entorno = 'pruebas';
  return v_res;
end $$;
revoke all on function public.verifactu_pruebas_resumen(uuid) from public, anon;
grant execute on function public.verifactu_pruebas_resumen(uuid) to authenticated;
comment on function public.verifactu_pruebas_resumen(uuid) is
  'V05. Cómo van los registros de PRUEBAS de la empresa: cuántos en cada estado, el último rechazo (código y texto de Hacienda), el último fallo de envío y una aceptada para escanear su QR en el cotejo de pruebas.';
