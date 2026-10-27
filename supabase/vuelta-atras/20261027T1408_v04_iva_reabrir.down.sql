-- supabase/vuelta-atras/20261027T1408_v04_iva_reabrir.down.sql
--
-- Vuelta atrás de 20261027T1408_v04_iva_reabrir.
--   · conta_iva_presentado y conta_iva_presentados vuelven a ser EXACTAMENTE las
--     de la 1233, desde su respaldo y con la huella comprobada.
--   · Se quitan los disparadores, el cron, las funciones y las dos tablas.
-- OJO: si ya hay alguna reapertura (abierta o cerrada), PARA: cada una tiene su
-- nueva presentación en tax_return y sus asientos marcados. Se decide antes,
-- no se deshace a ciegas.

select public._conta_iva_reabrir_se_puede_deshacer();

-- Los cerrojos, de golpe y al principio y en el mismo orden que la migración:
-- accounts y company (las claves ajenas de las tablas que se borran) y las cuatro con disparador.
set local lock_timeout = '20s';
lock table public.accounts, public.company in share row exclusive mode;
lock table public.tax_return, public.journal_entry, public.journal_line, public.vat_book_entry in access exclusive mode;

select public._restaurar_funcion('public.conta_iva_presentados(uuid,int)', '20261027T1408_v04_iva_reabrir');
select public._restaurar_funcion('public.conta_iva_presentado(uuid,date)', '20261027T1408_v04_iva_reabrir');

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'iva-reabierto-recordar') then
    perform cron.unschedule('iva-reabierto-recordar');
  end if;
end $$;
drop trigger if exists trg_tax_return_reapertura_cerrar on public.tax_return;
drop trigger if exists trg_vat_book_entry_iva_reabierto on public.vat_book_entry;
drop trigger if exists trg_journal_line_iva_reabierto on public.journal_line;
drop trigger if exists trg_journal_entry_iva_reabierto on public.journal_entry;
drop function if exists public.conta_iva_reaperturas(uuid, int);
drop function if exists public._conta_iva_reabrir_se_puede_deshacer();
drop function if exists public.conta_iva_reaperturas_recordar();
drop function if exists public.conta_iva_reapertura_presentada(uuid, text, timestamptz, text, numeric, text);
drop function if exists public._conta_iva_reapertura_cerrar();
drop function if exists public.conta_iva_reabrir(uuid, text, text, text);
drop function if exists public.conta_iva_puede_reabrir(uuid);
drop function if exists public._conta_iva_marcar_libro();
drop function if exists public._conta_iva_marcar_apunte();
drop function if exists public._conta_iva_marcar_asiento();
drop function if exists public._conta_iva_marcar(public.vat_reopening, uuid, text);
drop function if exists public.conta_iva_reabierto(uuid, date);
drop table if exists public.vat_reopening_entry;
drop table if exists public.vat_reopening;
