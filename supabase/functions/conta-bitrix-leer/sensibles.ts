// supabase/functions/conta-bitrix-leer/sensibles.ts
//
// G01c · Del adaptador de Bitrix24: los campos del portal que no se leen
// nunca (contraseñas, certificados, el IBAN y «Detalles del pago»). Antes en
// clientes.ts, que ahora es del núcleo neutro (_shared/crm/clientes.ts).

// ── Campos que no se leen nunca ─────────────────────────────────────────────
// En el Bitrix24 de QBO hay campos con contraseñas («Clave Certificado
// Digital…», «Usuario vinculado») y con los certificados (ficheros). Ni se
// piden a Bitrix24 ni salen para elegir en «Qué es cada campo», aunque alguien
// los elija por error (Julio, 07/11). Por su etiqueta y por su tipo.

/** Etiquetas de un campo con una contraseña o un acceso. */
// G01c (Julio, 07/11) · También el IBAN y «Detalles del pago» (BANKING_DETAILS, que puede llevarlo): no se leen nunca.
export const ETIQUETA_SENSIBLE = /\b(CLAVE|CLAVES|CONTRASENA|CONTRASENAS|PASSWORD|PASSWD|PASS|PIN|USUARIO|USER|LOGIN|CREDENCIAL|CREDENCIALES|TOKEN|SECRETO|CL@VE|IBAN|DETALLES DEL PAGO)\b/
/** Los campos estándar de Bitrix24 que no se leen nunca, por su código (sus etiquetas cambian con el idioma del portal). */
export const CODIGOS_SENSIBLES: readonly string[] = ['BANKING_DETAILS']
/** Tipos de campo que no se leen: los ficheros (los certificados) y las contraseñas. */
export const TIPOS_SENSIBLES: readonly string[] = ['file', 'password']

export interface CampoConEtiqueta { type?: string; title?: string; formLabel?: string; listLabel?: string }
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/** ¿Este campo de Bitrix24 no se puede leer nunca? Por su tipo o por cualquiera de sus etiquetas. */
export function esCampoSensible(c: CampoConEtiqueta | null | undefined, codigo?: string): boolean {
  if (codigo && CODIGOS_SENSIBLES.includes(codigo)) return true
  if (!c) return false
  if (c.type && TIPOS_SENSIBLES.includes(c.type)) return true
  return [c.formLabel, c.listLabel, c.title].some((t) => !!t && ETIQUETA_SENSIBLE.test(sinTildes(t)))
}
