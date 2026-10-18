// supabase/functions/_shared/hacienda/doble.ts
//
// I01a · 6 · EL DOBLE DE HACIENDA. Contesta como la AEAT (puerta.ts) sin salir
// a la red. Lo usan las pruebas y, con CONTA_HACIENDA=doble, staging: nunca
// producción (lo impide comprobarPuerta).
//
// Hace lo que la AEAT dice que hace con una presentación (Especificaciones
// v3.0, §1.2 y §1.3; informe I01 paso 1, §1.2):
//   · rechaza el fichero si lleva saltos de línea o tabuladores, si FIRNIF o
//     FIRNOMBRE faltan, o si el fichero no es del modelo, ejercicio y periodo
//     que dice la petición;
//   · con errores, no graba nada y no da CSV;
//   · una segunda presentación del mismo NIF, modelo y periodo ya no es la
//     primera: la AEAT la trata como complementaria, y el doble la rechaza
//     para que se vea (Sumied consulta antes de presentar);
//   · lo grabado aparece en la consulta, con su CSV y su justificante.
// Y lo que puede salir mal: que no conteste a tiempo, que conteste algo raro,
// que el certificado no le valga o que el PDF no salga.
//
// El CSV del doble empieza por «DOBLE»: no se confunde con uno de verdad.

import { LlamadaFallida, type MaterialCertificado } from '../certificados/mtls.ts'
import {
  type Hacienda, type PeticionConsultar, type PeticionPresentar, type Presentada, type ResultadoPdf,
  type ResultadoPresentar, RespuestaRara,
} from './puerta.ts'

export type Escenario = 'bien' | 'errores' | 'tiempo' | 'rara' | 'certificado' | 'pdf_no_responde'

export interface LlamadaDoble {
  servicio: 'presentar' | 'consultar' | 'pdf'
  /** Lo que se le mandó, sin el certificado (que el doble ni guarda). */
  peticion: Record<string, unknown>
  conCertificado: boolean
}

const PDF_DOBLE = new TextEncoder().encode('%PDF-1.4\n% Justificante del DOBLE de Hacienda: no vale para nada.\n%%EOF\n')

export class HaciendaDoble implements Hacienda {
  readonly entorno = 'doble' as const
  readonly llamadas: LlamadaDoble[] = []
  readonly presentadas: Presentada[]
  escenario: Escenario
  private n = 0

  constructor(o: { escenario?: Escenario; presentadas?: Presentada[]; ahora?: () => Date } = {}) {
    this.escenario = o.escenario ?? 'bien'
    this.presentadas = [...(o.presentadas ?? [])]
    this.ahora = o.ahora ?? (() => new Date())
  }

  private readonly ahora: () => Date

  private fallos(m: MaterialCertificado | null) {
    if (this.escenario === 'tiempo') throw new LlamadaFallida('tiempo', 'Hacienda no ha contestado en 30 segundos. No sabemos si ha llegado: compruébalo antes de repetir.', 30_000)
    if (this.escenario === 'certificado') throw new LlamadaFallida('certificado', 'No se ha podido preparar la conexión con este certificado. Vuelve a subirlo; si se repite, puede que esté dañado.', 5)
    if (this.escenario === 'rara') throw new RespuestaRara('Hacienda ha contestado algo que no se entiende. No sabemos si se ha presentado: compruébalo antes de repetir.')
    if (m && (!m.cert || !m.key)) throw new LlamadaFallida('certificado', 'No se ha podido preparar la conexión con este certificado.', 5)
  }

