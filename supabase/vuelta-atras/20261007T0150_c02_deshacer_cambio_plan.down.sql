-- supabase/vuelta-atras/20261007T0150_c02_deshacer_cambio_plan.down.sql
--
-- Deshace 20261007T0150: quita la guarda del perfil, deshacer y el cambio de
-- plan, y devuelve company_chart_set_digits a la de la 0120. Las entradas del
-- registro de los dos valores nuevos se borran antes, contadas.
do $$
declare n int;
begin
  delete from public.company_account_log where que in ('subcuenta_deshecha', 'plan_cambiado');
  get diagnostics n = row_count;
  raise notice 'Se borran % entradas del registro del plan (deshechas y cambios de plan).', n;
end $$;
drop trigger if exists company_tax_profile_guarda_plan on public.company_tax_profile;
drop function if exists public.company_tax_profile_guarda_plan();
drop function if exists public.company_chart_change_plan(uuid, text, jsonb, text);
drop function if exists public.company_account_undo_add(uuid, text);
alter table public.company_account_log drop constraint if exists company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check
  check (que in ('activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada',
                 'borrada_duplicada', 'fusionada', 'cerrada', 'palabras_clave'));

create or replace function public.company_chart_set_digits(p_company uuid, p_digitos int, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid := public.conta_ia_cuenta(p_company);
  v_de int; n int;
begin
  if p_digitos not between 6 and 12 then raise exception 'La longitud tiene que ir de 6 a 12 dígitos.' using errcode = '22023'; end if;
  if public.company_account_length_locked(p_company) then
    raise exception 'Ya hay asientos: la longitud de las cuentas no se puede cambiar.' using errcode = '22023';
  end if;
  select account_digits into v_de from public.company_tax_profile where company_id = p_company for update;
  if v_de = p_digitos then return jsonb_build_object('renumeradas', 0); end if;
  if exists (select 1 from public.company_account a where a.company_id = p_company
              and length(ltrim(substr(a.code, length(a.template_code) + 1), '0')) > p_digitos - length(a.template_code)) then
    raise exception 'Alguna subcuenta no cabe en % dígitos.', p_digitos using errcode = '22023';
  end if;
  -- Un solo paso: los códigos viejos y los nuevos tienen distinta longitud,
  -- así que no pueden chocar a mitad de camino.
  update public.company_account a
     set code = a.template_code || lpad(coalesce(nullif(ltrim(substr(a.code, length(a.template_code) + 1), '0'), ''), '0'), p_digitos - length(a.template_code), '0'),
         updated_at = now()
   where company_id = p_company;
  get diagnostics n = row_count;
  update public.company_tax_profile set account_digits = p_digitos, updated_at = now(), updated_by = auth.uid() where company_id = p_company;
  insert into public.company_account_log (account_id, company_id, que, detalle, antes, despues, source, done_by, done_by_name)
  values (v_cuenta, p_company, 'longitud_cambiada', format('Las cuentas pasan de %s a %s dígitos: %s renumeradas.', v_de, p_digitos, n),
          jsonb_build_object('digitos', v_de), jsonb_build_object('digitos', p_digitos, 'renumeradas', n), 'manual', auth.uid(), p_quien_nombre);
  return jsonb_build_object('renumeradas', n);
end $$;
