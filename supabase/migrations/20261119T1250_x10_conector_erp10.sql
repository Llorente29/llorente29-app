-- X10 · ERP10 por la API · El conector «ERP10 (despacho)», aparte del de Diez (19/11).
--
-- Solo añade una fila al catálogo (insert … on conflict do nothing): no cambia
-- ninguna tabla, columna ni función. account_connector ya admite el ámbito
-- «company» desde el C04b (20261019T0100_diez_conexion.sql):
--
--   · las claves, una vez: la conexión de la CUENTA con este conector (scope
--     account), en el Vault (connector-credentials → connector_secret_save);
--   · cada sociedad: su conexión (scope company, company_id) con su código de
--     empresa de ERP10 en external_account_id, y su token en el Vault
--     (connector_token_save; token_ref).
--
-- No es la conexión «diez»: diezDespacho.ts filtra por connector.code = 'diez' y
-- el cliente de ERP10 por 'erp10' (tests/conta/erp10/conexiones.test.ts).
--
-- Las etiquetas son las de la pantalla: palabras de la calle (claves), ni «token»
-- ni «API». Los campos secret van cifrados; nombre_bd va en config (no es secreto).

insert into public.connector (code, name, category, connection_type, managed_by, direction, description, config_schema, features, is_available, status, sort_order)
values ('erp10', 'ERP10 (despacho)', 'other', 'credentials', 'client', 'bidirectional',
        'Entra en el ERP10 del despacho (Cegid) para comprobar que lo que sale de Sumied queda igual. Las claves, una vez; debajo, cada sociedad con su código de empresa.',
        jsonb_build_object('fields', jsonb_build_array(
          jsonb_build_object('key', 'nombre_bd', 'label', 'Base del despacho en ERP10', 'type', 'text', 'required', true),
          jsonb_build_object('key', 'client_id', 'label', 'Identificador de cliente (del correo de Cegid)', 'type', 'secret', 'required', true),
          jsonb_build_object('key', 'client_secret', 'label', 'Clave de cliente (del correo de Cegid)', 'type', 'secret', 'required', true),
          jsonb_build_object('key', 'username', 'label', 'Usuario del despacho', 'type', 'secret', 'required', true),
          jsonb_build_object('key', 'password', 'label', 'Código de acceso (el que da el panel de QBO al conceder el acceso)', 'type', 'secret', 'required', true))),
        jsonb_build_array('por_empresa'), true, 'active', 91)
on conflict (code) do nothing;