  presentar(m: MaterialCertificado, p: PeticionPresentar): Promise<ResultadoPresentar> {
    this.llamadas.push({
      servicio: 'presentar', conCertificado: Boolean(m?.cert),
      peticion: { MODELO: p.modelo, EJERCICIO: String(p.ejercicio), PERIODO: p.periodo, NRC: p.nrc ?? null, IDI: 'ES', F01: p.fichero,
                  FIR: 'FirmaBasica', FIRNIF: p.firmante.nif, FIRNOMBRE: p.firmante.nombre },
    })
    return (async () => {
      this.fallos(m)
      const errores: { codigo: string; texto: string }[] = []
      if (/[\r\n\t]/.test(p.fichero)) errores.push({ codigo: 'E00001', texto: 'El fichero contiene caracteres no permitidos (saltos de línea o tabuladores).' })
      if (!p.firmante.nif || !p.firmante.nombre) errores.push({ codigo: 'E00002', texto: 'Faltan los datos del firmante (FIRNIF, FIRNOMBRE).' })
      const cabecera = `<T${p.modelo}0${p.ejercicio}${p.periodo}0000>`
      if (!p.fichero.startsWith(cabecera)) errores.push({ codigo: 'E00003', texto: `El fichero no corresponde al modelo ${p.modelo}, ejercicio ${p.ejercicio} y periodo ${p.periodo}.` })
      const nif = p.fichero.slice(p.fichero.indexOf('<T30301000>') + 11 + 2, p.fichero.indexOf('<T30301000>') + 11 + 11).trim()
      if (this.presentadas.some((d) => d.nif === nif && d.modelo === p.modelo && d.ejercicio === String(p.ejercicio) && d.periodo === p.periodo)) {
        errores.push({ codigo: 'E00004', texto: 'Ya existe una declaración presentada de este NIF, modelo y periodo: esta sería complementaria.' })
      }
      if (this.escenario === 'errores') errores.push({ codigo: 'E00099', texto: 'La casilla [71] no coincide con el resultado de la liquidación.' })
      if (errores.length > 0) return { ok: false, errores }

      this.n += 1
      const csv = `DOBLE${String(this.n).padStart(3, '0')}${p.periodo}${String(p.ejercicio).slice(2)}XXXX`.slice(0, 16).padEnd(16, 'X')
      const justificante = `${p.modelo}${String(p.ejercicio).slice(2)}${String(this.n).padStart(8, '0')}`
      const ahora = this.ahora()
      this.presentadas.push({
        ejercicio: String(p.ejercicio), modelo: p.modelo, periodo: p.periodo, nif, csv, expediente: `DOBLE-${this.n}`,
        justificante, justificanteAnterior: null, fechaHora: ahora.toISOString(),
      })
      return {
        ok: true, csv, fecha: ahora.toISOString().slice(0, 10), hora: ahora.toISOString().slice(11, 19), expediente: `DOBLE-${this.n}`,
        justificante, nifPresentador: p.firmante.nif, tipoRepresentacion: p.firmante.nif === nif ? 'Nombre propio' : 'Apoderado',
        nifDeclarante: nif, nrc: p.nrc ?? null, importe: null, urlPdf: `https://prewww2.aeat.es/doble/justificante?CSV=${csv}`,
        avisos: [], advertencias: [],
      }
    })()
  }

  consultar(m: MaterialCertificado, p: PeticionConsultar): Promise<Presentada[]> {
    this.llamadas.push({ servicio: 'consultar', conCertificado: Boolean(m?.cert), peticion: { NIF: p.nif, MOD: p.modelo ?? null, EJF: p.ejercicio ?? null, PER: p.periodo ?? null } })
    return (async () => {
      this.fallos(m)
      return this.presentadas.filter((d) => d.nif === p.nif && (!p.modelo || d.modelo === p.modelo) &&
        (!p.ejercicio || d.ejercicio === String(p.ejercicio)) && (!p.periodo || d.periodo === p.periodo))
    })()
  }

  pdf(url: string): Promise<ResultadoPdf> {
    this.llamadas.push({ servicio: 'pdf', conCertificado: false, peticion: { url } })
    return (async () => {
      if (this.escenario === 'pdf_no_responde') return { ok: false, motivo: 'no_responde', mensaje: 'Hacienda no da el justificante desde aquí.' }
      const csv = new URL(url).searchParams.get('CSV') ?? ''
      if (!this.presentadas.some((d) => d.csv === csv)) return { ok: false, motivo: 'no_responde', mensaje: 'Hacienda no da el justificante desde aquí.' }
      return { ok: true, pdf: PDF_DOBLE }
    })()
  }

  urlPdfDeCsv(csv: string): string {
    return `https://prewww2.aeat.es/doble/justificante?CSV=${encodeURIComponent(csv)}`
  }
}
