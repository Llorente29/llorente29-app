-- supabase/migrations/20261121T1800_x25_cuenta_de_cobro.sql
--
-- cambia: public.company_account_misma_cuenta() · prueba: supabase/staging/sql/20261121_x25_cuenta_de_cobro_prueba.sql
--
-- X25 · La «Cuenta de cobro» en la ficha del cliente, como en ERP10 (Julio, 19/11: el cobro va por cuenta contable,
-- no solo por el banco). Se guarda como la «Cuenta de pago» del proveedor del K10 (1650): en company_account_link,
-- con el papel «pago» del cliente (entity 'customer', el tercero), por empresa, con company_account_link_set. El papel
-- ya lo admite la restricción para el cliente; lo que no dejaba era el disparador: al cliente, solo un 57 o un 43.
-- Esta migración abre el disparador para el cliente, con los mismos dos trozos que el K10 abrió para el proveedor:
--   · al cliente, cualquier subcuenta del plan en «pago» (la 430 de una plataforma, la 551 de un socio, un banco…);
--   · nunca la suya propia (su enlace «principal»): «Esa es la cuenta del propio cliente: no se le cobra con ella.».
-- Con la MISMA firma (es la función de un disparador), la que vive hoy (su guarda md5 para si no es) con solo esos dos
-- trozos cambiados; la de antes, respaldada (_respaldar_funcion) y devuelta por la vuelta atrás. No toca ningún enlace.
-- Nada en el camino del pedido: ningún pedido escribe enlaces del plan. El real lo lanza Julio.

do $guarda$
declare v text := (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.company_account_misma_cuenta()'));
begin
  if v is distinct from 'a1e037b1945cefa738868a9b39ab60c5' then
    raise exception 'X25 · 1800: company_account_misma_cuenta no es la que se midió (huella a1e037b1945cefa738868a9b39ab60c5, viva %): PARA.', coalesce(v, 'no existe');
  end if;
end $guarda$;

select public._respaldar_funcion('public.company_account_misma_cuenta()', '20261121T1800_x25_cuenta_de_cobro');

CREATE OR REPLACE FUNCTION public.company_account_misma_cuenta()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    -- C03: un cliente es un tercero de esta cuenta.
    if new.entity = 'customer' and not exists (select 1 from public.party p where p.id::text = new.entity_id and p.account_id = new.account_id) then
      raise exception 'Ese cliente no es de esta cuenta.' using errcode = '23514';
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
    if new.role = 'pago' and new.entity not in ('supplier', 'customer') and v_plantilla not like '57%' and v_plantilla not like '43%' then   -- K10: al proveedor, cualquier subcuenta; X25: al cliente, también
      raise exception 'Se le paga desde un banco o caja (57) o compensando con lo que te debe (43); % no lo es.', v_plantilla using errcode = '23514';
    end if;
    -- K10: la cuenta de pago de un proveedor, cualquier subcuenta menos la suya propia.
    if new.role = 'pago' and new.entity = 'supplier' and exists (
         select 1 from public.company_account_link l
          where l.company_id = new.company_id and l.entity = 'supplier' and l.entity_id = new.entity_id
            and l.role = 'principal' and l.company_account_id = new.company_account_id) then
      raise exception 'Esa es la cuenta del propio proveedor: no se le paga con ella.' using errcode = '23514';
    end if;
    -- X25: la cuenta de cobro de un cliente, cualquier subcuenta menos la suya propia.
    if new.role = 'pago' and new.entity = 'customer' and exists (
         select 1 from public.company_account_link l
          where l.company_id = new.company_id and l.entity = 'customer' and l.entity_id = new.entity_id
            and l.role = 'principal' and l.company_account_id = new.company_account_id) then
      raise exception 'Esa es la cuenta del propio cliente: no se le cobra con ella.' using errcode = '23514';
    end if;
    -- No se enlaza a una cuenta oculta ni cerrada.
    if (select status from public.company_account where id = new.company_account_id) <> 'activa' then
      raise exception 'Esa cuenta está oculta o cerrada: no se le puede enlazar nada.' using errcode = '23514';
    end if;
  end if;
  return new;
end $function$;
