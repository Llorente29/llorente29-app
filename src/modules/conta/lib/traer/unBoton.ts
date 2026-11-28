// src/modules/conta/lib/traer/unBoton.ts
//
// X13 · «Traer de ERP10» EN UN BOTÓN (la maqueta nucleo_11_traer_de_erp10_un_boton, aprobada por Julio el
// 20/11). Lo que decide la pantalla con la sociedad conectada: el estado, las siete filas con su círculo, su
// cifra y lo que han comprobado, la pastilla de arriba y lo que hay que mirar. Puro: sin base, sin red y sin
// React. La regla de Julio: un botón para empezar, uno secundario para parar o cancelar, y uno para confirmar.
//
//   · antes      «Traerlo todo de ERP10»: la lista de lo que se va a traer, con su círculo vacío. Nada en ámbar.
//   · trayendo   «Pararlo»: cada fila se marca sola al acabar; la que se lee, con su mes y su barra.
//   · parado     «Seguir trayendo de ERP10»: lo leído se queda, y sigue donde se quedó.
//   · metiendo   lo leído entra en prueba (conta_traer_cargar, el de siempre), solo, al acabar de leer.
//   · acabado    «Darlo por bueno» y «Descartar lo traído»: cada fila con su cifra y lo que ha comprobado, y
//                lo que hay que mirar en ámbar en su fila, con «Verlos».
//   · fallo      la base no lo ha dejado entrar en prueba: su frase, y volver a intentarlo o descartar lo leído.
//
// Los textos dicen lo que hace la base (N06a/N06b), no lo que dice la maqueta: lo traído ENTRA EN PRUEBA al
// acabar de leer; hasta darlo por bueno no se paga ni se cobra y se deshace entero; al darlo por bueno queda fijo.

import { mesDeGente } from './conexion'
import type { Carga } from './index'
import type { Diferencia } from './pantalla'

export type EstadoUnBoton = 'antes' | 'trayendo' | 'parado' | 'metiendo' | 'acabado' | 'fallo'
export type TipoUnBoton = 'plan_cuentas' | 'proveedores' | 'clientes' | 'diario' | 'expedidas' | 'recibidas' | 'sumas_saldos'

/** Lo que la pantalla sabe del lector (erp10/lectorTraer.ts), sin depender de él. */
export interface LectorVisto {
  estado: 'sin_empezar' | 'leyendo' | 'cortado' | 'hecho'
  partes: { que: 'subcuentas' | 'apuntes' | 'facturas' | 'resumen'; mes: string | null }[]
  hechas: string[]
  enCurso: { parte: { que: string; mes: string | null }; pagina: number } | null
  fallo: string | null
  cuantos: { subcuentas: number; proveedores: number; clientes: number; asientos: number; facturas: number }
  quedaMs: number | null
}
/** Lo traído en prueba (traerService.EnPrueba), lo que se usa aquí. */
export interface EnPruebaVisto { cuentas: Record<string, number>; mirar: { frase: string }[]; sumas: { debe: number; haber: number }[] }
/** La comparación de la base antes de darlo por bueno (traerService.AntesDeDarlo). */
export interface AntesVisto { puede: boolean; texto: string; comparado: boolean; /** X14 · 2 · las cuentas comparadas con el de ERP10 */ cuentas?: number; diferencias: Diferencia[] }

export interface EntradaUnBoton {
  lector: LectorVisto | null
  /** Lo leído de ERP10, en la carga de «Traer» (leerCarga con lo de la conexión), si está en este navegador. */
  carga: Carga | null
  enPrueba: EnPruebaVisto | null
  antes: AntesVisto | null
  /** Meterlo en prueba: en marcha (X14: con lo que lleva), o la frase de la base si no lo ha dejado. */
  meter: { estado: 'metiendo'; avance?: AvanceMeter } | { estado: 'fallo'; texto: string } | null
  /** «Pararlo» deja este motivo (lectorTraer.PARADO). */
  parado: string
}

