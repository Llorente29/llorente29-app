-- supabase/vuelta-atras/20261107T1925_g01c_crm_y_contactos.down.sql
--
-- G01c · La vuelta atrás de la 1925: todo como antes. conta_crm se quita
-- (conta_crm_bitrix, su espejo, tiene al día la fila de Bitrix24: su dirección
-- en Vault, su mapa de las empresas y lo medido); fichas, clientes y diferencias, con bitrix_id como clave (se
-- rellena de id_externo donde una lectura nueva lo dejó vacío); las vistas de
-- consulta y las seis funciones, como estaban (del respaldo).
-- Lo que vino de los contactos se quita de las fichas y de «Pendiente de
-- revisar» (es lo leído del CRM: la lectura de antes no lo vuelve a traer). Los
-- clientes que salieron de un contacto se quedan como clientes de Sumied, sin
-- ficha del CRM: no se borra ningún cliente. Los datos fiscales de un RIF (tipo
-- «foreign», país VE) se quedan: son correctos con o sin esta tanda. El mapa de
-- los contactos, lo medido y lo leído de los contactos se pierden (se miden y
-- se leen otra vez; el mapa se vuelve a confirmar).
-- sin prueba con datos: la prueba de staging (20261107_g01c_crm_y_contactos_prueba.sql) la pasa en ROLLBACK, con contactos y personas de contacto ya guardados, y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

drop function if exists public.conta_crm_guardar_clientes(uuid, text, jsonb);
drop function if exists public.conta_crm_guardar_personas(uuid, text, jsonb);
drop function if exists public.conta_crm_confirmar_mapa(uuid, text, text, jsonb);
drop function if exists public.conta_crm_aplicar_union(uuid, text);

-- Las vistas de consulta, como estaban (sin sus columnas nuevas: hay que quitarlas y crearlas otra vez).
drop view if exists public.conta_consulta_clientes;
drop view if exists public.conta_consulta_diferencias;

-- Las diferencias.
delete from public.conta_gestoria_diferencia where tipo in ('contacto_solo_negociacion', 'contacto_empresa_con_datos');
update public.conta_gestoria_diferencia set bitrix_id = id_externo where bitrix_id is null and crm = 'bitrix24' and tipo_ficha = 'empresa';
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'bitrix_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada']));
alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_ficha_check;
alter table public.conta_gestoria_diferencia drop column if exists id_externo;
alter table public.conta_gestoria_diferencia drop column if exists tipo_ficha;
alter table public.conta_gestoria_diferencia drop column if exists crm;

-- Los clientes: los de un contacto, sin ficha del CRM (su id chocaría con el de una empresa); los demás, con su bitrix_id.
update public.conta_gestoria_cliente set bitrix_id = null where tipo_ficha = 'contacto' or crm <> 'bitrix24';
update public.conta_gestoria_cliente set bitrix_id = id_externo where bitrix_id is null and crm = 'bitrix24' and tipo_ficha = 'empresa';
update public.conta_gestoria_cliente set forma_pago_bitrix = forma_pago_crm, emisor_segun_bitrix = emisor_segun_crm where crm = 'bitrix24';
alter table public.conta_gestoria_cliente drop constraint if exists conta_gestoria_cliente_ficha_key;
alter table public.conta_gestoria_cliente drop constraint if exists conta_gestoria_cliente_tipo_check;
alter table public.conta_gestoria_cliente drop column if exists emisor_segun_crm;
alter table public.conta_gestoria_cliente drop column if exists forma_pago_crm;
alter table public.conta_gestoria_cliente drop column if exists id_externo;
alter table public.conta_gestoria_cliente drop column if exists tipo_ficha;
alter table public.conta_gestoria_cliente drop column if exists crm;

-- Las fichas: fuera las de los contactos (y las de otro CRM); las de las empresas, con su bitrix_id como clave.
delete from public.conta_gestoria_ficha where tipo_ficha = 'contacto' or crm <> 'bitrix24';
update public.conta_gestoria_ficha set bitrix_id = id_externo where bitrix_id is null;
alter table public.conta_gestoria_ficha drop constraint if exists conta_gestoria_ficha_pkey;
alter table public.conta_gestoria_ficha alter column bitrix_id set not null;
alter table public.conta_gestoria_ficha add constraint conta_gestoria_ficha_pkey primary key (account_id, bitrix_id);
alter table public.conta_gestoria_ficha drop constraint if exists conta_gestoria_ficha_tipo_check;
alter table public.conta_gestoria_ficha drop column if exists de_empresa;
alter table public.conta_gestoria_ficha drop column if exists id_externo;
alter table public.conta_gestoria_ficha drop column if exists tipo_ficha;
alter table public.conta_gestoria_ficha drop column if exists crm;

-- conta_crm se va: conta_crm_bitrix, su espejo, tiene la fila de Bitrix24 al día (dirección en Vault, mapa de las empresas y lo medido).
drop trigger if exists conta_crm_bitrix_a_crm on public.conta_crm_bitrix;
drop trigger if exists conta_crm_a_bitrix on public.conta_crm;
drop function if exists public._conta_crm_desde_bitrix();
drop function if exists public._conta_crm_a_bitrix();
drop table if exists public.conta_crm;
comment on table public.conta_crm_bitrix is 'G01 · El Bitrix24 de una cuenta (uno para todos sus emisores). La dirección con su clave, en Vault (url_ref, «conta_bitrix:<cuenta>»); portal: solo el nombre del portal, sin clave. mapa: el de campos (UF_CRM_… → Sumied), propuesto con crm.company.fields; campos_medidos: lo que devolvió.';

