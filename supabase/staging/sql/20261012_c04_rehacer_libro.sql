-- supabase/staging/sql/20261012_c04_rehacer_libro.sql
--
-- SOLO STAGING. Respuesta 3 del C04: la semilla del libro se rehace.
--   · La liquidación de Plataforma Norte mandaba lo de la marca cedida a la 400
--     del socio; ahora va a su cuenta «Liquidación pendiente con …» (410).
--   · La comisión va a «Comisiones de plataformas» (62300001), no a la 623 a
--     secas («Servicios de profesionales independientes»).
--   · El contraasiento de la publicidad decía «Anula el 4/2»; con la 0120 de
--     ahora dice «Anula General nº 2».
--   · La marca cedida de prueba se llamaba casi como una marca real del
--     cliente: ahora «Brasa Prestada», inventada del todo.
-- Lo validado no se toca por las buenas (los disparadores lo impiden: es su
-- gracia). Aquí, con los disparadores apagados y SOLO en las dos empresas de
-- prueba, se borra el libro entero de A y B; la semilla del C04 lo vuelve a
-- hacer con las funciones de la base, como haría la pantalla.
-- Lo que no se toca: las facturas, nóminas, liquidaciones y meses cerrados de
-- la semilla (solo se les suelta el asiento), el reparto 60/40 y el plan.

do $$
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Rehacer libro C04: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

-- La marca cedida y su mercancía, con nombres inventados del todo.
update public.brand set name = 'Brasa Prestada', slug = 'r02-brasa-prestada'
 where id = 'e0200000-0000-4000-8000-00000000a0b5' and account_id = 'c01a0000-0000-4000-8000-00000000000a';
update public.goods_receipt_line set product_name = 'Carbón de encina (saco)'
 where account_id = 'c01a0000-0000-4000-8000-00000000000a' and id in ('c0300000-0000-4000-8000-000000000311', 'c0300000-0000-4000-8000-000000000313');

-- Un anulado y su contraasiento se apuntan el uno al otro (on delete restrict)
-- y el CHECK journal_entry_anulado_completo no deja soltarlos: se borra con
-- los disparadores (también los de las claves ajenas) apagados SOLO en esta
-- transacción, y lo que la clave ajena soltaría sola se suelta a mano antes.
update public.supplier_invoice set journal_entry_id = null, payment_entry_id = null
 where account_id in ('c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b')
   and (journal_entry_id is not null or payment_entry_id is not null);
update public.channel_settlement set journal_entry_id = null
 where account_id in ('c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b') and journal_entry_id is not null;
update public.licensed_settlement set journal_entry_id = null
 where account_id in ('c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b') and journal_entry_id is not null;
update public.payroll_summary set entry_id = null
 where company_id in ('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6') and entry_id is not null;
delete from public.journal_correction where company_id in ('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6');
delete from public.journal_dismissal  where company_id in ('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6');
delete from public.sales_day_summary  where company_id in ('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6');

set local session_replication_role = replica;
delete from public.journal_line  where company_id in ('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6');
delete from public.journal_entry where company_id in ('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6');
set local session_replication_role = origin;

do $$
declare v int;
begin
  select count(*) into v from public.journal_entry where company_id in ('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6');
  if v <> 0 then raise exception 'Rehacer libro C04: quedan % asientos.', v; end if;
  raise notice 'Rehacer libro C04: libro de A y B vacío; la semilla lo vuelve a hacer.';
end $$;
