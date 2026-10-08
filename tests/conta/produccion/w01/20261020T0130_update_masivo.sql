-- Ejemplo W01: update masivo sobre una tabla que existe.
update public.supplier set notes = null where notes = '';
