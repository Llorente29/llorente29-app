// supabase/functions/_shared/verifactu/puerta.ts
//
// V03 · E1 · LA PUERTA DE conta-verifactu: qué entorno deja enviar, o por qué
// está cerrada. Cerrada si no se dice otra cosa. Pruebas, nunca desde la base
// de producción; real, solo desde ella (respuesta 1 de Julio: «producción solo
// lectura hasta que pase una empresa a real; las pruebas, desde staging»).
//
// G05 · T3 (09/11): LA EXCEPCIÓN DE LAS DEMOS. La Gestoría Demo vive en
// producción (respuesta de Julio, nº 23): desde ella, las pruebas sí, pero
// SOLO para las cuentas de demostración. Se abre con las dos cosas: la
// llamada pide «pruebas» (la despierta verifactu_despertar_demos) y Julio ha
// puesto CONTA_VERIFACTU_DEMOS = pruebas. Entonces `soloDemos`: cada lote pasa
// por salirA (_shared/puertaDePruebas.ts) y el de una cuenta de verdad no sale.

//
// V05 · (25/11) LAS PRUEBAS DE LAS EMPRESAS DESDE PRODUCCIÓN, con su propio
// certificado (respuesta de Julio al V05: el de Llorente29 vive en el Vault de
// producción). Se abren con las dos cosas, como las de Hacienda: la llamada
// pide «pruebas_empresas» (la despierta verifactu_despertar_empresa, que solo
// pulsa un administrador) y Julio ha puesto CONTA_VERIFACTU_EMPRESAS =
// «pruebas:AAAA-MM-DD», ese día de Madrid. Entonces `conCertEmpresa`: cada
// lote va con el certificado que la empresa autorizó para Verifactu
// (verifactu_cert_abrir_pruebas, 0V05) o vuelve diciendo por qué.
//
// Y REAL, CERRADO EN EL PROGRAMA: la dirección de producción de Hacienda no
// está en la lista de destinos (certificados/mtls.ts); aquí se dice antes.

import type { Entorno } from './enviar.ts'

export const PRODUCCION_REF = 'xzmpnchlguibclvxyynt'

export type Puerta = { entorno: Entorno; soloDemos?: true; conCertEmpresa?: true } | { cerrada: string }

export const REAL_CERRADO = 'real está cerrado en el programa: Sumied solo habla con el entorno de pruebas de Hacienda'

/** El día de Madrid, «AAAA-MM-DD». */
export function diaMadrid(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
}

/**
 * `valor`: CONTA_VERIFACTU. `pedido`: el entorno que pide la llamada (solo
 * cuenta «pruebas»). `demos`: CONTA_VERIFACTU_DEMOS.
 */
export function puerta(valor: string | undefined, supabaseUrl: string, pedido?: string, demos?: string,
                       empresas?: { autoriza: string | undefined; ahora: Date }): Puerta {
  const prod = supabaseUrl.includes(PRODUCCION_REF)
  if (pedido === 'pruebas_empresas') {
    if (!prod) return { cerrada: 'las pruebas de las empresas con su certificado son desde la base de producción; en staging, CONTA_VERIFACTU = pruebas' }
    const hoy = diaMadrid(empresas?.ahora ?? new Date())
    return (empresas?.autoriza ?? '').trim() === `pruebas:${hoy}`
      ? { entorno: 'pruebas', conCertEmpresa: true }
      : { cerrada: `las pruebas de las empresas no están autorizadas para hoy (${hoy}): CONTA_VERIFACTU_EMPRESAS = pruebas:${hoy}` }
  }
  if (prod && pedido === 'pruebas') {
    return demos === 'pruebas' ? { entorno: 'pruebas', soloDemos: true } : { cerrada: 'las pruebas de las demos desde producción están apagadas (CONTA_VERIFACTU_DEMOS sin poner)' }
  }
  if (valor === 'pruebas') return prod ? { cerrada: 'pruebas no se envía desde la base de producción' } : { entorno: 'pruebas' }
  if (valor === 'real') return { cerrada: REAL_CERRADO }
  return { cerrada: 'CONTA_VERIFACTU sin poner' }
}
