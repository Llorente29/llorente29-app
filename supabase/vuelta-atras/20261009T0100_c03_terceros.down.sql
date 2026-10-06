-- Vuelta atrás de 20261009T0100_c03_terceros.sql. Antes, la 0110 (o que no
-- quede ningún tercero con otro papel que el de proveedor). PARA si hay
-- clientes, plataformas o socios dados de alta, o cuentas enlazadas a un
-- cliente: perderían su ficha.
do $$
begin
  if exists (select 1 from public.party_role where role <> 'supplier')
     or exists (select 1 from public.company_account_link where entity = 'customer') then
    raise exception 'Hay clientes, plataformas o socios, o cuentas enlazadas a un cliente: no se quita nada.';
  end if;
end $$;

-- El disparador de enlaces, como lo dejó la 0160 del C02 (sin la guarda del cliente).
create or replace function public.company_account_misma_cuenta() returns trigger
language plpgsql set search_path = public as $$
declare v_plantilla text;
begin
  if not exists (select 1 from public.company c where c.id = new.company_id and c.account_id = new.account_id) then
    raise exception 'La empresa no es de esa cuenta.' using errcode = '23514';
  end if;
  if tg_table_name = 'company_account_link' then
    if not exists (select 1 from public.company_account a where a.id = new.company_account_id and a.company_id = new.company_id) then
      raise exception 'Esa cuenta no es de esta empresa.' using errcode = '23514';
    end if;
    -- Un proveedor de OTRA cuenta no se enlaza aquí (regla 9).
    if new.entity = 'supplier' and not exists (select 1 from public.supplier s where s.id::text = new.entity_id and s.account_id = new.account_id) then
      raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '23514';
    end if;
    -- Un tercero, una subcuenta; salvo la común (encargo §3). Solo el papel principal.
    if new.role = 'principal' and new.entity in ('supplier', 'customer', 'bank_account')
       and not (select is_common from public.company_account where id = new.company_account_id)
       and exists (select 1 from public.company_account_link l
                    where l.company_account_id = new.company_account_id and l.id <> new.id and l.role = 'principal'
                      and l.entity in ('supplier', 'customer', 'bank_account')
                      and (l.entity, l.entity_id) is distinct from (new.entity, new.entity_id)) then
      raise exception 'Esa subcuenta ya es de otro tercero, y no es la cuenta común.' using errcode = '23505';
    end if;
    -- Cada papel nuevo, a su grupo: gastos y suplidos al 6; el pago a un banco o caja (57) o a lo que te debe (43).
    select template_code into v_plantilla from public.company_account where id = new.company_account_id;
    if new.role in ('gasto', 'suplidos') and v_plantilla not like '6%' then
      raise exception 'Sus facturas y sus suplidos van a una cuenta de gastos (grupo 6); % no lo es.', v_plantilla using errcode = '23514';
    end if;
    if new.role = 'pago' and v_plantilla not like '57%' and v_plantilla not like '43%' then
      raise exception 'Se le paga desde un banco o caja (57) o compensando con lo que te debe (43); % no lo es.', v_plantilla using errcode = '23514';
    end if;
    -- No se enlaza a una cuenta oculta ni cerrada.
    if (select status from public.company_account where id = new.company_account_id) <> 'activa' then
      raise exception 'Esa cuenta está oculta o cerrada: no se le puede enlazar nada.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_party_desde_proveedor on public.supplier;
drop function if exists public.party_desde_proveedor();
drop table if exists public.customer_fiscal;
drop table if exists public.party_role;
drop table if exists public.party;
drop function if exists public.party_misma_cuenta();
drop function if exists public.party_nif(text);
