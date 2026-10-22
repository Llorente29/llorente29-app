-- supabase/migrations/20261202T0440_s02_color_empresa.sql
--
-- S02 · Patrón único de pantallas (Julio, 22/10: «Color de la empresa: columna
-- nueva en el PR 1, con su tanda»). La cabecera de Sumied lleva encima una
-- franja de 3 px del color de la empresa activa, y el cuadrado con su inicial
-- va en ese mismo color (encargo S02, «Cabecera»). SOLO AÑADE: una columna
-- que admite nulos y su comprobación de formato. No toca ninguna fila ni
-- ninguna función que exista.
--
--   1. company.color: '#RRGGBB', o nula. Nula = la empresa aún no ha elegido:
--      el front pinta uno de los ocho de serie por su inicial
--      (src/modules/conta/marco/colorEmpresa.ts, --s-empresa-1…8). Lo elige
--      el administrador en Ajustes › Tu empresa (lo guarda con un update de su
--      propia empresa: la política de company que ya existe).
--   2. company_color_formato: CHECK de que es '#RRGGBB'. Solo amplía lo que se
--      puede guardar en una columna nueva: hoy no hay ninguna fila con color.
--
-- Número: el siguiente por encima del más alto que existe, contando la 0430 del
-- C07 (rama conta/c07-diez-todo), que va antes. No depende de ella.
-- Vuelta atrás: supabase/vuelta-atras/20261202T0440_s02_color_empresa.down.sql.
-- Prueba (rollback): supabase/staging/sql/20261202_s02_color_empresa_prueba.sql.

alter table public.company add column if not exists color text;
comment on column public.company.color is
  'S02 (22/10): el color de la empresa, ''#RRGGBB'': la franja de 3 px de la cabecera y el cuadrado de su inicial. Nula = el de serie por su inicial (marco/colorEmpresa.ts).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_color_formato' and conrelid = 'public.company'::regclass) then
    alter table public.company add constraint company_color_formato check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;
