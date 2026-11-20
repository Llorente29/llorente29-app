// src/modules/conta/erp10/configuracion.ts
//
// X10c (19/11): las configuraciones de importación de ERP10 viven en
// supabase/functions/_shared/erp10Configuracion.ts, para que el servidor
// (conta-erp10-escribir) arme lo que escribe con las mismas reglas que el Excel.
// Aquí solo se vuelven a exportar.

export * from '../../../../supabase/functions/_shared/erp10Configuracion.ts'
