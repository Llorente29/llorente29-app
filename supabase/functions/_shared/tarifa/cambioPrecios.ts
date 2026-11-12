// supabase/functions/_shared/tarifa/cambioPrecios.ts
//
// G04 · Tarea 2 (08/11/2026). El ENSAYO de «Cambiar precios»: qué precios
// cambian, cliente a cliente, y cuánto sube o baja el total, sin guardar nada.
// Sin ensayo no se aplica nada: lo que se aplica es lo que devuelve esto
// («guardar»), tal cual. Puro.
//
// Reglas (Julio, 07/11):
//   · Sube o baja, en % o en €, desde un mes.
//   · A uno, varios o todos los servicios, niveles y paquetes.
//   · A todos los clientes que los tienen, a los elegidos a mano, o a los que
//     cumplen un filtro («que tengan Gestión laboral», «más de 10
//     trabajadores»).
//   · Se elige si los precios del cliente (especiales o «de este cliente»)
//     cambian también o se quedan como están.
//
// Cómo se guarda, sin tocar a nadie más de la cuenta:
//   · A TODOS: el precio general cambia desde ese mes (un precio nuevo con
//     «desde»; el de antes acaba el mes anterior). Quien paga la tarifa lo
//     recibe solo. Los precios del cliente cambian si se elige.
//   · A ALGUNOS (elegidos o filtro): el general NO se toca (llegaría a todos).
//     Cada cliente que paga la tarifa recibe un precio suyo desde ese mes, con
//     el nuevo importe; su precio pasa a ser «especial». Los que ya tienen
//     precio suyo cambian si se elige.
//   · Una bajada nunca deja un importe por debajo de 0: se queda en 0 y se dice.
//
// Importes en céntimos. Lo prueban tests/unit/modules/conta/gestoria/g04/cambioPrecios.test.ts.

import {
  claveDe, euros, precioDelMes, reciboDelMes, trabajadoresDelMes, vale,
  type Asignacion, type Catalogo, type Forma, type Mes, type Objetivo, type Precio,
} from './precio.ts'

export type Cantidad = { tipo: 'porcentaje'; valor: number } | { tipo: 'euros'; cent: number }

export type AQuien =
  | { tipo: 'todos' }
  | { tipo: 'elegidos'; clienteIds: string[] }
  | { tipo: 'filtro'; queTengan?: Objetivo; trabajadoresDesde?: number; trabajadoresHasta?: number }

export interface CambioDePrecios {
  empresaId: string
  sentido: 'subir' | 'bajar'
  cantidad: Cantidad
  desde: Mes
  /** Null: todo lo que tiene precio en la tarifa de la empresa. */
  que: Objetivo[] | null
  aQuien: AQuien
  /** Si los precios propios del cliente cambian también. */
  preciosDelCliente: 'cambian' | 'se_quedan'
}

export interface LineaDelEnsayo {
  clienteId: string
  objetivo: Objetivo
  antesCent: number | null
  despuesCent: number | null
  /** «tarifa» (le llega por el general), «suyo» (su precio propio cambia) o «nuevo_suyo» (pasa a precio especial). */
  como: 'tarifa' | 'suyo' | 'nuevo_suyo'
}

export interface Ensayo {
  lineas: LineaDelEnsayo[]
  clientes: number
  /** El mes «desde» de los clientes afectados, antes y después. */
  antesCent: number
  despuesCent: number
  /** Precios que se guardarían (nuevos, con su «desde»), y los que acaban el mes anterior. */
  guardar: { nuevos: Omit<Precio, 'id'>[]; acabanAntes: string[] }
  /** Importes que una bajada dejaría por debajo de 0 (se quedan en 0). */
  enCero: number
  frase: string
}

const r = (x: number) => Math.round(x)

