// supabase/functions/_shared/verifactu/cuadre.ts
//
// V03 · E3 · «COMPROBAR CON HACIENDA»: lo que hace conta-verifactu con cada
// cuadre pedido (verifactu_cuadre, 1750). Coge uno, pregunta a la AEAT por los
// registros de ese NIF en ese mes —página a página, con la ClavePaginacion que
// devuelve— y le pasa cada página a la base (verifactu_cuadre_pagina). Con la
// última, la base cuadra y deja el resultado. Si algo falla, el cuadre queda en
// «fallo» con el motivo en castellano (regla 8: la pantalla lo dice).
//
// Núcleo sin Deno: las piezas (base, certificado, red) se inyectan.

import { EN_LA_DEMO } from '../puerta.ts'
import type { Entorno } from './enviar.ts'
import { type ClavePaginacion, ConsultaRechazada, type FacturaEnHacienda, leerRespuestaConsulta, sobreConsultaPeriodo } from './consulta.ts'

export interface CuadreTomado {
  cuadre_id: string
  entorno: Entorno
  company_id: string
  nif_emisor: string
  nombre_emisor: string
  ejercicio: number
  periodo: string
}

export interface PiezasCuadre<M> {
  tomar: (entorno: Entorno) => Promise<CuadreTomado | null>
  pagina: (cuadreId: string, facturas: FacturaEnHacienda[], final: boolean) => Promise<unknown>
  fallar: (cuadreId: string, error: string) => Promise<unknown>
  material: (c: CuadreTomado) => Promise<M>
  llamar: (url: string, xml: string, material: M) => Promise<{ status: number; cuerpo: string }>
  url: string
  /** Páginas como mucho por cuadre (cada una, hasta 10.000 facturas). */
  maxPaginas?: number
  /** Cuadres como mucho por vuelta. */
  maxCuadres?: number
  /** DM1 · PR 2a: ¿es de una cuenta de demo? Si lo es, no se consulta a Hacienda: se dice. */
  enLaDemo?: (c: CuadreTomado) => Promise<boolean>
}

export interface VueltaCuadre {
  cuadres: number
  hechos: number
  fallos: { cuadre_id: string; motivo: string }[]
  paginas: number
  facturas: number
}

/** El motivo de un fallo, para la pantalla: sin XML, sin certificado y sin NIF. */
export function motivoDeFallo(e: unknown): string {
  if (e instanceof ConsultaRechazada) {
    return `Hacienda ha rechazado la consulta${e.codigo ? ` (código ${e.codigo})` : ''}: ${e.message.replace(/^Codigo\[\d+\]\.?\s*/i, '').slice(0, 300)}`
  }
  if (e instanceof Error) {
    if (e.name === 'SinCertificado') return e.message
    if (e.name === 'LlamadaFallida') return 'No se ha podido hablar con Hacienda (la conexión ha fallado o ha tardado demasiado). Vuelve a pedirlo en un rato.'
    if (e.name === 'CertificadoNoVale') return 'El certificado no vale para hablar con Hacienda (caducado, sin clave o de otro titular).'
    return e.message.slice(0, 500)
  }
  return String(e).slice(0, 500)
}

const mismaClave = (a: ClavePaginacion | null, b: ClavePaginacion | null) =>
  !!a && !!b && a.nif === b.nif && a.numSerie === b.numSerie && a.fecha === b.fecha

/** Un cuadre entero, de la primera página a la última. Lanza si algo no cuadra. */
async function unCuadre<M>(p: PiezasCuadre<M>, c: CuadreTomado, cuenta: VueltaCuadre): Promise<void> {
  const max = p.maxPaginas ?? 50
  const material = await p.material(c)
  let clave: ClavePaginacion | null = null
  for (let n = 1; ; n++) {
    if (n > max) throw new Error(`Hacienda tiene más de ${max} páginas de registros para ese mes: no se ha terminado de comprobar.`)
    const r = await p.llamar(p.url, sobreConsultaPeriodo({ nombre: c.nombre_emisor, nif: c.nif_emisor }, c.ejercicio, c.periodo, clave), material)
    const pag = leerRespuestaConsulta(r.cuerpo)
    if (pag.hayMas && !pag.clave) throw new Error('Hacienda dice que hay más registros pero no da por dónde seguir: no se ha terminado de comprobar.')
    if (pag.hayMas && mismaClave(pag.clave, clave)) throw new Error('Hacienda ha devuelto la misma página dos veces: no se ha terminado de comprobar.')
    await p.pagina(c.cuadre_id, pag.facturas, !pag.hayMas)
    cuenta.paginas++
    cuenta.facturas += pag.facturas.length
    if (!pag.hayMas) return
    clave = pag.clave
  }
}

/** Una vuelta: los cuadres pedidos de ese entorno, uno detrás de otro. */
export async function vueltaDeCuadres<M>(p: PiezasCuadre<M>, entorno: Entorno): Promise<VueltaCuadre> {
  const cuenta: VueltaCuadre = { cuadres: 0, hechos: 0, fallos: [], paginas: 0, facturas: 0 }
  for (let i = 0; i < (p.maxCuadres ?? 5); i++) {
    const c = await p.tomar(entorno)
    if (!c) break
    cuenta.cuadres++
    try {
      if (p.enLaDemo && await p.enLaDemo(c)) {
        const motivo = `${EN_LA_DEMO} Comprobar con Hacienda no consulta nada en una empresa de demostración.`
        cuenta.fallos.push({ cuadre_id: c.cuadre_id, motivo })
        await p.fallar(c.cuadre_id, motivo)
        continue
      }
      await unCuadre(p, c, cuenta)
      cuenta.hechos++
    } catch (e) {
      const motivo = motivoDeFallo(e)
      cuenta.fallos.push({ cuadre_id: c.cuadre_id, motivo })
      await p.fallar(c.cuadre_id, motivo)
    }
  }
  return cuenta
}
