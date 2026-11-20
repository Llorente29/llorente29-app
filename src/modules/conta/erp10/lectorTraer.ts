// src/modules/conta/erp10/lectorTraer.ts
//
// X12 · El lector de «Traer de ERP10» por la conexión. Pide a la función, UNA PÁGINA CADA VEZ
// (supabase/functions/_shared/erp10Traer.ts), todo lo de un ejercicio de una sociedad:
//
//   1. las subcuentas (el plan y los terceros), de una pasada;
//   2. el resumen de ERP10 del ejercicio (la comprobación);
//   3. mes a mes, los asientos y las facturas de ese mes.
//
// Lo que tarda, a la vista y sin bloquear:
//   · vive FUERA de React (un lector por sociedad y ejercicio): sigue leyendo aunque se cambie de
//     pestaña del marco o se desmonte la pantalla, y la pantalla lo vuelve a ver al volver;
//   · cada página leída se GUARDA (almacenTraer.ts, en el navegador) con lo que se lleva: si se corta
//     (la red, la pestaña cerrada), «Seguir» empieza en la página siguiente a la última guardada, sin
//     volver a leer lo leído ni juntar nada dos veces (cada página tiene su sitio: sustituir, no añadir);
//   · si una llamada falla, se reintenta dos veces (2 y 6 s); si sigue fallando, se para y se dice.
//
// No escribe nada en ERP10 ni en Sumied: lo leído va a la carga de «Traer» (lib/traer/conexion.ts) y
// entra en Sumied por el camino de siempre (paso 2, «Traerlo»).

import type { DeLaConexion } from '@/modules/conta/lib/traer/conexion'
import { mesDeGente } from '@/modules/conta/lib/traer/conexion'
import type { ApunteT, FacturaT, Pagina, PedirPagina, QueTraer, ResumenT, SubcuentaT } from '../../../../supabase/functions/_shared/erp10Traer'

/** Una parte de lo que hay que leer: las subcuentas, el resumen, o los asientos o las facturas de un mes. */
export interface Parte { que: QueTraer; mes: string | null }
export const claveParte = (p: Parte) => `${p.que}:${p.mes ?? ''}`

/** Lo que hay que leer de un ejercicio, en orden: hasta el mes de hoy si es el ejercicio en curso. */
export function partesDe(ejercicio: string, hoy: string): Parte[] {
  const ultimo = hoy.slice(0, 4) === ejercicio ? Number(hoy.slice(5, 7)) : hoy.slice(0, 4) < ejercicio ? 0 : 12
  const meses = Array.from({ length: ultimo }, (_, i) => `${ejercicio}-${String(i + 1).padStart(2, '0')}`)
  return [{ que: 'subcuentas', mes: null }, { que: 'resumen', mes: null }, ...meses.flatMap((mes) => [{ que: 'apuntes' as const, mes }, { que: 'facturas' as const, mes }])]
}

/** Dónde se guarda lo leído (IndexedDB en el navegador; en memoria en las pruebas). */
export interface AlmacenTraer {
  /** Todo lo guardado con claves que empiezan por `prefijo`. */
  leer(prefijo: string): Promise<[string, unknown][]>
  guardar(clave: string, valor: unknown): Promise<void>
  borrar(prefijo: string): Promise<void>
}

/** Una página a la función (conta-erp10-leer, accion traer). */
export type PedirAErp10 = (p: PedirPagina) => Promise<Pagina>

export type EstadoLector = 'sin_empezar' | 'leyendo' | 'cortado' | 'hecho'

/** Lo que ve la pantalla. */
export interface VistaLector {
  estado: EstadoLector
  ejercicio: string
  partes: Parte[]
  /** Las partes leídas enteras (claveParte). */
  hechas: string[]
  /** Lo que se está leyendo ahora (o donde se cortó). */
  enCurso: { parte: Parte; pagina: number } | null
  /** Por qué se ha cortado, en palabras. */
  fallo: string | null
  /** Cuánto se lleva leído. */
  cuantos: { subcuentas: number; asientos: number; facturas: number }
  /** Lo leído (solo con estado «hecho» está entero). */
  datos: DeLaConexion
  /** Cuándo se acabó (o null). */
  acabado: string | null
}

