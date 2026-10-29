-- supabase/vuelta-atras/20261028T1440_w10_project_url.down.sql
--
-- Quita lo que añadió la 1440. Va DESPUÉS de deshacer la 1441 (las 23 dejan de
-- usarlas). project_url se queda en el Vault: lo creó Julio a mano.

drop function if exists public._aviso_falta_en_vault(text, uuid);
drop function if exists public._project_url();
drop function if exists public._project_url_si_hay();
