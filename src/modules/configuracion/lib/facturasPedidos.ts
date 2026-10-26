// src/modules/configuracion/lib/facturasPedidos.ts
//
// V04 · PR 1 · Ajustes de Folvy › «Facturas de los pedidos» (maqueta, tablero
// 4): lo que dice la pantalla, en palabras, a partir de lo que devuelve la base
// (ticket_invoice_ajustes). La pantalla no decide nada: lo decide la base.

export type ModoVerifactu = 'apagado' | 'pruebas' | 'real'

export interface EmpresaFacturas { companyId: string; nombre: string; nif: string | null; verifactu: ModoVerifactu; conexionProbada: boolean }
export interface LocalFacturas {
  locationId: string; nombre: string; activo: boolean; codigo: string | null; propuesto: string | null; empresa: string | null
  serie: string | null; ultimo: number | null; ultimoAt: string | null; rectificativas: string | null; ultimoR: number | null; numeros: number
}
export interface MarcaFacturas { brandId: string; nombre: string; propia: boolean; emisor: string | null }
export interface AjustesFacturas { año: number; empresas: EmpresaFacturas[]; locales: LocalFacturas[]; marcas: MarcaFacturas[]; cedidasSinFactura7d: number }

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** De lo que devuelve ticket_invoice_ajustes a lo que pinta la pantalla. */
export function leerAjustes(r: Fila): AjustesFacturas {
  const lista = (k: string) => (Array.isArray(r[k]) ? (r[k] as Fila[]) : [])
  return {
    año: Number(r['año'] ?? new Date().getFullYear()),
    empresas: lista('empresas').map((e) => ({
      companyId: String(e.company_id), nombre: String(e.nombre ?? ''), nif: s(e.nif),
      verifactu: (['pruebas', 'real'].includes(String(e.verifactu)) ? e.verifactu : 'apagado') as ModoVerifactu, conexionProbada: e.conexion_probada === true,
    })),
    locales: lista('locales').map((l) => ({
      locationId: String(l.location_id), nombre: String(l.nombre ?? ''), activo: l.activo !== false, codigo: s(l.codigo), propuesto: s(l.propuesto),
      empresa: s(l.empresa), serie: s(l.serie), ultimo: n(l.ultimo), ultimoAt: s(l.ultimo_at), rectificativas: s(l.rectificativas), ultimoR: n(l.ultimo_r),
      numeros: Number(l.numeros ?? 0),
    })),
    marcas: lista('marcas').map((m) => ({ brandId: String(m.brand_id), nombre: String(m.nombre ?? ''), propia: m.propia !== false, emisor: s(m.emisor) })),
    cedidasSinFactura7d: Number(r.cedidas_sin_factura_7d ?? 0),
  }
}

/** «CA26-» de «CA26-000001»: el prefijo de la serie, sin el número. */
export const prefijo = (serie: string | null) => (serie ? serie.replace(/\d{6}$/, '') : null)

/** El último número dado, como se imprime («000123»); null si aún no hay. */
export const ultimoTexto = (serie: string | null, ultimo: number | null) =>
  serie && ultimo ? `${prefijo(serie)}${String(ultimo).padStart(6, '0')}` : null

/** El estado de Verifactu, en palabras (tablero 4). */
export function textoVerifactu(e: EmpresaFacturas): { chip: string; tono: 'neutro' | 'ambar' | 'azul'; frase: string } {
  const donde = 'Se enciende en Sumied › Ajustes › Verifactu, para toda la empresa.'
  if (e.verifactu === 'real') return { chip: 'Verifactu: real', tono: 'azul', frase: `${e.nombre} envía sus facturas a Hacienda. ${donde}` }
  if (e.verifactu === 'pruebas') return { chip: 'Verifactu: pruebas', tono: 'ambar', frase: `${e.nombre} está en pruebas: Hacienda comprueba sus facturas, pero no cuentan. ${donde}` }
  return {
    chip: 'Verifactu: apagado', tono: 'neutro',
    frase: `${donde}${e.conexionProbada ? '' : ' Falta la prueba de conexión con Hacienda (el certificado).'}`,
  }
}

/** Lo que dice cada local de su serie (regla 7: un local sin código se ve, y dice qué pasa con sus tiques). */
export function estadoLocal(l: LocalFacturas): string {
  if (!l.codigo) return 'Sin código: sus tiques salen como hoy, con el número del pedido. Elige el código para que numere su serie.'
  if (!l.ultimo) return `Numera desde el próximo tique: ${l.serie}.`
  return `Último número: ${ultimoTexto(l.serie, l.ultimo)}.`
}

/** El código que escribe la persona: 2 o 3 letras, sin acentos. Null si vale; si no, por qué. */
export function codigoNoVale(codigo: string): string | null {
  const c = codigo.trim().toUpperCase()
  if (!c) return 'Escribe el código del local.'
  if (!/^[A-Z]{2,3}$/.test(c)) return 'Son 2 o 3 letras, sin acentos ni números (por ejemplo, CA).'
  return null
}

/** Quién emite la factura de una marca (tablero 4). */
export function facturaDeMarca(m: MarcaFacturas): { deQuien: string; suFactura: string } {
  if (m.propia) return { deQuien: 'Propia', suFactura: 'Nuestra serie, la del local que la prepara' }
  const quien = m.emisor ?? 'el socio'
  return { deQuien: `Cedida · ${quien}`, suFactura: `La emite ${quien} desde Last` }
}
