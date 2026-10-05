-- supabase/vuelta-atras/20261007T0187_c02_enlaces_sin_dueno.down.sql
--
-- Deshace 20261007T0187: quita los cinco disparadores y su función. Los
-- enlaces huérfanos que limpió no vuelven: apuntaban a filas que ya no existen.
drop trigger if exists company_account_link_sin_dueno on public.supplier;
drop trigger if exists company_account_link_sin_dueno on public.treasury_account;
drop trigger if exists company_account_link_sin_dueno on public.expense_category;
drop trigger if exists company_account_link_sin_dueno on public.tax_rate;
drop trigger if exists company_account_link_sin_dueno on public.withholding_rate;
drop function if exists public.company_account_link_sin_dueno();
