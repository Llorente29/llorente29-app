// supabase/functions/_shared/crm/ficha.ts
//
// G01c (Julio, 07/11) · La ficha de un CRM, sin saber de qué CRM viene: lo que
// cada adaptador (hoy, Bitrix24: conta-bitrix-leer) lee de una empresa o de un
// contacto y lo que el núcleo (clientes.ts, contactos.ts, leer.ts) necesita
// para decidir quién es cliente, unir, guardar y decir lo que no cuadra.
// Puro: sin llamadas, sin códigos de campo de ningún CRM.

/** Qué CRM es: el de la conexión (conta_crm.crm). */
export type Crm = 'bitrix24'

/** El nombre de cada CRM en las frases y en pantalla. */
export const NOMBRE_CRM: Record<string, string> = { bitrix24: 'Bitrix24' }
export const nombreDelCrm = (crm: string) => NOMBRE_CRM[crm] ?? crm

/** Una empresa o un contacto del CRM: sus ids son numeraciones distintas. */
export type TipoFicha = 'empresa' | 'contacto'

/** Lo que es cada cliente en Sumied (la situación del CRM, traducida con el mapa confirmado). */
export type Situacion = 'activo' | 'baja' | 'moroso' | 'solo_renta' | 'sin_clasificar'

/** Lo que se le cobra: C (contabilidad y gestoría), L (laboral), S (otros servicios). */
export type Servicio = 'C' | 'L' | 'S'

/** Una cuota del CRM: solo de referencia, Sumied no calcula nada con ella. */
export interface CuotaDeReferencia { etiqueta: string; importeCent: number | null; texto: string }

/** Las señales de que un contacto sin empresa es cliente (Julio, 07/11). */
export interface SenalesDeCliente { nif: boolean; tarifa: boolean; negociacion: boolean; gocardless: boolean }

/** Una ficha del CRM, ya leída por su adaptador. */
export interface FichaCrm {
  /** Empresa si no lo dice. */
  tipoFicha?: TipoFicha
  /** El id de la ficha en su CRM. */
  idExterno: string
  nombre: string
  nif: string | null
  /** El NIF tal cual está en el CRM (para el ensayo de la unión, cuando no se usa). */
  nifEnCrm: string | null
  calle: string | null
  cp: string | null
  poblacion: string | null
  provincia: string | null
  correos: string[]
  telefonos: string[]
  situacion: Situacion | null
  /** El texto de la situación en el CRM (el de la opción), para «Sin clasificar». */
  situacionTexto: string | null
  /** De qué campo sale la dirección y las otras direcciones que tiene, de referencia. */
  direccionDe: string | null
  otrasDirecciones: { etiqueta: string; texto: string }[]
  servicios: Servicio[]
  /** El texto de «Forma de pago», tal cual, y el emisor que dice (si el mapa lo sabe). */
  formaPago: string | null
  emisorSegunCrm: string | null
  /** Las cuotas del CRM: solo referencia. */
  cuotasReferencia: CuotaDeReferencia[]
  /** Lo que no se ha podido leer, en palabras. */
  avisos: string[]
}

/** Un contacto del CRM: una ficha, con sus empresas y sus señales de cliente. */
export interface FichaContactoCrm extends FichaCrm {
  tipoFicha: 'contacto'
  /** Las empresas del CRM (su id externo) de las que es persona de contacto. */
  empresas: string[]
  /** «Tipo de cliente» u otro dato del CRM: solo de referencia en la ficha. */
  tipoCliente: string | null
  senales: SenalesDeCliente
  /** Datos de cliente propios (hoy, una cuota con importe): con empresa, sale en «Pendiente de revisar». */
  datosDeCliente: boolean
}

/** La clave de una ficha dentro de un CRM: su tipo y su id externo (una empresa y un contacto pueden tener el mismo id). */
export const claveDeFicha = (f: { tipoFicha?: TipoFicha; idExterno: string }) => `${f.tipoFicha ?? 'empresa'}:${f.idExterno}`

/** La referencia completa de una ficha (CRM, tipo e id), en un texto, y de vuelta. */
export const refDeFicha = (crm: string, tipoFicha: TipoFicha | null | undefined, idExterno: string) => `${crm}|${tipoFicha ?? 'empresa'}|${idExterno}`
export function deRef(ref: string): { crm: string; tipoFicha: TipoFicha; idExterno: string } {
  const [crm, tipo, ...resto] = ref.split('|')
  return { crm, tipoFicha: tipo === 'contacto' ? 'contacto' : 'empresa', idExterno: resto.join('|') }
}

/** Un NIF como se escribe a mano: sin espacios, puntos ni guiones, en mayúsculas, sin el «ES» de delante. */
export function normalizarNif(v: string | null | undefined): string | null {
  if (!v) return null
  let n = v.toUpperCase().replace(/[\s.\-_/]/g, '')
  if (n.startsWith('ES') && n.length > 9) n = n.slice(2)
  return n === '' ? null : n
}

/** «24,20», «24.20», «1.234,50 €», «24|EUR» → céntimos; null si no es un número. */
export function importeACent(v: string | null): number | null {
  if (!v) return null
  let t = v.split('|')[0].replace(/[€\s]/g, '')
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