/**
 * X14 · Lo que lleva metido en prueba una carga grande (conta_traer_cargar y conta_traer_seguir, por trozos): los asientos y
 * las facturas, hechos de cuántos, del ejercicio que se trae.
 */
export interface AvanceMeter { ejercicio: string | null; asientos: { hechos: number; de: number }; facturas: { hechos: number; de: number } }

const miles = (n: number) => new Intl.NumberFormat('es-ES', { useGrouping: true }).format(n).replace(/^(\d)(\d{3})$/, '$1.$2')

/** X14 · «Trayendo 2024: asientos 2.100 de 4.425» (después, las facturas); sin avance todavía, que está entrando. */
export function fraseMetiendo(a: AvanceMeter | null | undefined): string {
  if (!a) return 'Leído de ERP10. Ahora entra en prueba en Sumied.'
  const que = a.ejercicio ? `Trayendo ${a.ejercicio}` : 'Trayendo'
  if (a.asientos.hechos < a.asientos.de) return `${que}: asientos ${miles(a.asientos.hechos)} de ${miles(a.asientos.de)}`
  if (a.facturas.hechos < a.facturas.de) return `${que}: facturas ${miles(a.facturas.hechos)} de ${miles(a.facturas.de)}`
  return `${que}: acabando`
}

export function estadoUnBoton(e: EntradaUnBoton): EstadoUnBoton {
  if (e.enPrueba) return 'acabado'
  if (e.meter?.estado === 'fallo') return 'fallo'
  if (e.meter?.estado === 'metiendo' || e.lector?.estado === 'hecho') return 'metiendo'
  if (e.lector?.estado === 'leyendo') return 'trayendo'
  if (e.lector?.estado === 'cortado') return 'parado'
  return 'antes'
}

export interface FilaUnBoton {
  tipo: TipoUnBoton
  que: string
  /** vacío (antes, o en cola), leyendo (la que se lee), hecho (✓) o mira (! en ámbar). */
  icono: 'vacio' | 'leyendo' | 'hecho' | 'mira'
  cifra: string | null
  /** Lo que es (antes), por dónde va (trayendo) o lo que ha comprobado (acabado). */
  linea: string
  /** 0 a 1, la barra de la que se lee. */
  barra: number | null
  /** «Verlos»: lo que hay que mirar de esta fila, una frase cada cosa. */
  verlos: { titulo: string; lista: string[] } | null
}

export const FILAS_UN_BOTON: readonly { tipo: TipoUnBoton; que: string; antes: string }[] = [
  { tipo: 'plan_cuentas', que: 'Plan de cuentas', antes: 'las subcuentas' },
  { tipo: 'proveedores', que: 'Proveedores y acreedores', antes: 'con NIF y dirección' },
  { tipo: 'clientes', que: 'Clientes', antes: 'con NIF y dirección' },
  { tipo: 'diario', que: 'Diario', antes: 'todos los asientos del ejercicio' },
  { tipo: 'expedidas', que: 'Facturas emitidas', antes: 'con su IVA' },
  { tipo: 'recibidas', que: 'Facturas recibidas', antes: 'con su IVA y su retención' },
  { tipo: 'sumas_saldos', que: 'Sumas y saldos', antes: 'se compara con el de ERP10, de su fichero' },
]

const n = (x: number) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const cuantos = (x: number, uno: string, varios: string) => `${n(x)} ${x === 1 ? uno : varios}`
const euros = (x: number) => `${x < 0 ? '−' : ''}${n(Math.trunc(Math.abs(x)))},${String(Math.round(Math.abs(x) * 100) % 100).padStart(2, '0')}`
const mesSolo = (m: string) => mesDeGente(m).split(' de ')[0]
const QUE_DE: Record<TipoUnBoton, 'subcuentas' | 'apuntes' | 'facturas'> = {
  plan_cuentas: 'subcuentas', proveedores: 'subcuentas', clientes: 'subcuentas', diario: 'apuntes', expedidas: 'facturas', recibidas: 'facturas', sumas_saldos: 'apuntes',
}

