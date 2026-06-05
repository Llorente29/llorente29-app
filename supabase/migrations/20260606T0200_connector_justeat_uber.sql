-- Conectores JustEat y Uber Eats (logos delivery para ficha producto)
INSERT INTO connector (code, name, category, connection_type, managed_by, direction, logo_url, is_available, status)
VALUES
  ('justeat', 'Just Eat', 'delivery_platform', 'credentials', 'either', 'bidirectional', 'https://xzmpnchlguibclvxyynt.supabase.co/storage/v1/object/public/connector-logos/justeat.png', true, 'available'),
  ('uber', 'Uber Eats', 'delivery_platform', 'credentials', 'either', 'bidirectional', 'https://xzmpnchlguibclvxyynt.supabase.co/storage/v1/object/public/connector-logos/uber.png', true, 'available')
ON CONFLICT (code) DO UPDATE SET logo_url = EXCLUDED.logo_url;