type Meta = { hechas: string[]; paginas: Record<string, { n: number; primera: string | null }>; acabado: string | null }

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class LectorTraer {
  private vista: VistaLector
  private oyentes = new Set<() => void>()
  private paginas = new Map<string, Pagina['filas']>() // «parte|página» → filas
  private meta: Meta = { hechas: [], paginas: {}, acabado: null }
  private corriendo: Promise<void> | null = null
  private parar = false

  readonly clave: string
  readonly ejercicio: string
  private readonly pedir: PedirAErp10
  private readonly almacen: AlmacenTraer
  private readonly o: { hoy: string; reintentosMs?: number[] }

  constructor(clave: string, ejercicio: string, pedir: PedirAErp10, almacen: AlmacenTraer, o: { hoy: string; reintentosMs?: number[] }) {
    this.clave = clave; this.ejercicio = ejercicio; this.pedir = pedir; this.almacen = almacen; this.o = o
    this.vista = this.armar('sin_empezar', null, null)
  }

  get estado(): VistaLector { return this.vista }
  oir(f: () => void): () => void { this.oyentes.add(f); return () => { this.oyentes.delete(f) } }
  private avisar() { for (const f of this.oyentes) f() }

  private armar(estado: EstadoLector, enCurso: VistaLector['enCurso'], fallo: string | null): VistaLector {
    const de = <T,>(que: QueTraer) => [...this.paginas.entries()].filter(([k]) => k.startsWith(`${que}:`))
      .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true })).flatMap(([, v]) => v as T[])
    const subcuentas = de<SubcuentaT>('subcuentas'), apuntes = de<ApunteT>('apuntes'), facturas = de<FacturaT>('facturas')
    const resumen = this.meta.hechas.includes('resumen:') ? de<ResumenT>('resumen') : null
    const partes = partesDe(this.ejercicio, this.o.hoy)
    const mesesLeidos = partes.filter((p) => p.que === 'apuntes' && this.meta.hechas.includes(claveParte(p))).map((p) => p.mes as string)
    return {
      estado, ejercicio: this.ejercicio, partes, hechas: [...this.meta.hechas], enCurso, fallo,
      cuantos: { subcuentas: subcuentas.length, asientos: apuntes.length, facturas: facturas.length },
      datos: { ejercicio: this.ejercicio, subcuentas, apuntes, facturas, resumen, mesesLeidos },
      acabado: this.meta.acabado,
    }
  }
  private poner(estado: EstadoLector, enCurso: VistaLector['enCurso'] = null, fallo: string | null = null) {
    this.vista = this.armar(estado, enCurso, fallo)
    this.avisar()
  }

  /** Lo guardado de antes (si se cortó o la pestaña se cerró): la pantalla lo enseña y «Seguir» sigue desde ahí. */
  async cargar(): Promise<void> {
    if (this.corriendo) return
    const filas = await this.almacen.leer(`${this.clave}|`)
    this.paginas.clear()
    for (const [k, v] of filas) {
      const resto = k.slice(this.clave.length + 1)
      if (resto === 'meta') this.meta = v as Meta
      else this.paginas.set(resto, v as Pagina['filas'])
    }
    const algo = this.meta.hechas.length > 0 || Object.keys(this.meta.paginas).length > 0
    this.poner(this.meta.acabado ? 'hecho' : algo ? 'cortado' : 'sin_empezar', this.dondeVa(), null)
  }

  /** Donde va (para decir dónde se quedó): la primera parte sin acabar y su siguiente página. */
  private dondeVa(): VistaLector['enCurso'] {
    const p = partesDe(this.ejercicio, this.o.hoy).find((x) => !this.meta.hechas.includes(claveParte(x)))
    return p ? { parte: p, pagina: this.meta.paginas[claveParte(p)]?.n ?? 0 } : null
  }

  /** Empieza o sigue donde se quedó. Si ya está leyendo, no hace nada (un solo lector por sociedad y ejercicio). */
  traer(): Promise<void> {
    if (this.corriendo) return this.corriendo
    this.parar = false
    this.corriendo = this.correr().finally(() => { this.corriendo = null })
    return this.corriendo
  }

  /** Deja de leer después de la página en marcha (lo leído se queda guardado). */
  dejar(): void { this.parar = true }

  /** Lo olvida todo (después de traerlo a Sumied, o para volver a empezar). */
  async olvidar(): Promise<void> {
    this.parar = true
    await this.corriendo?.catch(() => undefined)
    await this.almacen.borrar(`${this.clave}|`)
    this.paginas.clear()
    this.meta = { hechas: [], paginas: {}, acabado: null }
    this.poner('sin_empezar')
  }

  private async correr(): Promise<void> {
    const partes = partesDe(this.ejercicio, this.o.hoy)
    for (const parte of partes) {
      const k = claveParte(parte)
      if (this.meta.hechas.includes(k)) continue
      let pagina = this.meta.paginas[k]?.n ?? 0
      for (;;) {
        if (this.parar) { this.poner('cortado', { parte, pagina }, 'Has dejado de traer: sigue donde se quedó cuando quieras.'); return }
        this.poner('leyendo', { parte, pagina })
        let r: Pagina
        try { r = await this.conReintentos({ que: parte.que, ejercicio: this.ejercicio, mes: parte.mes, pagina }) } catch (e) {
          this.poner('cortado', { parte, pagina }, e instanceof Error ? e.message : String(e))
          return
        }
        const primera = this.meta.paginas[k]?.primera ?? null
        // ERP10, al pasarse del final, vuelve a dar la primera página: eso no es una página nueva.
        const repetida = pagina > 0 && r.primera !== null && r.primera === primera
        if (!repetida && r.filas.length) {
          this.paginas.set(`${k}|${String(pagina).padStart(4, '0')}`, r.filas)
          await this.almacen.guardar(`${this.clave}|${k}|${String(pagina).padStart(4, '0')}`, r.filas)
        }
        this.meta.paginas[k] = { n: pagina + 1, primera: pagina === 0 ? r.primera : primera }
        const acaba = repetida || r.ultima || r.filas.length === 0
        if (acaba) this.meta.hechas.push(k)
        await this.almacen.guardar(`${this.clave}|meta`, this.meta)
        if (acaba) break
        pagina++
      }
    }
    this.meta.acabado = new Date().toISOString()
    await this.almacen.guardar(`${this.clave}|meta`, this.meta)
    this.poner('hecho')
  }

  private async conReintentos(p: PedirPagina): Promise<Pagina> {
    const pausas = this.o.reintentosMs ?? [2000, 6000]
    for (let i = 0; ; i++) {
      try { return await this.pedir(p) } catch (e) {
        if (i >= pausas.length || (e as { noReintentar?: boolean }).noReintentar) throw e
        await espera(pausas[i])
      }
    }
  }
}