/** «quedan unos 5 minutos», «queda un minuto», «queda menos de un minuto». */
export function queda(ms: number | null): string | null {
  if (ms == null) return null
  const min = Math.round(ms / 60_000)
  return ms < 45_000 ? 'queda menos de un minuto' : min <= 1 ? 'queda un minuto' : `quedan unos ${min} minutos`
}

/** ¿Lo leído da lo mismo que ERP10 (su resumen) y lo traído lo mismo que el sumas y saldos (la base)? */
export function cuadra(e: EntradaUnBoton): { resumen: boolean | null; sumas: boolean | null; todo: boolean } {
  const resumen = e.carga?.conexion?.resumen ? e.carga.conexion.resumen.cuadra : null
  const sumas = e.antes ? (e.antes.comparado ? e.antes.diferencias.length === 0 : null) : null
  return { resumen, sumas, todo: resumen !== false && sumas !== false && (resumen === true || sumas === true) }
}

/** La pastilla de arriba, al lado de «Conectada con ERP10». */
export function pastillaUnBoton(e: EntradaUnBoton): { texto: string; tono: 'azul' | 'gris' | 'verde' | 'ambar' } | null {
  const est = estadoUnBoton(e)
  if (est === 'trayendo') { const q = queda(e.lector?.quedaMs ?? null); return { texto: q ? `Trayendo · ${q}` : 'Trayendo', tono: 'azul' } }
  if (est === 'parado') return e.lector?.fallo === e.parado ? { texto: 'Parado · sigue donde se quedó', tono: 'gris' } : { texto: 'Se ha cortado · sigue donde se quedó', tono: 'ambar' }
  if (est === 'metiendo') return { texto: e.meter?.estado === 'metiendo' && e.meter.avance ? fraseMetiendo(e.meter.avance) : 'Leído · metiéndolo en prueba', tono: 'azul' }
  if (est === 'fallo') return { texto: 'No ha entrado en prueba', tono: 'ambar' }
  if (est === 'acabado') {
    if (!e.antes) return { texto: 'En prueba · comparando', tono: 'azul' }
    // X14 · 2 · Sin el sumas y saldos de ERP10 comparado, cuenta a cuenta, no se dice que cuadra (el resumen del mes solo no).
    if (!e.antes.comparado || !e.antes.cuentas) return { texto: 'En prueba · falta comparar el sumas y saldos', tono: 'ambar' }
    return cuadra(e).todo ? { texto: '✓ Leído y cuadra con ERP10', tono: 'verde' } : { texto: 'No cuadra con ERP10', tono: 'ambar' }
  }
  return null
}

/** Las siete filas, en el estado que toque. */
export function filasUnBoton(e: EntradaUnBoton): FilaUnBoton[] {
  const est = estadoUnBoton(e)
  return FILAS_UN_BOTON.map(({ tipo, que, antes }) => {
    const base: FilaUnBoton = { tipo, que, icono: 'vacio', cifra: null, linea: antes, barra: null, verlos: null }
    if (est === 'antes') return base
    if (est === 'trayendo' || est === 'parado' || (est === 'metiendo' && !e.carga)) return mientras(e, tipo, base)
    return alAcabar(e, tipo, base)
  })
}

