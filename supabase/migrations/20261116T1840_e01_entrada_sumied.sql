-- supabase/migrations/20261116T1840_e01_entrada_sumied.sql
-- cambia: public.company_inbound_address · prueba: supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql
-- cambia: public.conta_entrada_correo · prueba: supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql
-- cambia: public.conta_direccion_entrada · prueba: supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql
-- cambia: public.conta_direccion_facturas · prueba: supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql
-- cambia: public.conta_correo_facturas · prueba: supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql
-- cambia: public.conta_puerta · prueba: supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql
-- cambia: public.conta_documentos_recibidos · prueba: supabase/staging/sql/20261116_e01_entrada_sumied_prueba.sql
--
-- E01 · Las facturas de los clientes de Sumied entran por @entrada.sumied.com.
-- Medido en producción (solo lectura) el 16/11: 5 direcciones, todas en
-- entrada.folvy.app; la base fijaba el dominio en conta_direccion_entrada y en
-- conta_direccion_facturas (el valor por defecto de la columna y el bucle de
-- repetidas), y una empresa solo podía tener una dirección de cada clase
-- (único company_id + kind).
--
--   1. _conta_dominio_entrada(empresa): LA regla, una sola, en la base. Una
--      empresa usa entrada.sumied.com si su cuenta es de marca Sumied
--      (product_brand no nulo) o si la lleva un despacho de marca Sumied con
--      permiso vivo (company_tax_presenter sin revocar). Si no, entrada.folvy.app.
--   2. _conta_direccion_empresa(empresa): LA dirección de esta empresa, la que
--      leen todas las pantallas: la de su dominio; la de documentos si la tiene,
--      si no la de facturas. Las de otro dominio siguen vivas y no se enseñan.
--   3. Una empresa puede tener la misma clase de dirección en dos dominios:
--      el único pasa a ser company_id + kind + domain (se crea el nuevo antes de
--      quitar el de antes).
--   4. inbound_email_log.resend_account: por qué cuenta de Resend entró cada
--      correo ('folvy' o 'sumied'), para pedirlo otra vez a la misma. Vacío =
--      los de antes, que son de la de Folvy.
--   5. Crear las direcciones (conta_direccion_entrada y conta_direccion_facturas)
--      usa el dominio de la regla; Correo de facturas (conta_correo_facturas),
--      Documentos (conta_puerta) y Documentos recibidos
--      (conta_documentos_recibidos) leen la dirección de _conta_direccion_empresa.
--   6. Las direcciones de los clientes de Sumied (al final de este fichero):
--      cada empresa cuyo dominio es entrada.sumied.com y tiene una dirección en
--      entrada.folvy.app recibe la MISMA (misma clase, nombre, empresa y
--      cuenta) en entrada.sumied.com, encendida. La de entrada.folvy.app no se
--      toca: sigue encendida y ya no se enseña. Medido el 16/11: son las 3 de
--      Piri Piri (facturas-piripiri-espana, facturas-frango-takeaway y
--      facturas-piripiri-prosperidad), cuyas sociedades lleva un despacho de
--      marca Sumied con permiso vivo. Las 2 de Foodint (cuenta Folvy, sin
--      despacho) quedan fuera por la regla, y además se comprueba. Solo añade
--      filas; si ya están, no hace nada. Va en este fichero, no en otro, porque
--      depende de la regla: en staging, lo que solo añade se aplica de verdad
--      desde la rama, y sin la regla no se puede pasar.
-- Misma firma, sobre la definición VIVA, con su respaldo. Los datos, solo el 6 (añade filas).
-- Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261116T1840_e01_entrada_sumied.down.sql

-- 1 · La regla del dominio.
create or replace function public._conta_dominio_entrada(p_company uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case
    when exists (select 1 from public.company c join public.accounts a on a.id = c.account_id
                  where c.id = p_company and a.product_brand is not null)
      or exists (select 1 from public.company_tax_presenter t join public.accounts d on d.id = t.advisor_account_id
                  where t.company_id = p_company and t.revoked_at is null and d.product_brand is not null)
    then 'entrada.sumied.com' else 'entrada.folvy.app' end
$$;
revoke all on function public._conta_dominio_entrada(uuid) from public, anon, authenticated;
comment on function public._conta_dominio_entrada(uuid) is 'E01 · El dominio de entrada de una empresa: entrada.sumied.com si su cuenta es de marca Sumied o la lleva un despacho de marca Sumied con permiso vivo; si no, entrada.folvy.app. La única regla: de ella beben la creación de direcciones y todas las pantallas.';

-- 2 · La dirección de esta empresa (una sola fuente).
create or replace function public._conta_direccion_empresa(p_company uuid)
returns public.company_inbound_address language sql stable security definer set search_path to 'public' as $$
  select a.* from public.company_inbound_address a
   where a.company_id = p_company and a.kind in ('documentos', 'facturas')
     and lower(a.domain) = public._conta_dominio_entrada(p_company)
   order by (a.kind = 'documentos') desc
   limit 1
$$;
revoke all on function public._conta_direccion_empresa(uuid) from public, anon, authenticated;
comment on function public._conta_direccion_empresa(uuid) is 'E01 · La dirección de entrada que se enseña de una empresa: la de su dominio (_conta_dominio_entrada), la de documentos si la tiene y si no la de facturas. Las de otro dominio siguen recibiendo y no se enseñan.';

-- 3 · La misma clase en dos dominios.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'company_inbound_address_company_kind_domain_key') then
    alter table public.company_inbound_address add constraint company_inbound_address_company_kind_domain_key unique (company_id, kind, domain);
  end if;
