-- supabase/migrations/20261118T2029_q05_interruptor_nucleo.sql
--
-- Q05 · «Pantallas nuevas (en pruebas)» en la ficha de la cuenta (administración de la
-- plataforma): el interruptor del núcleo, conta_nucleo (feature_flags, por cuenta), al lado de
-- Contabilidad, Impuestos y Laboral (S01f, 20261031T1706). Hasta hoy no había dónde encenderlo:
-- las dos funciones de la ficha solo conocían las tres claves de la S01f.
--
-- cambia: public.conta_interruptores_de_cuenta · prueba: supabase/staging/sql/20261118_q05_interruptor_nucleo_prueba.sql
-- cambia: public.conta_interruptor_cambiar · prueba: supabase/staging/sql/20261118_q05_interruptor_nucleo_prueba.sql
--   Las dos con la MISMA firma (create or replace, sin parámetros nuevos: regla 2) y el cuerpo de
--   la 20261031T1706 con solo esto distinto:
--     · conta_interruptores_de_cuenta enseña también conta_nucleo, el cuarto;
--     · conta_interruptor_cambiar lo admite; sin «Contabilidad» encendida no se enciende (la regla
--       de siempre: vale para todo lo que no es conta), y apagar «Contabilidad» apaga también
--       conta_nucleo (Julio, 18/11), como Impuestos y Laboral. Nunca borra nada.
--
--   Respaldo antes, para la vuelta atrás (_respaldar_funcion): la vuelta atrás las restaura tal
--   como estaban en producción, no desde una copia a mano.
--
-- No toca ningún dato: el interruptor se enciende desde la pantalla. Nada en el camino del pedido.

select public._respaldar_funcion('public.conta_interruptores_de_cuenta(uuid)', '20261118T2029_q05_interruptor_nucleo');
select public._respaldar_funcion('public.conta_interruptor_cambiar(uuid,text,boolean,text)', '20261118T2029_q05_interruptor_nucleo');

create or replace function public.conta_interruptores_de_cuenta(p_account uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_lista jsonb;
  v_datos jsonb;
begin
  if not public.current_user_is_admin() then
    raise exception 'Solo un administrador de la plataforma ve los interruptores de una cuenta.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', c.clave,
           'encendida', coalesce(f.enabled, false),
           'existe', f.account_id is not null,
           'cambiada', f.updated_at,
           'quien', pa.full_name,
           'motivo', nullif(trim(f.grant_reason), '')
         ) order by c.orden), '[]'::jsonb)
    into v_lista
    from (values ('conta', 1), ('conta_impuestos', 2), ('conta_laboral', 3), ('conta_nucleo', 4)) as c(clave, orden)
    left join feature_flags f on f.account_id = p_account and f.feature_key = c.clave
    left join lateral (select full_name from platform_admins where user_id = f.granted_by order by active desc limit 1) pa on true;

  -- Lo que se deja de ver al apagar la contabilidad (regla 9: todo por account_id).
  select jsonb_build_object(
           'asientos', (select count(*) from journal_entry where account_id = p_account),
           'facturas_recibidas', (select count(*) from supplier_invoice where account_id = p_account),
           'impuestos', (select count(*) from tax_return where account_id = p_account))
    into v_datos;

  return jsonb_build_object('interruptores', v_lista, 'datos', v_datos);
end;
$$;

create or replace function public.conta_interruptor_cambiar(p_account uuid, p_clave text, p_encender boolean, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_motivo  text := trim(coalesce(p_motivo, ''));
  v_cuenta  text;
  v_claves  text[];
  v_clave   text;
  v_antes   boolean;
  v_hechos  jsonb := '[]'::jsonb;
begin
  if not public.current_user_is_admin() then
    raise exception 'Solo un administrador de la plataforma enciende o apaga Sumied en una cuenta.' using errcode = '42501';
  end if;
  if p_clave is null or p_clave not in ('conta', 'conta_impuestos', 'conta_laboral', 'conta_nucleo') then
    raise exception 'Ese interruptor no es de Sumied: %.', coalesce(p_clave, '(ninguno)') using errcode = '22023';
  end if;
  if p_encender is null then
    raise exception 'Falta si se enciende o se apaga.' using errcode = '22023';
  end if;
  if v_motivo = '' then
    raise exception 'Falta el motivo: una línea, que queda en la auditoría.' using errcode = '22023';
  end if;
  select name into v_cuenta from accounts where id = p_account;
  if v_cuenta is null then
    raise exception 'No existe esa cuenta.' using errcode = '22023';
  end if;

  if p_encender and p_clave <> 'conta'
     and not exists (select 1 from feature_flags where account_id = p_account and feature_key = 'conta' and enabled) then
    raise exception 'Enciende antes la contabilidad.' using errcode = '22023';
  end if;

  -- Apagar la contabilidad apaga las cuatro (Q05: también «Pantallas nuevas»); lo demás, solo la suya.
  v_claves := case when not p_encender and p_clave = 'conta'
                   then array['conta', 'conta_impuestos', 'conta_laboral', 'conta_nucleo'] else array[p_clave] end;

  foreach v_clave in array v_claves loop
    select enabled into v_antes from feature_flags where account_id = p_account and feature_key = v_clave;
    v_antes := coalesce(v_antes, false);
    continue when v_antes = p_encender;

    insert into feature_flags (account_id, feature_key, enabled, source, granted_by, grant_reason)
    values (p_account, v_clave, p_encender, 'manual_grant', auth.uid(), v_motivo)
    on conflict (account_id, feature_key) do update
       set enabled = excluded.enabled, source = 'manual_grant', granted_by = excluded.granted_by,
           grant_reason = excluded.grant_reason, expires_at = null;

    perform public.log_platform_event('account_feature_changed', p_account, null,
      jsonb_build_object('interruptor', v_clave, 'de', v_antes, 'a', p_encender, 'motivo', v_motivo,
                         'por', case when v_clave = p_clave then 'pedido' else 'al apagar la contabilidad' end));

    v_hechos := v_hechos || jsonb_build_object('clave', v_clave, 'de', v_antes, 'a', p_encender);
  end loop;

  return jsonb_build_object('cuenta', v_cuenta, 'cambiados', v_hechos);
end;
$$;

revoke all on function public.conta_interruptores_de_cuenta(uuid) from public, anon;
revoke all on function public.conta_interruptor_cambiar(uuid, text, boolean, text) from public, anon;
grant execute on function public.conta_interruptores_de_cuenta(uuid) to authenticated;
grant execute on function public.conta_interruptor_cambiar(uuid, text, boolean, text) to authenticated;

comment on function public.conta_interruptores_de_cuenta(uuid) is
  'S01f · Q05 · Los cuatro interruptores de Sumied de una cuenta (con «Pantallas nuevas», conta_nucleo), encendido, desde cuándo, quién y por qué, y lo que tiene dentro. Solo administrador de la plataforma.';
comment on function public.conta_interruptor_cambiar(uuid, text, boolean, text) is
  'S01f · Q05 · Enciende o apaga un interruptor de Sumied (conta, conta_impuestos, conta_laboral, conta_nucleo) con su motivo y su apunte en platform_audit_log. Apagar conta apaga los cuatro. Solo administrador de la plataforma.';
