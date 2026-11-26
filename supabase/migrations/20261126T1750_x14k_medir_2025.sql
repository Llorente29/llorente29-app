-- supabase/migrations/20261126T1750_x14k_medir_2025.sql
--
-- X14 · 2 (Julio, 26/11): el 2025 de QBO Integrity no entra en prueba: conta_traer_seguir para con «duplicate key value
-- violates unique constraint supplier_invoice_tax_supplier_invoice_id_vat_pct_key». Este fichero NO HACE NADA: solo existe
-- para que el ensayo de «Aplicar SQL en producción» cuente, en solo lectura y solo con números, la carga a medias del 2025
-- (scripts/conta/produccion/cuentas/x14k-medir-2025.sql). Se ensaya y NUNCA se lanza el real.
do $$ begin raise notice 'X14k: solo medir; no cambia nada.'; end $$;
