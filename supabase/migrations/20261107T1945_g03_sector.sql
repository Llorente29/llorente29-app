-- supabase/migrations/20261107T1945_g03_sector.sql
--
-- cambia: public.company · prueba: supabase/staging/sql/20261107_g03_sectores_prueba.sql
--
-- G03 · «¿De qué sector es tu negocio?»: company.sector, por EMPRESA, con los
-- valores general, hosteleria y gestoria. Lo que enciende cada sector lo dice
-- el front (src/modules/conta/sectores/sectores.ts), no la base.
--
-- AÑADE: la columna (admite nulos), su CHECK (solo mira la columna nueva), la
-- función del disparador y el disparador.
--
-- company.is_hospitality NO se borra en este encargo (se borra en dos pasos:
-- primero el front deja de leerla). Mientras tanto se mantiene IGUAL que el
-- sector, en los dos sentidos, con el disparador:
--   · cambia el sector → is_hospitality = (sector = 'hosteleria'); un sector
--     que no es hostelería deja un is_hospitality nulo como está (nulo ya se
--     trata como no);
--   · cambia is_hospitality (Ajustes y el alta de hoy la escriben) → sí da
--     hostelería; no, a una empresa de hostelería o sin sector, la deja en
--     general; a una de gestoría no la toca;
--   · al crear una empresa, lo mismo; sin ninguna de las dos, sin sector.
-- No es «Clientes del despacho» (accounts.tax_advisor_since): eso es de la
-- cuenta y no se toca.
--
-- El relleno de las de hoy va aparte: 20261107T1946_g03_sector_de_hoy.sql.
-- Vuelta atrás: supabase/vuelta-atras/20261107T1945_g03_sector.down.sql

alter table public.company add column if not exists sector text;

do $$ begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'company_sector_valido' and conrelid = 'public.company'::regclass) then
    alter table public.company add constraint company_sector_valido check (sector in ('general', 'hosteleria', 'gestoria'));
  end if;
end $$;

comment on column public.company.sector is
  'G03. El sector de la empresa: general, hosteleria o gestoria. Decide qué se enciende (src/modules/conta/sectores/sectores.ts). Se propone en el alta según la actividad y se cambia en Ajustes › Tu empresa. is_hospitality se mantiene igual que él (company_sector_al_dia) hasta que se quite.';

create or replace function public._company_sector_al_dia() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.sector is not distinct from old.sector and new.is_hospitality is distinct from old.is_hospitality then
    -- Ha cambiado la marca de hostelería: el sector la sigue.
    if new.is_hospitality then
      new.sector := 'hosteleria';
    elsif new.is_hospitality is not null and coalesce(old.sector, 'hosteleria') = 'hosteleria' then
      new.sector := 'general';
    end if;
  elsif new.sector is not null and (tg_op = 'INSERT' or new.sector is distinct from old.sector) then
    -- Ha cambiado el sector (o llega con él): la marca de hostelería lo sigue.
    if (new.sector = 'hosteleria') is distinct from coalesce(new.is_hospitality, false) then
      new.is_hospitality := (new.sector = 'hosteleria');
    end if;
  elsif tg_op = 'INSERT' and new.is_hospitality is not null then
    new.sector := case when new.is_hospitality then 'hosteleria' else 'general' end;
  end if;
  return new;
end $$;

comment on function public._company_sector_al_dia() is
  'G03. Mantiene company.is_hospitality igual que company.sector, en los dos sentidos, mientras haya algo que lea is_hospitality.';

create or replace trigger company_sector_al_dia
  before insert or update of sector, is_hospitality on public.company
  for each row execute function public._company_sector_al_dia();