/** Una forma con sus importes subidos o bajados. */
export function cambiarForma(f: Forma, sentido: CambioDePrecios['sentido'], c: Cantidad): { forma: Forma; enCero: number } {
  let enCero = 0
  const signo = sentido === 'subir' ? 1 : -1
  const uno = (cent: number) => {
    const nuevo = c.tipo === 'porcentaje' ? r(cent * (1 + (signo * c.valor) / 100)) : cent + signo * c.cent
    if (nuevo < 0) { enCero++; return 0 }
    return nuevo
  }
  switch (f.tipo) {
    case 'fijo': case 'por_trabajador': return { forma: { ...f, importeCent: uno(f.importeCent) }, enCero }
    default: return { forma: { ...f, tramos: f.tramos.map((t) => ({ ...t, importeCent: uno(t.importeCent) })) }, enCero }
  }
}

const mesAnterior = (mes: Mes): Mes => {
  const a = Number(mes.slice(0, 4)); const m = Number(mes.slice(5, 7))
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}

function entraEnElFiltro(f: Extract<AQuien, { tipo: 'filtro' }>, asigs: Asignacion[], clienteId: string, mes: Mes): boolean {
  const suyas = asigs.filter((a) => a.clienteId === clienteId && vale(a.desde, a.hasta, mes))
  if (f.queTengan && !suyas.some((a) => claveDe(a.objetivo) === claveDe(f.queTengan!))) return false
  if (f.trabajadoresDesde !== undefined || f.trabajadoresHasta !== undefined) {
    const n = Math.max(0, ...suyas.map((a) => trabajadoresDelMes(a.trabajadores, mes).deAlta.length))
    if (f.trabajadoresDesde !== undefined && n < f.trabajadoresDesde) return false
    if (f.trabajadoresHasta !== undefined && n > f.trabajadoresHasta) return false
  }
  return true
}

const nombreDelMes = (mes: Mes) => ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(mes.slice(5, 7)) - 1] ?? mes

