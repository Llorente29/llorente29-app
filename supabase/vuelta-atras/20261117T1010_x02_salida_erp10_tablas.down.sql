-- supabase/vuelta-atras/20261117T1010_x02_salida_erp10_tablas.down.sql
--
-- X02 · Vuelta atrás de 20261117T1010_x02_salida_erp10_tablas: quita las cuatro
-- tablas nuevas, en orden (las partidas y las subcuentas apuntan al lote). Antes
-- de la 1B están vacías; si alguna tuviera filas, se perderían: para.

do $$ begin
  if exists (select 1 from pg_class where oid = to_regclass('public.conta_erp10_salida_lote'))
     and exists (select 1 from public.conta_erp10_salida_lote where company_id not in (
                   select c.id from public.company c where c.legal_name like 'Empresa Inventada X02%')) then
    raise exception 'X02 · vuelta atrás: ya hay lotes de salida a ERP10 apuntados; quitar las tablas los perdería. No se toca nada.';
  end if;
end $$;
drop table if exists public.conta_erp10_subcuenta_salida;
drop table if exists public.conta_erp10_salida_partida;
drop table if exists public.conta_erp10_salida_lote;
drop table if exists public.conta_erp10_salida_empresa;
