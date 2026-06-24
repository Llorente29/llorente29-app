-- T2c · Publicador HubRise: mapeo de imágenes subidas por catálogo.
-- Reuso de imágenes: por cada (producto, catálogo HubRise) guarda el image_id
-- devuelto al subir, con la URL origen y su hash para detectar cambios. Permite
-- republicar sin resubir lo que no cambió (recomendación de HubRise).
-- Escribe el Edge con service_role (salta RLS); el front no la consulta.

CREATE TABLE IF NOT EXISTS catalog_image_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  menu_item_id uuid NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  external_catalog_id text NOT NULL,        -- catálogo HubRise (mm92j, etc.)
  image_id text NOT NULL,                   -- id devuelto por HubRise al subir
  source_url text NOT NULL,                 -- photo_url usada (para detectar cambios)
  source_hash text NOT NULL,                -- hash de source_url (reuso/cambio)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (menu_item_id, external_catalog_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_image_map_catalog
  ON catalog_image_map (account_id, external_catalog_id);

ALTER TABLE catalog_image_map ENABLE ROW LEVEL SECURITY;

-- Lectura: admins de plataforma o admin/manager de la cuenta (igual que catalog_publish).
CREATE POLICY catalog_image_map_select ON catalog_image_map
  FOR SELECT USING (
    current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id)
  );
-- Escritura: la hace el Edge con service_role (salta RLS). Sin políticas de
-- escritura para usuarios normales a propósito.