function mientras(e: EntradaUnBoton, tipo: TipoUnBoton, base: FilaUnBoton): FilaUnBoton {
  const l = e.lector
  if (!l) return base
  const que = QUE_DE[tipo]
  const delQue = l.partes.filter((p) => p.que === que)
  const hechas = delQue.filter((p) => l.hechas.includes(`${p.que}:${p.mes ?? ''}`)).length
  const todas = delQue.length > 0 && hechas === delQue.length
  const c = l.cuantos
  const cifra = tipo === 'plan_cuentas' ? cuantos(c.subcuentas, 'cuenta', 'cuentas') : tipo === 'proveedores' ? cuantos(c.proveedores, 'ficha', 'fichas')
    : tipo === 'clientes' ? cuantos(c.clientes, 'ficha', 'fichas') : tipo === 'diario' ? cuantos(c.asientos, 'asiento', 'asientos') : null
  if (tipo === 'sumas_saldos') return { ...base, linea: 'Se compara al final, con el fichero de ERP10' }
  if (todas) {
    // Las facturas: emitidas o recibidas se sabe al acabar todas (la serie cuenta entera).
    return { ...base, icono: 'hecho', cifra: cifra ?? cuantos(c.facturas, 'factura leída', 'facturas leídas'), linea: tipo === 'proveedores' || tipo === 'clientes' ? 'con NIF y dirección' : '' }
  }
  const enCurso = l.enCurso && l.enCurso.parte.que === que ? l.enCurso.parte : null
  const parado = l.estado === 'cortado'
  if (!enCurso) return { ...base, linea: que === 'facturas' ? 'Después del diario' : 'En cola' }
  const mes = enCurso.mes
  const texto = mes ? `${mesSolo(mes)} · ${hechas + 1} de ${delQue.length} meses` : ''
  if (parado) return { ...base, icono: 'vacio', cifra, linea: mes ? `Parado en ${texto}` : 'Parado', barra: delQue.length ? hechas / delQue.length : null }
  return { ...base, icono: 'leyendo', cifra, linea: mes ? `Leyendo ${texto}` : 'Leyendo', barra: delQue.length ? hechas / delQue.length : null }
}

function alAcabar(e: EntradaUnBoton, tipo: TipoUnBoton, base: FilaUnBoton): FilaUnBoton {
  const c = e.carga, p = e.enPrueba?.cuentas ?? {}
  const avisos = c?.ficheros.find((f) => f.tipo === tipo)?.avisos ?? []
  const fila = (cifra: string | null, ok: string, mira: { texto: string; lista: string[] } | null): FilaUnBoton => mira
    ? { ...base, icono: 'mira', cifra, linea: mira.texto, verlos: { titulo: `${base.que}: ${mira.texto}`, lista: mira.lista } }
    : { ...base, icono: 'hecho', cifra, linea: ok }
  const masAvisos = (x: { texto: string; lista: string[] } | null, extra: string[]): { texto: string; lista: string[] } | null => {
    if (!extra.length) return x
    if (!x) return { texto: cuantos(extra.length, 'cosa que mirar', 'cosas que mirar'), lista: extra }
    return { texto: `${x.texto} y ${cuantos(extra.length, 'cosa más', 'cosas más')}`, lista: [...x.lista, ...extra] }
  }
  switch (tipo) {
    case 'plan_cuentas': {
      const cifra = c?.plan ? cuantos(c.plan.subcuentas.length, 'cuenta', 'cuentas') : cuantos((p.cuentas_nuevas ?? 0) + (p.cuentas_estaban ?? 0), 'cuenta', 'cuentas')
      return fila(cifra, '', masAvisos(null, avisos))
    }
    case 'proveedores':
    case 'clientes': {
      const ts = (tipo === 'proveedores' ? c?.proveedores : c?.clientes)?.terceros
      if (!ts) return fila(cuantos(p[tipo === 'proveedores' ? 'proveedores_nuevos' : 'clientes_nuevos'] ?? 0, 'nuevo', 'nuevos'), '', null)
      const sin = ts.filter((t) => !t.nif)
      const mira = sin.length ? { texto: `${n(sin.length)} sin NIF`, lista: sin.map((t) => `${t.codigo} · ${t.nombreFiscal}`) } : null
      // «… no trae NIF» ya es el «sin NIF» de la fila: no se cuenta dos veces.
      return fila(cuantos(ts.length, 'ficha', 'fichas'), 'con NIF y dirección', masAvisos(mira, avisos.filter((a) => !/no trae NIF\.?$/.test(a))))
    }
    case 'diario': {
      const cifra = cuantos(c?.diario ? c.diario.asientos.length : p.asientos ?? 0, 'asiento', 'asientos')
      const r = c?.conexion?.resumen
      const otros = r ? avisos.filter((a) => !r.frases.includes(a)) : avisos
      const mira = r && !r.cuadra ? { texto: r.nota, lista: r.frases } : null
      return fila(cifra, r?.cuadra ? 'igual que en ERP10, mes a mes' : '', masAvisos(mira, otros))
    }
    case 'expedidas':
    case 'recibidas': {
      const l = tipo === 'expedidas' ? c?.expedidas : c?.recibidas
      const cifra = cuantos(l ? l.facturas.length : p[tipo === 'expedidas' ? 'facturas_emitidas' : 'facturas_recibidas'] ?? 0, 'factura', 'facturas')
      if (!c) return fila(cifra, '', null)
      const sinSaber = tipo === 'recibidas' ? (c.conexion?.sinSaber ?? []) : []
      const mira = sinSaber.length ? { texto: `${n(sinSaber.length)} sin saber si son recibidas`, lista: sinSaber } : null
      return fila(cifra, 'todas con su asiento', masAvisos(mira, avisos))
    }
    case 'sumas_saldos': {
      const a = e.antes
      if (!a) return { ...base, linea: 'Comparando…' }
      // X14 · 2 · Sin el sumas y saldos de ERP10 (su fichero), no se ha comparado nada: nunca «Cuadra» (Julio, 25/11).
      if (!a.comparado || !a.cuentas) {
        return fila('Sin comparar', '', { texto: 'No se ha podido comparar: suelta el sumas y saldos de ERP10',
          lista: ['El sumas y saldos que se ve sin el fichero sale de sumar los mismos asientos leídos: no compara nada.',
                  'Sácalo de ERP10 (el sumas y saldos del ejercicio, en Excel) y suéltalo aquí. Sin compararlo, no se da por bueno.'] })
      }
      if (a.diferencias.length) {
        const lista = a.diferencias.map((d) => `${d.cuenta} · ${d.nombre}: en ERP10, ${euros(Number(d.alli_debe) - Number(d.alli_haber))}; en Sumied, ${euros(Number(d.traido_debe) - Number(d.traido_haber))}.`)
        return fila('No cuadra', '', { texto: `${cuantos(a.diferencias.length, 'cuenta no queda igual', 'cuentas no quedan igual')}`, lista })
      }
      return fila('Cuadra', `las ${n(a.cuentas)} cuentas, iguales en Sumied y en ERP10 al céntimo, debe y haber`, null)
    }
  }
}

