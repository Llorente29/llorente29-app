// supabase/functions/_shared/erp10Parada.ts
//
// X31 · 0 (24/11) · LA SALIDA A ERP10, PARADA EN TODAS LAS EMPRESAS hasta que esté en producción la comprobación de lo
// que ya hay en ERP10 (antes de enviar, mirar; después, comprobar solo). Julio, 23/11: «si alguien mete datos en ERP10 y
// después Sumied sube otros, pueden borrarse, duplicarse, etc.».
//
// Un solo sitio para las dos salidas reales y la pantalla:
//   · conta-erp10-escribir (el botón de «Salida a ERP10» y «Volver a intentarlo» de la ficha) contesta 409 con el motivo;
//   · conta-erp10-cola (lo validado que sale solo) no coge nada;
//   · la pantalla apaga «Sacar a ERP10» y «Volver a intentarlo», con el motivo al pasar el ratón, y la barra de abajo ya
//     no dice «Mandarla».
// Lo vigila tests/conta/x31-erp10/parada.test.ts. Se quita en el mismo cambio que pone la comprobación.
// El Excel (Descargar los ficheros) no escribe en ERP10: no se para.

export const SALIDA_ERP10_PARADA = true

/** El motivo, tal y como se lee al pasar el ratón y en lo que contesta el servidor. */
export const MOTIVO_SALIDA_PARADA = 'Falta la comprobación de lo que ya hay en ERP10'
