-- 20260902T1620_home_layout_descartadas.sql
-- APLICADA el 02/09. Verificacion pasada: columna creada, con defecto, sin nulos.
--
-- Una tarjeta NUEVA no entra en un layout que ya existe, asi que quien mas ha
-- usado el producto es justo quien deja de ver lo que se anade. El cajon avisa
-- de las novedades; esta columna guarda las que el usuario ya dijo que NO
-- quiere.
--
-- Sin ella el aviso reaparece en cada carga y a la tercera se ignora -- y con
-- el se ignora tambien el de huerfanas, que si importa. Un aviso que no se
-- puede apagar ensena a no leer los avisos.
alter table public.home_layout
  add column if not exists descartadas text[] not null default '{}'::text[];

comment on column public.home_layout.descartadas is
  'Claves de tarjetas nuevas que el usuario ha rechazado explicitamente. El aviso de novedades no las vuelve a ofrecer. Anadir una tarjeta al Inicio la saca de aqui.';

do $verif$
declare v_tipo text; v_nulos int; v_defecto text;
begin
  select data_type, column_default into v_tipo, v_defecto
  from information_schema.columns
  where table_schema='public' and table_name='home_layout' and column_name='descartadas';

  if v_tipo is null then
    raise exception 'home_layout.descartadas no se ha creado';
  end if;
  if v_defecto is null then
    raise exception 'home_layout.descartadas sin defecto: una fila vieja daria null y el codigo tendria que adivinar';
  end if;

  select count(*) into v_nulos from public.home_layout where descartadas is null;
  if v_nulos > 0 then
    raise exception '% filas de home_layout con descartadas nulo', v_nulos;
  end if;

  raise notice 'VERIFICACION OK: home_layout.descartadas creada, tipo %, con defecto y sin nulos', v_tipo;
end;
$verif$;
