-- C9 · Lote 2 §4 (04/09/2026). Con que camara estamos jugando.
--
-- «Hoy no sabemos con que camaras jugamos, y la metrica de lectura depende de
-- eso» (encargo §4). Sin esto, cuando L3 diga «este local lee peor» no se podra
-- distinguir una tablet vieja de una mala colocacion de la etiqueta.
--
-- Se rellena sola: la tablet la manda en su latido, como ya hace con
-- `app_version` y `platform`. Nace NULL en las cuatro filas existentes y eso es
-- correcto -- hasta que cada tablet no vuelva a latir con la version nueva, no
-- hay dato, y un dato inventado seria peor que ninguno.

alter table public.kds_device add column if not exists model text;

comment on column public.kds_device.model is
  'C9 L2 §4: modelo del dispositivo, tal y como lo reporta el. Sirve para poder separar «lee mal porque la tablet es vieja» de «lee mal porque la etiqueta esta mal pegada» cuando L3 empiece a dar numeros por local.';

do $verif$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='kds_device' and column_name='model') then
    raise exception 'C9 L2: kds_device.model no se creo.';
  end if;
end
$verif$;