end $$;
alter table public.company_inbound_address drop constraint if exists company_inbound_address_company_id_kind_key;

-- 4 · Por qué cuenta de Resend entró cada correo.
alter table public.inbound_email_log add column if not exists resend_account text
  constraint inbound_email_log_resend_account_check check (resend_account is null or resend_account in ('folvy', 'sumied'));
comment on column public.inbound_email_log.resend_account is 'E01 · La cuenta de Resend por la que entró el correo (folvy o sumied): «Volver a leer» y «Poner el PDF» lo piden otra vez a esa. Vacío: los de antes del E01, de la de Folvy.';

-- 5 · Las funciones, sobre la definición viva.
select public._respaldar_funcion('public.conta_entrada_correo(jsonb)', '20261116T1840_e01_entrada_sumied');
select public._respaldar_funcion('public.conta_direccion_entrada(uuid,text,text)', '20261116T1840_e01_entrada_sumied');
select public._respaldar_funcion('public.conta_direccion_facturas(uuid,text)', '20261116T1840_e01_entrada_sumied');
select public._respaldar_funcion('public.conta_correo_facturas(uuid)', '20261116T1840_e01_entrada_sumied');
select public._respaldar_funcion('public.conta_puerta(uuid,integer)', '20261116T1840_e01_entrada_sumied');
select public._respaldar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261116T1840_e01_entrada_sumied');

do $$
declare v_def text; v_f text;
  -- Cambia en v_def un trozo que tiene que estar UNA sola vez; si no, no se cambia nada.
  v_cambios jsonb := '[]'::jsonb; x jsonb; v_n int;
