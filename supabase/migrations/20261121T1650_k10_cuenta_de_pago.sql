-- supabase/migrations/20261121T1650_k10_cuenta_de_pago.sql
--
-- K10 · La «Cuenta de pago» en la ficha del proveedor, como en ERP10 (Julio, 14/11
-- y 16/11: «la cuenta de pago en la ficha, que no es solo bancaria, p. ej. Glovo
-- o Uber»). La base la guarda en company_account_link, con el papel «pago» del
-- proveedor (entity 'supplier'), por empresa: el papel ya existía para lo mismo
-- (la 43 con la que se compensa a un proveedor), y ya lo leen los saldos de
-- terceros (solo para las cuentas del grupo 4). La ficha lo escribe con
-- company_account_link_set, que deja su rastro en el registro del plan.
--
-- La recibida propone esa cuenta en «Cómo se paga»; si no la hay, la del último
-- pago; si no, vacía. Hasta hoy, en las de una plataforma, proponía la 430 de la
-- plataforma (su papel «platform», que no es contabilidad). Para que esas sigan
-- proponiendo la misma cuenta (regla 31), esta tanda pasa esa 430 a la ficha de
-- su proveedor como cuenta de pago:
--   · a cada proveedor cuyo contacto es una plataforma con su 430 (su enlace
--     'customer' «principal») en una empresa, y que aún no tiene cuenta de pago
--     en esa empresa, se le pone esa 430 con el papel «pago» (source 'manual');
--   · cada enlace que pone queda apuntado en conta_k10_pago_desde_plataforma,
--     para que la vuelta atrás quite esos y solo esos. Lo hace la función
--     conta_k10_pago_desde_plataforma() (se puede pasar dos veces), y se llama aquí una vez.
-- No cambia ningún enlace que ya existe. Lo cuenta k10-cuenta-de-pago.sql.
--
-- cambia: public.conta_recibida_motivos · prueba: supabase/staging/sql/20261121_k10_cuenta_de_pago_prueba.sql
--   K10 · La contrapartida puede ser cualquier subcuenta (la 480, el inmovilizado 21x…): «Falta la
--   cuenta de gasto» (K09) ya no excluye todo el grupo 4, solo la del proveedor (40, 41) y los
--   impuestos (472, 477, 4751). Con la MISMA firma y el cuerpo vigente con un solo trozo cambiado.
--   Respaldo antes, para la vuelta atrás.
--
-- cambia: public.company_account_misma_cuenta · prueba: supabase/staging/sql/20261121_k10_cuenta_de_pago_prueba.sql
--   K10 · La cuenta de pago de un PROVEEDOR, cualquier subcuenta del plan (la 551 de un socio, la 43 de
--   una plataforma, un banco…), como en ERP10: hasta hoy el disparador solo dejaba un 57 o un 43. Solo
--   no deja la del propio proveedor (su enlace «principal»). La de cualquier otro tercero, como estaba
--   (lo del cliente va después: X está con «Cómo se cobra»). Dos trozos, con la MISMA firma; respaldo antes.
--
-- Nada en el camino del pedido: ningún pedido escribe recibidas ni enlaces del plan.
-- Vuelta atrás: supabase/vuelta-atras/20261121T1650_k10_cuenta_de_pago.down.sql

create table if not exists public.conta_k10_pago_desde_plataforma (
  link_id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null,
  supplier_id uuid not null,
  company_account_id uuid not null,
  at timestamptz not null default now()
);
comment on table public.conta_k10_pago_desde_plataforma is
  'K10 · Los enlaces «pago» que la tanda 1650 puso a los proveedores de una plataforma (su 430, que antes se proponía por ser plataforma). Para que la vuelta atrás quite esos y solo esos.';
alter table public.conta_k10_pago_desde_plataforma enable row level security;
revoke all on table public.conta_k10_pago_desde_plataforma from public, anon, authenticated;

