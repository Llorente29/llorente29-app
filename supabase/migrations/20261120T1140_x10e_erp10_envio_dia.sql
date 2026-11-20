-- supabase/migrations/20261120T1140_x10e_erp10_envio_dia.sql
--
-- X10e · Los días del TPV salen por la conexión con ERP10. SOLO AÑADE tres columnas (que admiten
-- nulos) a public.conta_erp10_envio; no cambia ninguna que exista, ni su índice, ni
-- conta_erp10_envio_tomar.
--
--   dia              el envío es de un día del TPV: su factura del día (clase «emitida») o, si el día
--                    va en dos asientos (R07), su cobro (clase «asiento»). Con él, «el primer día de
--                    cada sociedad sale solo, para probar» va aparte de las emitidas y los asientos.
--   cobro_serie,     el número que da ERP10 al cobro de un día de UN solo asiento (los de antes del
--   cobro_documento  R07): la factura y el cobro salen de ese único asiento y se apuntan en su misma
--                    fila (el índice es uno por asiento). Con él, el cobro no sale dos veces y el
--                    paso 3 casa el día entero.
--
-- Nada en el camino del pedido. El real lo lanza Julio.

alter table public.conta_erp10_envio add column if not exists dia boolean;
alter table public.conta_erp10_envio add column if not exists cobro_serie text;
alter table public.conta_erp10_envio add column if not exists cobro_documento integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conta_erp10_envio_cobro_documento_ck' and conrelid = 'public.conta_erp10_envio'::regclass) then
    alter table public.conta_erp10_envio add constraint conta_erp10_envio_cobro_documento_ck check (cobro_documento is null or cobro_documento > 0);
  end if;
end $$;

comment on column public.conta_erp10_envio.dia is 'X10e · Es de un día del TPV: su factura del día o, con el día en dos asientos, su cobro.';
comment on column public.conta_erp10_envio.cobro_serie is 'X10e · La serie que da ERP10 al cobro de un día de un solo asiento.';
comment on column public.conta_erp10_envio.cobro_documento is 'X10e · El número que da ERP10 al cobro de un día de un solo asiento.';
