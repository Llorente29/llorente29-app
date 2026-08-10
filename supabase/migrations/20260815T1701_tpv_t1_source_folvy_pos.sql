-- supabase/migrations/20260815T1701_tpv_t1_source_folvy_pos.sql
--
-- ENCARGO TPV T1 — sale.source no admitía 'folvy_pos'. RECON (11/08):
-- sale_source_valid solo tenía manual/lastapp/import/hubrise/otter/folvy_shop.
-- Migración SEPARADA de kitchen_note (decisión de Julio 11/08: "para y cuenta,
-- no lo metas silenciosamente en la misma migración").
--
-- Guard DO: relee la definición real del constraint desde pg_constraint antes
-- de tocar nada, para poder repetir esta migración sin fallar si ya se aplicó.

do $guard$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.sale'::regclass and conname = 'sale_source_valid';

  if v_def is null then
    raise exception 'tpv_t1_source_folvy_pos: no se encontró el constraint sale_source_valid — revisar antes de continuar, no asumir nada';
  end if;

  if v_def not like '%folvy_pos%' then
    alter table public.sale drop constraint sale_source_valid;
    alter table public.sale add constraint sale_source_valid
      check (source = any (array['manual','lastapp','import','hubrise','otter','folvy_shop','folvy_pos']));
  end if;
end;
$guard$;