create or replace function public.conta_k10_pago_desde_plataforma()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with candidatos as (
    select distinct on (l.company_id, pr.supplier_id)
           l.account_id, l.company_id, pr.supplier_id, l.company_account_id
      from public.party_role pf
      join public.party_role pr on pr.account_id = pf.account_id and pr.party_id = pf.party_id and pr.role = 'supplier' and pr.supplier_id is not null
      join public.company_account_link l on l.account_id = pf.account_id and l.entity = 'customer' and l.entity_id = pf.party_id::text and l.role = 'principal'
      join public.company_account a on a.id = l.company_account_id and a.account_id = l.account_id and a.code like '430%'
     where pf.role = 'platform'
       and not exists (select 1 from public.company_account_link x
                        where x.company_id = l.company_id and x.entity = 'supplier' and x.entity_id = pr.supplier_id::text and x.role = 'pago')
     order by l.company_id, pr.supplier_id, l.created_at
  ), puestos as (
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select c.account_id, c.company_id, c.company_account_id, 'supplier', c.supplier_id::text, 'pago', 'manual' from candidatos c
    on conflict (company_id, entity, entity_id, role) do nothing
    returning id, account_id, company_id, entity_id, company_account_id
  )
  insert into public.conta_k10_pago_desde_plataforma (link_id, account_id, company_id, supplier_id, company_account_id)
  select p.id, p.account_id, p.company_id, p.entity_id::uuid, p.company_account_id from puestos p;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function public.conta_k10_pago_desde_plataforma() is
  'K10 · Pone la 430 de su plataforma como «Cuenta de pago» (company_account_link, papel «pago») a los proveedores de una plataforma que aún no la tienen en esa empresa, y apunta cada enlace en conta_k10_pago_desde_plataforma. Se puede pasar dos veces: la segunda no pone nada. Devuelve cuántos ha puesto.';
revoke all on function public.conta_k10_pago_desde_plataforma() from public, anon, authenticated;

select public.conta_k10_pago_desde_plataforma();

-- La contrapartida, con cualquier subcuenta: el trozo de conta_recibida_motivos (K09) que cambia.
select public._respaldar_funcion('public.conta_recibida_motivos(uuid,uuid)', '20261121T1650_k10_cuenta_de_pago');

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_recibida_motivos(uuid,uuid)'::regprocedure);
  v_viejo text := $viejo$where l.entry_id = p_entry and a.code !~ '^4';$viejo$;
  v_nuevo text := $nuevo$where l.entry_id = p_entry and a.code !~ '^(40|41|472|477|4751)';   -- K10: la 480 y el 21x también son contrapartida$nuevo$;
begin
  if strpos(v_def, 'K10: la 480') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'K10: conta_recibida_motivos no es la medida (la regla de la cuenta de gasto no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;

-- La cuenta de pago del proveedor, cualquier subcuenta: los dos trozos de company_account_misma_cuenta que cambian.
select public._respaldar_funcion('public.company_account_misma_cuenta()', '20261121T1650_k10_cuenta_de_pago');

do $do$
declare
  v_def text := pg_get_functiondef('public.company_account_misma_cuenta()'::regprocedure);
  v_viejo1 text := $v$if new.role = 'pago' and v_plantilla not like '57%' and v_plantilla not like '43%' then$v$;
  v_nuevo1 text := $n$if new.role = 'pago' and new.entity <> 'supplier' and v_plantilla not like '57%' and v_plantilla not like '43%' then   -- K10: al proveedor, cualquier subcuenta$n$;
  v_viejo2 text := $v$-- No se enlaza a una cuenta oculta ni cerrada.$v$;
  v_nuevo2 text := $n$-- K10: la cuenta de pago de un proveedor, cualquier subcuenta menos la suya propia.
    if new.role = 'pago' and new.entity = 'supplier' and exists (
         select 1 from public.company_account_link l
          where l.company_id = new.company_id and l.entity = 'supplier' and l.entity_id = new.entity_id
            and l.role = 'principal' and l.company_account_id = new.company_account_id) then
      raise exception 'Esa es la cuenta del propio proveedor: no se le paga con ella.' using errcode = '23514';
    end if;
    -- No se enlaza a una cuenta oculta ni cerrada.$n$;
begin
  if strpos(v_def, 'K10: al proveedor') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo1, ''))) / length(v_viejo1) <> 1
     or (length(v_def) - length(replace(v_def, v_viejo2, ''))) / length(v_viejo2) <> 1 then
    raise exception 'K10: company_account_misma_cuenta no es la medida (la regla de la cuenta de pago no está una sola vez): no se toca.';
  end if;
  execute replace(replace(v_def, v_viejo1, v_nuevo1), v_viejo2, v_nuevo2);
end $do$;
