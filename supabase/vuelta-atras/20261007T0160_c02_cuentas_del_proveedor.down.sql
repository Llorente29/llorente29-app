-- supabase/vuelta-atras/20261007T0160_c02_cuentas_del_proveedor.down.sql
--
-- Deshace 20261007T0160: quita los papeles propios de un proveedor (gasto,
-- pago, suplidos) y la función de quitarlos, y devuelve el disparador a la
-- regla de la 0120. Se pierden esos enlaces y las entradas «enlace_quitado»
-- del registro: se cuentan antes de borrar.
do $$
declare n int; m int;
begin
  delete from public.company_account_link where role in ('gasto', 'pago', 'suplidos');
  get diagnostics n = row_count;
  delete from public.company_account_log where que = 'enlace_quitado';
  get diagnostics m = row_count;
  raise notice 'Se borran % enlaces propios de proveedor y % entradas «enlace_quitado» del registro.', n, m;
end $$;

drop function if exists public.company_account_link_unset(uuid, text, text, text, text);
alter table public.company_account_link drop constraint if exists company_account_link_papel_de_tercero;
alter table public.company_account_link drop constraint if exists company_account_link_role_check;
alter table public.company_account_link add constraint company_account_link_role_check
  check (role in ('principal', 'soportado', 'repercutido'));
alter table public.company_account_log drop constraint if exists company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check
  check (que in ('activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada',
                 'borrada_duplicada', 'fusionada', 'cerrada', 'palabras_clave', 'subcuenta_deshecha', 'plan_cambiado'));

-- El disparador, tal como lo dejó la 0120.
create or replace function public.company_account_misma_cuenta() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.company c where c.id = new.company_id and c.account_id = new.account_id) then
    raise exception 'La empresa no es de esa cuenta.' using errcode = '23514';
  end if;
  if tg_table_name = 'company_account_link' then
    if not exists (select 1 from public.company_account a where a.id = new.company_account_id and a.company_id = new.company_id) then
      raise exception 'Esa cuenta no es de esta empresa.' using errcode = '23514';
    end if;
    -- Un tercero, una subcuenta; salvo la común (encargo §3).
    if new.entity in ('supplier', 'customer', 'bank_account')
       and not (select is_common from public.company_account where id = new.company_account_id)
       and exists (select 1 from public.company_account_link l
                    where l.company_account_id = new.company_account_id and l.id <> new.id
                      and l.entity in ('supplier', 'customer', 'bank_account')
                      and (l.entity, l.entity_id) is distinct from (new.entity, new.entity_id)) then
      raise exception 'Esa subcuenta ya es de otro tercero, y no es la cuenta común.' using errcode = '23505';
    end if;
    -- No se enlaza a una cuenta oculta ni cerrada.
    if (select status from public.company_account where id = new.company_account_id) <> 'activa' then
      raise exception 'Esa cuenta está oculta o cerrada: no se le puede enlazar nada.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
