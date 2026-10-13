## Qué hace cada fichero

Contra lo que existe en producción. **añade** pasa siempre; **cambia** (en caliente) pasa declarado en la cabecera y con prueba de staging, y en el camino del pedido además con `autorizo`; **destruye** solo con `autorizo`, y borrar o renombrar además sin usos y en su propia tanda.

### `supabase/migrations/20261111T0100_c06_cuenta_sola.sql` — sigue
- Crea (nuevo): nada
- **cambia** · quita · restriccion · `public.accounts` · drop constraint if exists accounts_product_brand_formato — quita y vuelve a poner restriccion · 2 filas · bloqueo ACCESS EXCLUSIVE: revisa todas las filas
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`
- **cambia** · añade · restriccion · `public.accounts` · add constraint accounts_product_brand_formato check (product_brand is null or product_brand ~ '^[a-z][a-z0-9_]{1,40}$') — restricción en una tabla que existe · 2 filas · bloqueo ACCESS EXCLUSIVE: revisa todas las filas
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`
- **cambia** · quita · restriccion · `public.accounts` · drop constraint accounts_business_type_check — quita y vuelve a poner restriccion · 2 filas · bloqueo ACCESS EXCLUSIVE: revisa todas las filas
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`
- **cambia** · añade · restriccion · `public.accounts` · add constraint accounts_business_type_check check (business_type = any (array['dark_kitchen'::text, 'bar'::text, 'restau — restricción en una tabla que existe · 2 filas · bloqueo ACCESS EXCLUSIVE: revisa todas las filas
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`
- **cambia** · reemplaza · funcion · `public.trg_adopt_mandatory_courses_on_account_insert()` — reemplaza la función (misma firma)
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`
- **cambia** · reemplaza · funcion · `public.trg_seed_appcc_on_account_insert()` — reemplaza la función (misma firma)
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`
- **cambia** · reemplaza · funcion · `public.trg_seed_ingredient_families_on_account_insert()` — reemplaza la función (misma firma)
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`
- **cambia** · reemplaza · funcion · `public.tg_seed_staff_roles()` — reemplaza la función (misma firma)
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`
- **cambia** · reemplaza · funcion · `public.create_account_gestoria_config_default()` — reemplaza la función (misma firma)
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`
- **cambia** · reemplaza · funcion · `public.trg_seed_vacation_settings_on_account_insert()` — reemplaza la función (misma firma)
  - declarado, prueba `supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`

### `supabase/migrations/20261111T0200_c06_diez_base.sql` — sigue
- Crea (nuevo): tabla `public.conta_diez_base`, tabla `public.conta_diez_base_registro`, indice `public.conta_diez_base_registro`, disparador `public.conta_diez_base`, politica `public.conta_diez_base`, politica `public.conta_diez_base_registro`

### `supabase/migrations/20261111T0300_c06_traer_listo.sql` — sigue
- Crea (nuevo): nada
- **cambia** · quita · disparador · `public.company_account` · company_account_nombre_puesto — quita y vuelve a poner disparador · 751 filas · bloqueo SHARE ROW EXCLUSIVE
  - declarado, prueba `supabase/staging/sql/20261111_c06_traer_listo_prueba.sql`
- **cambia** · crea · disparador · `public.company_account` · company_account_nombre_puesto — vuelve a poner un disparador · 751 filas · bloqueo SHARE ROW EXCLUSIVE
  - declarado, prueba `supabase/staging/sql/20261111_c06_traer_listo_prueba.sql`
- **cambia** · reemplaza · funcion · `public.conta_diez_subcuentas(uuid,uuid,jsonb)` — reemplaza la función (misma firma)
  - declarado, prueba `supabase/staging/sql/20261111_c06_traer_listo_prueba.sql`

VAT_RATE_FOR_EN: (ninguno)