export function ensayarCambio(c: Catalogo, asignaciones: Asignacion[], op: CambioDePrecios, nombreDe: (o: Objetivo) => string): Ensayo {
  const mes = op.desde
  const deLaEmpresa = asignaciones.filter((a) => a.empresaId === op.empresaId && vale(a.desde, a.hasta, mes))
  const claves = op.que ? new Set(op.que.map(claveDe)) : null
  const toca = (o: Objetivo) => !claves || claves.has(claveDe(o))
  const clientesDe = [...new Set(deLaEmpresa.map((a) => a.clienteId))]
  const elegido = (id: string) =>
    op.aQuien.tipo === 'todos' ? true : op.aQuien.tipo === 'elegidos' ? op.aQuien.clienteIds.includes(id) : entraEnElFiltro(op.aQuien, deLaEmpresa, id, mes)

  // Los precios que valen ese mes, y los nuevos que saldrían.
  const valen = c.precios.filter((p) => p.empresaId === op.empresaId && toca(p.objetivo) && vale(p.desde, p.hasta, mes))
  const nuevos: Omit<Precio, 'id'>[] = []
  const acabanAntes: string[] = []
  let enCero = 0
  const nuevoDe = (p: Precio, clienteId: string | null) => {
    const x = cambiarForma(p.forma, op.sentido, op.cantidad)
    enCero += x.enCero
    nuevos.push({ empresaId: p.empresaId, objetivo: p.objetivo, clienteId, forma: x.forma, desde: mes, hasta: p.hasta })
    // Solo acaba el precio que se sustituye (el del mismo dueño): un precio suyo nuevo no cierra el general.
    if (p.desde < mes && p.clienteId === clienteId) acabanAntes.push(p.id)
  }
  const generales = valen.filter((p) => p.clienteId === null)
  if (op.aQuien.tipo === 'todos') generales.forEach((p) => nuevoDe(p, null))
  if (op.preciosDelCliente === 'cambian') valen.filter((p) => p.clienteId !== null && elegido(p.clienteId)).forEach((p) => nuevoDe(p, p.clienteId))
  if (op.aQuien.tipo !== 'todos') {
    // Los elegidos que pagan la tarifa: un precio suyo, nuevo.
    for (const id of clientesDe.filter(elegido)) {
      for (const g of generales) {
        const loTiene = deLaEmpresa.some((a) => a.clienteId === id && claveDe(a.objetivo) === claveDe(g.objetivo))
        const tieneSuyo = valen.some((p) => p.clienteId === id && claveDe(p.objetivo) === claveDe(g.objetivo))
        if (loTiene && !tieneSuyo) nuevoDe(g, id)
      }
    }
  }

  // El catálogo de después: los que acaban antes, cerrados el mes anterior; los nuevos, desde el mes.
  const despues: Catalogo = {
    ...c,
    precios: [
      ...c.precios.map((p) => (acabanAntes.includes(p.id) ? { ...p, hasta: mesAnterior(mes) } : p))
        // Un precio que empieza ese mismo mes y se sustituye: fuera.
        .filter((p) => !(p.desde === mes && nuevos.some((n) => n.clienteId === p.clienteId && claveDe(n.objetivo) === claveDe(p.objetivo)))),
      ...nuevos.map((n, i) => ({ ...n, id: `nuevo-${i}` })),
    ],
  }

  const lineas: LineaDelEnsayo[] = []
  let antesCent = 0
  let despuesCent = 0
  const afectados = new Set<string>()
  for (const id of clientesDe) {
    const rAntes = reciboDelMes(c, deLaEmpresa, id, op.empresaId, mes)
    const rDespues = reciboDelMes(despues, deLaEmpresa, id, op.empresaId, mes)
    rAntes.lineas.forEach((la, k) => {
      const ld = rDespues.lineas[k]
      if (!toca(la.objetivo) || la.importeCent === ld.importeCent) return
      const antesP = precioDelMes(c.precios, op.empresaId, la.objetivo, id, mes)
      const tieneSuyo = c.precios.some((p) => p.clienteId === id && claveDe(p.objetivo) === claveDe(la.objetivo) && vale(p.desde, p.hasta, mes))
      lineas.push({ clienteId: id, objetivo: la.objetivo, antesCent: la.importeCent, despuesCent: ld.importeCent,
        como: tieneSuyo ? 'suyo' : op.aQuien.tipo === 'todos' && antesP ? 'tarifa' : 'nuevo_suyo' })
      afectados.add(id)
    })
  }
  for (const id of afectados) {
    antesCent += reciboDelMes(c, deLaEmpresa, id, op.empresaId, mes).totalCent
    despuesCent += reciboDelMes(despues, deLaEmpresa, id, op.empresaId, mes).totalCent
  }

  const que = op.que === null ? 'Toda la tarifa' : op.que.map(nombreDe).join(', ')
  const cuanto = op.cantidad.tipo === 'porcentaje' ? `un ${String(op.cantidad.valor).replace('.', ',')} %` : euros(op.cantidad.cent)
  const verbo = op.sentido === 'subir' ? (op.que?.length === 1 || op.que === null ? 'sube' : 'suben') : (op.que?.length === 1 || op.que === null ? 'baja' : 'bajan')
  const dif = despuesCent - antesCent
  const n = afectados.size
  const frase = n === 0
    ? `Con esto no cambia el precio de ningún cliente en ${nombreDelMes(mes)}.`
    : `${que} ${verbo} ${cuanto} desde ${nombreDelMes(mes)} para ${n} ${n === 1 ? 'cliente' : 'clientes'}. El total de ${nombreDelMes(mes)} ${dif >= 0 ? 'sube' : 'baja'} ${euros(Math.abs(dif))}: de ${euros(antesCent)} a ${euros(despuesCent)}.`
      + (enCero ? ` ${enCero} ${enCero === 1 ? 'importe se queda' : 'importes se quedan'} en 0 €: la bajada era mayor que el precio.` : '')

  return { lineas, clientes: n, antesCent, despuesCent, guardar: { nuevos, acabanAntes }, enCero, frase }
}
