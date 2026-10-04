-- ============================================================================
-- C01b · 0100 · ESTRUCTURA (solo añade)
-- ----------------------------------------------------------------------------
-- Encargo C01b §3 y respuesta 1 de Julio (docs/conta/encargos/).
--
-- 1. supplier.usual_tax_rate_ids: los IVA habituales del proveedor pasan de ser
--    porcentajes sueltos (usual_vat_rates numeric[]) a REFERENCIAS a tax_rate
--    (C00). Decisión 8. La columna vieja se borra en el fichero de eliminación.
--    Un array no admite clave ajena: lo comprueba un disparador (cada id existe
--    en tax_rate y es de serie o de la misma cuenta). Que esté VIGENTE lo
--    vigila el agente «Datos maestros e impuestos», no el disparador: un tipo
--    que caduca no puede romper el guardado de una ficha vieja.
-- 2. supplier.invoicing_frequency: cómo le llegan las facturas (por albarán,
--    semanal, quincenal, mensual, otra). Decisión 1, pestaña «Pago». Es un
--    dato nuevo: lo que la pantalla vieja llamaba «Cómo factura» es
--    iva_incluido_en_linea (IVA dentro de la línea o al pie), que se queda
--    igual y va en la misma pestaña.
-- 3. c01b_movimiento_registro: lo que mueve el fichero de datos (0110), fila a
--    fila, para la prueba «antes = después» y para su vuelta atrás.
-- ============================================================================

alter table public.supplier
  add column if not exists usual_tax_rate_ids uuid[] not null default '{}',
  add column if not exists invoicing_frequency text
    check (invoicing_frequency is null or invoicing_frequency in ('per_delivery', 'weekly', 'fortnightly', 'monthly', 'other'));

comment on column public.supplier.usual_tax_rate_ids is
  'C01b. IVA habituales del proveedor: ids de tax_rate (de serie o de la cuenta). Sustituye a usual_vat_rates.';
comment on column public.supplier.invoicing_frequency is
  'C01b. Cómo le llegan las facturas: per_delivery (con cada albarán), weekly, fortnightly, monthly u other.';

create or replace function public.supplier_tax_rates_ok()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_malos int;
begin
  if new.usual_tax_rate_ids is null or cardinality(new.usual_tax_rate_ids) = 0 then
    return new;
  end if;
  select count(*) into v_malos
    from unnest(new.usual_tax_rate_ids) as x(id)
   where not exists (
     select 1 from public.tax_rate t
      where t.id = x.id and (t.is_system or t.account_id = new.account_id));
  if v_malos > 0 then
    raise exception 'Este IVA no existe en tus tablas: elige uno de la lista.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_supplier_tax_rates_ok on public.supplier;
create trigger trg_supplier_tax_rates_ok
  before insert or update of usual_tax_rate_ids, account_id on public.supplier
  for each row execute function public.supplier_tax_rates_ok();

create table if not exists public.c01b_movimiento_registro (
  id           bigserial primary key,
  account_id   uuid not null,
  supplier_id  uuid not null,
  campo        text not null check (campo in ('email', 'phone', 'address', 'usual_vat_rates')),
  valor        text not null,
  destino      text not null check (destino in ('supplier_contact', 'supplier_proposal', 'supplier.usual_tax_rate_ids', 'ya_en_ficha')),
  destino_id   uuid,
  movido_at    timestamptz not null default now()
);
comment on table public.c01b_movimiento_registro is
  'C01b. Lo que movió 20261006T0110_c01b_datos.sql desde las columnas viejas de supplier, fila a fila. Solo service_role.';
create index if not exists ix_c01b_movimiento_supplier on public.c01b_movimiento_registro (supplier_id);
alter table public.c01b_movimiento_registro enable row level security;
revoke all on table public.c01b_movimiento_registro from anon, authenticated;