/** «2 cosas que mirar · no paran nada»: las filas en ámbar, lo que apuntó la base al traer y lo de fuera de las filas. */
export function loQueMirar(e: EntradaUnBoton, filas: readonly FilaUnBoton[]): { titulo: string; texto: string; lista: string[] } | null {
  const enFilas = filas.filter((f) => f.icono === 'mira')
  const base = e.enPrueba?.mirar.map((m) => m.frase) ?? []
  const sueltos = (e.carga?.avisos ?? []).filter((a) => !a.startsWith('Una factura de ERP10 no se sabe') && !/facturas de ERP10 no se sabe/.test(a))
  const cosas = enFilas.length + (base.length ? 1 : 0) + (sueltos.length ? 1 : 0)
  if (!cosas) return null
  const para = e.antes && !e.antes.puede
  const partes = [...enFilas.map((f) => `${f.que.toLowerCase()}: ${f.linea}`), ...(base.length ? [`${cuantos(base.length, 'cosa apuntada', 'cosas apuntadas')} al traerlo`] : []), ...(sueltos.length ? [cuantos(sueltos.length, 'aviso', 'avisos')] : [])]
  const sinSaber = (e.carga?.conexion?.sinSaber.length ?? 0) > 0
  return {
    titulo: `${cuantos(cosas, 'cosa que mirar', 'cosas que mirar')}${para ? '' : ' · no paran nada'}`,
    texto: `${partes.join('; ')}.${para ? ` ${e.antes!.texto}` : ' Puedes darlo por bueno igual.'}${sinSaber ? ' Las facturas que no se sabe si son emitidas o recibidas no entran: mételas a mano o súbelas con su fichero.' : ''}`,
    lista: [...base, ...sueltos],
  }
}

