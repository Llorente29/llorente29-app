-- Vuelta atrás de «C06 · De qué programa viene cada empresa» (20261111T0400).
-- Quita la función, los disparadores, las políticas y las dos tablas. Lo que
-- se había contestado en el alta se pierde con ellas: PARA si hay respuestas,
-- para que se decida antes (se pueden copiar de conta_programa_anterior).

do $$
begin
  if to_regclass('public.conta_programa_anterior') is not null
     and exists (select 1 from public.conta_programa_anterior) then
    raise exception 'Hay % respuestas de «¿De qué programa vienes?»: cópialas antes de quitar la tabla.',
      (select count(*) from public.conta_programa_anterior);
  end if;
end $$;

drop function if exists public.conta_programa_anterior_poner(uuid, text, text);
drop table if exists public.conta_programa_anterior_registro;
drop table if exists public.conta_programa_anterior;
drop function if exists public.conta_programa_anterior_apuntar();
drop function if exists public.conta_programa_anterior_guarda();