-- Las vistas de consulta, como estaban.
create view public.conta_consulta_clientes with (security_invoker = true) as
 SELECT c.account_id AS cuenta_id,
    c.party_id AS cliente_id,
    p.name AS cliente,
    p.tax_id AS nif,
    c.situacion,
    c.servicios,
    c.forma_pago_bitrix AS forma_de_pago_en_bitrix,
    e.id AS emisor_id,
    COALESCE(e.trade_name, e.legal_name) AS emisor,
    cc.forma_cobro AS forma_de_cobro,
    cc.gc_cliente_id AS cliente_en_gocardless,
    ( SELECT m.estado
           FROM conta_gc_mandato m
          WHERE m.company_id = e.id AND m.gc_cliente_id = cc.gc_cliente_id
          ORDER BY m.creado DESC NULLS LAST
         LIMIT 1) AS mandato,
    ( SELECT count(*) AS count
           FROM conta_linea l
          WHERE l.party_id = c.party_id AND l.company_id = e.id AND l.tipo = 'cuota'::text AND l.desde <= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date AND (l.hasta IS NULL OR l.hasta >= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date)) AS lineas_de_alta,
    ( SELECT sum(conta_linea_al_mes(l.id, date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date)) AS sum
           FROM conta_linea l
          WHERE l.party_id = c.party_id AND l.company_id = e.id) AS al_mes_en_sumied,
    ( SELECT sum(s.al_mes) AS sum
           FROM conta_gc_suscripcion s
             JOIN conta_gc_cliente g ON g.company_id = s.company_id AND g.gc_id = s.gc_cliente_id
          WHERE g.party_id = c.party_id AND s.company_id = e.id AND s.estado = 'active'::text) AS al_mes_en_gocardless,
    ( SELECT max(b.fecha) AS max
           FROM conta_gc_cobro b
             JOIN conta_gc_mandato m ON m.company_id = b.company_id AND m.gc_id = b.mandato_gc_id
          WHERE m.gc_cliente_id = cc.gc_cliente_id AND b.company_id = e.id) AS ultimo_cobro,
    ( SELECT count(*) AS count
           FROM conta_gestoria_diferencia d
          WHERE d.party_id = c.party_id AND d.vigente) AS diferencias,
    c.cuenta_propia_account_id AS cuenta_propia_id,
    c.leido_at AS leido_de_bitrix
   FROM conta_gestoria_cliente c
     JOIN party p ON p.id = c.party_id
     LEFT JOIN company e ON e.account_id = c.account_id
     LEFT JOIN conta_cobro_cliente cc ON cc.party_id = c.party_id AND cc.company_id = e.id;
create view public.conta_consulta_diferencias with (security_invoker = true) as
 SELECT d.account_id AS cuenta_id,
    d.id AS diferencia_id,
    d.tipo,
    d.porque_codigo,
    d.porque,
    d.datos,
    d.party_id AS cliente_id,
    p.name AS cliente,
    COALESCE(e.trade_name, e.legal_name) AS emisor,
    d.bitrix_id AS ficha_en_bitrix,
    d.gc_cliente_id AS cliente_en_gocardless,
    l.empezada_at AS leida_el
   FROM conta_gestoria_diferencia d
     JOIN conta_gestoria_lectura l ON l.id = d.lectura_id
     LEFT JOIN party p ON p.id = d.party_id
     LEFT JOIN company e ON e.id = d.company_id
  WHERE d.vigente;
revoke all on public.conta_consulta_clientes, public.conta_consulta_diferencias from public, anon, authenticated;
grant select on public.conta_consulta_clientes, public.conta_consulta_diferencias to authenticated;
grant all on public.conta_consulta_clientes, public.conta_consulta_diferencias to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on public.conta_consulta_clientes, public.conta_consulta_diferencias to conta_lectura; end if;
end $$;

-- Las seis funciones, como estaban (del respaldo), y fuera la del nombre.
select public._restaurar_funcion('public.conta_bitrix_guardar_clientes(uuid,jsonb)', '20261107T1925_g01c_crm_y_contactos');
select public._restaurar_funcion('public.conta_bitrix_confirmar_mapa(uuid,jsonb)', '20261107T1925_g01c_crm_y_contactos');
select public._restaurar_funcion('public.conta_bitrix_aplicar_union(uuid)', '20261107T1925_g01c_crm_y_contactos');
select public._restaurar_funcion('public.conta_bitrix_guardar_conexion(uuid,text,text,text,text)', '20261107T1925_g01c_crm_y_contactos');
select public._restaurar_funcion('public.conta_bitrix_secreto(uuid)', '20261107T1925_g01c_crm_y_contactos');
select public._restaurar_funcion('public.conta_gestoria_despertar()', '20261107T1925_g01c_crm_y_contactos');
drop function if exists public._conta_crm_nombre(text);
