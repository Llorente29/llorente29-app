-- supabase/vuelta-atras/20261123T2050_x30_conciliar_solo_anade.down.sql
-- X30 · Quita lo nuevo: las funciones, las columnas y sus comprobaciones.
drop function if exists public._bank_reglas_de_partida(uuid, timestamptz);
drop function if exists public.bank_regla_desde(uuid, timestamptz);
drop function if exists public.bank_ajustes_conciliar(uuid, smallint, smallint);
alter table public.bank_movement drop column if exists position;
alter table public.bank_rule drop constraint if exists bank_rule_seed_valores;
alter table public.bank_rule drop column if exists seed;
alter table public.bank_rule drop column if exists applies_from;
alter table public.bank_match drop constraint if exists bank_match_confidence_pct_rango;
alter table public.bank_match drop column if exists confidence_pct;
alter table public.bank_settings drop constraint if exists bank_settings_aviso_dias_rango;
alter table public.bank_settings drop constraint if exists bank_settings_auto_threshold_rango;
alter table public.bank_settings drop column if exists aviso_dias;
alter table public.bank_settings drop column if exists auto_threshold;