// ── Lo que dice cada fila mientras se trae ───────────────────────────────────────────

export type TipoFila = 'plan_cuentas' | 'proveedores' | 'clientes' | 'diario' | 'expedidas' | 'recibidas' | 'sumas_saldos'
const QUE_DE: Record<TipoFila, QueTraer> = {
  plan_cuentas: 'subcuentas', proveedores: 'subcuentas', clientes: 'subcuentas', diario: 'apuntes', expedidas: 'facturas', recibidas: 'facturas', sumas_saldos: 'apuntes',
}
const n = (x: number) => x.toLocaleString('es-ES')

/**
 * «Cómo está» de una fila mientras se trae de ERP10 (null: ya está todo leído, o no se trae).
 * «Leyendo asientos: marzo, 3 de 12»; «En cola»; «Se ha cortado en marzo: sigue donde se quedó».
 */
export function comoVaLaFila(v: VistaLector, tipo: TipoFila): { leyendo: boolean; texto: string; haLeido: string | null } | null {
  if (v.estado === 'sin_empezar' || v.estado === 'hecho') return null
  const que = QUE_DE[tipo]
  const delQue = v.partes.filter((p) => p.que === que)
  const hechas = delQue.filter((p) => v.hechas.includes(claveParte(p))).length
  const haLeido = que === 'subcuentas' ? `${n(v.cuantos.subcuentas)} ${v.cuantos.subcuentas === 1 ? 'cuenta' : 'cuentas'}`
    : que === 'apuntes' ? `${n(v.cuantos.asientos)} ${v.cuantos.asientos === 1 ? 'asiento' : 'asientos'}`
    : `${n(v.cuantos.facturas)} ${v.cuantos.facturas === 1 ? 'factura' : 'facturas'}`
  if (tipo === 'sumas_saldos') {
    return hechas === delQue.length ? null : { leyendo: false, texto: 'Se calcula al acabar los asientos', haLeido: null }
  }
  if (delQue.length && hechas === delQue.length) return { leyendo: false, texto: 'Leído; esperando a lo demás', haLeido }
  const aqui = v.enCurso && v.enCurso.parte.que === que ? v.enCurso.parte : delQue.find((p) => !v.hechas.includes(claveParte(p))) ?? null
  const mesTxt = aqui?.mes ? `${mesDeGente(aqui.mes).split(' de ')[0]}, ${hechas + 1} de ${delQue.length}` : ''
  const nombre = que === 'subcuentas' ? 'las cuentas' : que === 'apuntes' ? 'asientos' : 'facturas'
  if (v.estado === 'cortado') {
    return { leyendo: false, texto: `Se ha cortado${aqui?.mes ? ` en ${mesDeGente(aqui.mes).split(' de ')[0]}` : ''}: sigue donde se quedó`, haLeido }
  }
  const empezado = v.enCurso && v.enCurso.parte.que === que
  if (!empezado) return { leyendo: false, texto: hechas ? `Leyendo ${nombre}: ${mesTxt}` : 'En cola', haLeido: hechas ? haLeido : null }
  return { leyendo: true, texto: que === 'subcuentas' ? 'Leyendo las cuentas' : `Leyendo ${nombre}: ${mesTxt}`, haLeido }
}

// ── Un lector por sociedad y ejercicio, para toda la sesión ──────────────────────────

const LECTORES = new Map<string, LectorTraer>()

/** El lector de una sociedad y un ejercicio (el mismo mientras la aplicación esté abierta). */
export function lectorDe(companyId: string, ejercicio: string, crear: () => { pedir: PedirAErp10; almacen: AlmacenTraer; hoy: string }): LectorTraer {
  const clave = `${companyId}:${ejercicio}`
  let l = LECTORES.get(clave)
  if (!l) {
    const c = crear()
    l = new LectorTraer(clave, ejercicio, c.pedir, c.almacen, { hoy: c.hoy })
    LECTORES.set(clave, l)
    void l.cargar().catch(() => undefined)
  }
  return l
}