/** Lo que dice la confirmación de «Darlo por bueno»: lo de la base y, si no cuadra con ERP10, la diferencia escrita. */
export function confirmarDarlo(e: EntradaUnBoton): { texto: string; boton: string; puede: boolean } {
  const a = e.antes
  if (!a) return { texto: 'Comparando con ERP10…', boton: 'Darlo por bueno', puede: false }
  const r = e.carga?.conexion?.resumen
  if (!a.puede) return { texto: a.texto, boton: 'Darlo por bueno', puede: false }
  if (r && !r.cuadra) return { texto: `${a.texto} Lo leído no da lo mismo que el resumen de ERP10: ${r.frases.join(' ')}`, boton: 'Darlo por bueno igual', puede: true }
  return { texto: a.texto, boton: 'Darlo por bueno', puede: true }
}

/** Lo que dice la confirmación de «Descartar lo traído»: lo que quita. */
export function confirmarDescartar(e: EntradaUnBoton): string {
  const p = e.enPrueba?.cuentas ?? {}
  const q = [
    cuantos(p.asientos ?? 0, 'asiento', 'asientos'), cuantos((p.facturas_recibidas ?? 0) + (p.facturas_emitidas ?? 0), 'factura', 'facturas'),
    cuantos(p.cuentas_nuevas ?? 0, 'cuenta nueva', 'cuentas nuevas'), cuantos(p.proveedores_nuevos ?? 0, 'proveedor', 'proveedores'), cuantos(p.clientes_nuevos ?? 0, 'cliente', 'clientes'),
  ]
  return `Vas a descartar lo traído: se quita todo lo que entró en prueba (${q.slice(0, -1).join(', ')} y ${q[q.length - 1]}) y la empresa queda como estaba antes de traerlo. En ERP10 no cambia nada.`
}

/** Las frases de lo que hace la base (las mismas en la pantalla y en el PR). */
export const FRASES_UN_BOTON = {
  unBoton: 'Sumied lo lee todo de ERP10, lo compara con lo que dice ERP10 y te dice si cuadra. Entra en prueba: hasta que lo des por bueno, se deshace entero.',
  soloLee: 'Solo se lee.',
  queEstaPasando: 'Sumied solo lee ERP10: allí no cambia nada.',
  cuandoAcabe: 'Lo mete en prueba, lo compara con lo que dice ERP10 y te avisa de lo que haya que mirar. Hasta que lo des por bueno, se deshace entero.',
  parado: 'Lo has parado. Lo leído se queda: «Seguir trayendo de ERP10» sigue donde se quedó, sin volver a leerlo.',
  pieAntes: 'Tarda unos minutos por ejercicio (en una empresa con 8.000 asientos, unos 12). Puedes seguir trabajando mientras.',
  pieTrayendo: 'Puedes seguir trabajando en otra pestaña. Si se corta o cierras Sumied, sigue donde se quedó.',
  pieAcabado: 'Está en prueba: lo traído no se puede pagar ni cobrar, y hasta que lo des por bueno se deshace entero. Al darlo por bueno queda fijo: ya no se puede deshacer.',
  aprendido: (k: number) => k
    ? `El IVA habitual de ${cuantos(k, 'proveedor', 'proveedores')}, sacado de sus facturas: queda propuesto en su ficha, sin pisar lo que ya tenga. Lo verás al contabilizar su siguiente factura.`
    : 'Nada nuevo: los proveedores traídos no tienen facturas de las que sacar su IVA, o ya lo tenían en su ficha.',
} as const

/** La frase corta de lo que se lee ahora (para el estado de la pantalla). */
export const leyendoAhora = (l: LectorVisto | null): string | null =>
  l?.enCurso?.parte.mes ? `${l.enCurso.parte.que === 'apuntes' ? 'Asientos' : l.enCurso.parte.que === 'facturas' ? 'Facturas' : 'Cuentas'} de ${mesDeGente(l.enCurso.parte.mes)}` : null