begin
  v_cambios := jsonb_build_array(
    -- conta_entrada_correo: apunta la cuenta de Resend (la primera que se sabe se queda).
    jsonb_build_array('public.conta_entrada_correo(jsonb)',
      'insert into public.inbound_email_log (email_id, to_address, from_address, subject, company_id, account_id, outcome, detail)',
      'insert into public.inbound_email_log (email_id, to_address, from_address, subject, company_id, account_id, outcome, detail, resend_account)'),
    jsonb_build_array('public.conta_entrada_correo(jsonb)',
      'p->>''resultado'', coalesce(p->''detalle'', ''{}''::jsonb))',
      'p->>''resultado'', coalesce(p->''detalle'', ''{}''::jsonb),
          -- E01 · Por qué cuenta de Resend entró (folvy o sumied).
          nullif(p->>''cuenta_resend'', ''''))'),
    jsonb_build_array('public.conta_entrada_correo(jsonb)',
      'on conflict (email_id) do update set outcome = excluded.outcome, detail = excluded.detail;',
      'on conflict (email_id) do update set outcome = excluded.outcome, detail = excluded.detail,
    resend_account = coalesce(inbound_email_log.resend_account, excluded.resend_account);'),
    -- conta_direccion_entrada: la que ya tiene es la de su dominio; las nuevas, en su dominio.
    jsonb_build_array('public.conta_direccion_entrada(uuid,text,text)',
      'select * into v_x from public.company_inbound_address where company_id = p_company and kind = p_tipo;',
      'select * into v_x from public.company_inbound_address where company_id = p_company and kind = p_tipo
     and lower(domain) = public._conta_dominio_entrada(p_company); -- E01 · la de su dominio'),
    jsonb_build_array('public.conta_direccion_entrada(uuid,text,text)',
      'where lower(local_part) = v_lp and domain = ''entrada.folvy.app'') loop',
      'where lower(local_part) = v_lp and lower(domain) = public._conta_dominio_entrada(p_company)) loop'),
    jsonb_build_array('public.conta_direccion_entrada(uuid,text,text)',
      '(account_id, company_id, kind, local_part, created_by, created_by_name)',
      '(account_id, company_id, kind, local_part, domain, created_by, created_by_name)'),
    jsonb_build_array('public.conta_direccion_entrada(uuid,text,text)',
      'values (v_c.account_id, v_c.id, p_tipo, v_lp, auth.uid(), p_quien_nombre)',
      'values (v_c.account_id, v_c.id, p_tipo, v_lp, public._conta_dominio_entrada(p_company), auth.uid(), p_quien_nombre)'),
    -- conta_direccion_facturas (la de antes de la V02): igual.
    jsonb_build_array('public.conta_direccion_facturas(uuid,text)',
      'select * into v_x from public.company_inbound_address where company_id = p_company and kind = ''facturas'';',
      'select * into v_x from public.company_inbound_address where company_id = p_company and kind = ''facturas''
     and lower(domain) = public._conta_dominio_entrada(p_company); -- E01 · la de su dominio'),
    jsonb_build_array('public.conta_direccion_facturas(uuid,text)',
      'where lower(local_part) = v_lp and domain = ''entrada.folvy.app'') loop',
      'where lower(local_part) = v_lp and lower(domain) = public._conta_dominio_entrada(p_company)) loop'),
    jsonb_build_array('public.conta_direccion_facturas(uuid,text)',
      '(account_id, company_id, local_part, created_by, created_by_name)',
      '(account_id, company_id, local_part, domain, created_by, created_by_name)'),
    jsonb_build_array('public.conta_direccion_facturas(uuid,text)',
      'values (v_c.account_id, v_c.id, v_lp, auth.uid(), p_quien_nombre)',
      'values (v_c.account_id, v_c.id, v_lp, public._conta_dominio_entrada(p_company), auth.uid(), p_quien_nombre)'),
    -- conta_correo_facturas: la dirección de esta empresa.
    jsonb_build_array('public.conta_correo_facturas(uuid)',
      'select * into a from company_inbound_address where company_id = p_company and kind = ''facturas'';',
      'a := public._conta_direccion_empresa(p_company); -- E01 · la dirección de esta empresa (una sola fuente)'),
    -- conta_puerta: las direcciones de su dominio, y la de esta empresa.
    jsonb_build_array('public.conta_puerta(uuid,integer)',
      'from public.company_inbound_address a where a.company_id = p_company), ''[]''::jsonb),',
      'from public.company_inbound_address a where a.company_id = p_company
                               and lower(a.domain) = public._conta_dominio_entrada(p_company)), ''[]''::jsonb),
    -- E01 · La dirección de esta empresa (una sola fuente, la misma que Correo de facturas).
    ''direccion'', (select case when d.id is not null then jsonb_build_object(''tipo'', d.kind, ''direccion'', d.local_part || ''@'' || d.domain, ''activa'', d.active) end
                    from public._conta_direccion_empresa(p_company) d),'),
    -- conta_documentos_recibidos: la dirección de esta empresa.
    jsonb_build_array('public.conta_documentos_recibidos(uuid,date,date)',
      'from public.company_inbound_address a where a.company_id = p_company and a.account_id = v_acc',
      'from public._conta_direccion_empresa(p_company) a where a.id is not null and a.account_id = v_acc -- E01 · una sola fuente')
  );
  -- Se puede pasar dos veces: una función que ya lleva lo del E01 (su marca, «E01 ·») no se vuelve a cambiar.
  v_f := null;
  for x in select * from jsonb_array_elements(v_cambios) loop
    if v_f is distinct from x->>0 then
      if v_f is not null and v_def is not null then execute v_def; end if;
      v_f := x->>0;
      v_def := pg_get_functiondef(v_f::regprocedure);
      if position('E01 ·' in v_def) > 0 then v_def := null; end if;
    end if;
    continue when v_def is null;
    v_n := (length(v_def) - length(replace(v_def, x->>1, ''))) / length(x->>1);
    if v_n <> 1 then raise exception 'E01: % no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada. Trozo: %', v_f, v_n, x->>1; end if;
    v_def := replace(v_def, x->>1, x->>2);
  end loop;
  if v_def is not null then execute v_def; end if;
end $$;

-- 6 · Las direcciones de los clientes de Sumied, en @entrada.sumied.com.
insert into public.company_inbound_address (account_id, company_id, kind, local_part, domain, active, created_by_name)
select f.account_id, f.company_id, f.kind, f.local_part, 'entrada.sumied.com', true, 'Tanda E01 · entrada.sumied.com'
  from public.company_inbound_address f
 where lower(f.domain) = 'entrada.folvy.app'
   and public._conta_dominio_entrada(f.company_id) = 'entrada.sumied.com'
   and not exists (select 1 from public.company_inbound_address x
                    where (x.company_id = f.company_id and x.kind = f.kind and lower(x.domain) = 'entrada.sumied.com')
                       or (lower(x.local_part) = lower(f.local_part) and lower(x.domain) = 'entrada.sumied.com'));

-- Foodint (cuenta Folvy, sin despacho) no puede tener ninguna en entrada.sumied.com.
do $$ begin
  if exists (select 1 from public.company_inbound_address
              where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and lower(domain) <> 'entrada.folvy.app') then
    raise exception 'E01 · 1840: Foodint tiene una dirección fuera de entrada.folvy.app. No se toca nada.';
  end if;
end $$;
