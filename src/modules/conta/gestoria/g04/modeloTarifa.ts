// src/modules/conta/gestoria/g04/modeloTarifa.ts
//
// G04 · Tarea 4 · De lo leído (datos.ts) a lo que pinta «Tarifa y paquetes»
// (tablero Tarifa de la maqueta del 08/11): la lista de servicios y paquetes
// con su resumen y sus clientes, y el detalle del elegido (niveles en
// tarjetas; forma de cobro con sus tramos y «Pruébalo»; paquete con lo que
// incluye, su ahorro y su exceso), y los clientes con precio especial.
// Palabras (Julio, 08/11): «Precio especial» solo si hay precio general y el
// del cliente es distinto; sin precio general, «Precio de este cliente». Nada
// se inventa: sin precio, lo dice. Puro: lo prueba
// tests/unit/modules/conta/gestoria/g04/modeloTarifa.test.ts.

import { QUE_INCLUYE_POR_DEFECTO } from '../../../../../supabase/functions/_shared/facturaSumiedPdf'
import {
  claveDe, euros, importeDeForma, porSeparado, precioDelMes, vale, type Forma, type Objetivo, type Precio,
} from '../../../../../supabase/functions/_shared/tarifa/precio'
import { ensayarCambio, type CambioDePrecios, type Ensayo } from '../../../../../supabase/functions/_shared/tarifa/cambioPrecios'
import { catalogoYAsignaciones } from './modelo'
import type { DatosClientes } from './datos'

export type FormaTipo = Forma['tipo']

export interface Entrada {
  id: string
  tipo: 'servicio' | 'paquete'
  nombre: string
  resumen: string
  clientes: number
  /** Un trabajo suelto (se cobra cada vez que se hace): sin clientes fijos, «Cuando toque». */
  cuandoToque?: boolean
}

export interface Regla { tramo: string; importe: string; unidad: string }

export interface DetalleTarifa {
  entrada: Entrada
  /** «Servicio con niveles», «Servicio» o «Paquete». */
  tipoTexto: string
  descripcion: string | null
  /** G05 · El «Qué incluye» del servicio (sale en la factura debajo de su nombre): el suyo o, sin él, el de siempre del catálogo. Null en un paquete. */
  queIncluye: { texto: string | null; porDefecto: boolean } | null
  niveles: { id: string; nombre: string; precio: string | null; incluye: string[]; masElegido: boolean; clientes: number }[]
  /** El precio general de la tarifa (si lo hay), para la forma de cobro y «Pruébalo». */
  general: Precio | null
  formaTipo: FormaTipo | null
  reglas: Regla[]
  porTrabajador: boolean
  paquete: { lineas: { texto: string; detalle: string; suelto: string | null; objetivo: Objetivo; limite: number | null }[]; precio: string | null; porSeparado: string | null; ahorro: string | null; exceso: string } | null
  /** Los clientes con su propio precio: los especiales (con general distinto) o, sin general, todos los que tienen el suyo. */
  especiales: { clienteId: string; cliente: string; precio: string; desde: string; palabra: 'Precio especial' | 'Precio de este cliente' }[]
  sinPrecioGeneral: boolean
  /** El exceso del paquete (para guardarlo igual al añadirle un servicio). */
  excesoCent?: number | null
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesLargo = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
const sinCentimos = (cent: number) => (cent % 100 === 0 ? `${String(cent / 100).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €` : euros(cent))

/** Una forma en palabras cortas, para el resumen de la lista y el precio de un cliente. */
export function formaEnPalabras(f: Forma): string {
  switch (f.tipo) {
    case 'fijo': return f.periodo === 'anio' ? `${euros(f.importeCent)} al año` : f.periodo === 'vez' ? `${euros(f.importeCent)} cada vez` : `${euros(f.importeCent)} al mes`
    case 'por_trabajador': return `${euros(f.importeCent)} por trabajador`
    case 'tramos': return `Por tramos · ${f.tramos.length} ${f.tramos.length === 1 ? 'tramo' : 'tramos'}`
    case 'tramo_y_por_trabajador': {
      const ts = [...f.tramos].sort((a, b) => a.desde - b.desde)
      const cerrado = ts.find((t) => !t.porUnidad)
      const despues = ts.find((t) => t.porUnidad)
      return cerrado && despues ? `Tramo ${cerrado.desde}–${cerrado.hasta ?? '…'} por ${sinCentimos(cerrado.importeCent)}, después ${sinCentimos(despues.importeCent)}` : 'Tramo y por trabajador'
    }
  }
}

/** El resumen de la lista de la izquierda (palabras del tablero Tarifa): «Fijo · 605 € al año», «Trabajo suelto · 60 €». */
export function resumenDeForma(f: Forma): string {
  if (f.tipo === 'fijo') return f.periodo === 'vez' ? `Trabajo suelto · ${sinCentimos(f.importeCent)}` : `Fijo · ${sinCentimos(f.importeCent)} al ${f.periodo === 'anio' ? 'año' : 'mes'}`
  if (f.tipo === 'por_trabajador') return `${sinCentimos(f.importeCent)} por trabajador`
  return formaEnPalabras(f)
}

/** Las filas de «Cómo se cobra» de una forma. */
export function reglasDe(f: Forma): Regla[] {
  const imp = (c: number) => euros(c).replace(' €', '')
  switch (f.tipo) {
    case 'fijo': return [{ tramo: f.periodo === 'anio' ? 'Cada año' : f.periodo === 'vez' ? 'Cada vez' : 'Cada mes', importe: imp(f.importeCent), unidad: f.periodo === 'anio' ? '€ al año' : f.periodo === 'vez' ? '€' : '€ al mes' }]
    case 'por_trabajador': return [{ tramo: 'Cada trabajador de alta', importe: imp(f.importeCent), unidad: '€ al mes' }]
    case 'tramos': return [...f.tramos].sort((a, b) => a.desde - b.desde).map((t) => ({
      tramo: t.hasta === null ? `Desde ${t.desde} trabajadores` : `De ${t.desde} a ${t.hasta} trabajadores`, importe: imp(t.importeCent), unidad: t.porUnidad ? '€ por cada uno' : '€ al mes, el tramo' }))
    case 'tramo_y_por_trabajador': return [...f.tramos].sort((a, b) => a.desde - b.desde).map((t) => ({
      tramo: t.porUnidad ? `Desde el ${t.desde}.º trabajador` : t.hasta === null ? `Desde ${t.desde} trabajadores` : `De ${t.desde} a ${t.hasta} trabajadores`,
      importe: imp(t.importeCent), unidad: t.porUnidad ? '€ por cada uno' : '€ al mes, cerrado' }))
  }
}

/** «Pruébalo»: lo que cuesta con N trabajadores. */
export function pruebalo(f: Forma, n: number): { total: string; cuenta: string } {
  const r = importeDeForma(f, n)
  return r ? { total: euros(r.cent), cuenta: r.cuenta } : { total: '—', cuenta: `Ningún tramo para ${n} trabajadores` }
}

/** Lo que guarda conta_tarifa_precio_guardar de una forma (importes en euros). */
export function formaParaGuardar(f: Forma): { forma: string; periodo: string | null; importe: number | null; tramos: { desde: number; hasta: number | null; importe: number; porUnidad: boolean }[] | null } {
  const eur = (c: number) => Math.round(c) / 100
  switch (f.tipo) {
    case 'fijo': return { forma: 'fijo', periodo: f.periodo, importe: eur(f.importeCent), tramos: null }
    case 'por_trabajador': return { forma: 'por_trabajador', periodo: null, importe: eur(f.importeCent), tramos: null }
    default: return { forma: f.tipo, periodo: null, importe: null, tramos: f.tramos.map((t) => ({ desde: t.desde, hasta: t.hasta, importe: eur(t.importeCent), porUnidad: t.porUnidad })) }
  }
}

/** Una de las casillas de «Qué cambia». */
export interface OpcionDeCambio { clave: string; nombre: string; objetivo: Objetivo }

export interface ModeloTarifa {
  entradas: Entrada[]
  detalle: (id: string) => DetalleTarifa | null
  /** Lo que tiene precio de tarifa (cada nivel, cada servicio sin niveles, cada paquete), para «Qué cambia». */
  opciones: OpcionDeCambio[]
  /** Los clientes con algo de esta empresa este mes, para «Solo los clientes que yo elija». */
  clientes: { id: string; nombre: string; nif: string | null }[]
  /** El ensayo de «Cambiar precios», sin guardar nada (cambioPrecios.ts). */
  ensayar: (op: Omit<CambioDePrecios, 'empresaId'>) => Ensayo
  nombreDeCliente: (id: string) => string
}

export function modeloTarifa(d: DatosClientes, empresaId: string, hoy: string): ModeloTarifa {
  const mes = hoy.slice(0, 7)
  const { catalogo, asignaciones } = catalogoYAsignaciones(d)
  const precios = catalogo.precios.filter((p) => p.empresaId === empresaId && !p.id.startsWith('propio:'))
  const nombreCliente = new Map(d.clientes.map((c) => [String(c.cliente_id), String(c.cliente ?? '')]))
  const vigentes = asignaciones.filter((a) => a.empresaId === empresaId && vale(a.desde, a.hasta, mes))
  const general = (o: Objetivo) => precios.filter((p) => p.clienteId === null && claveDe(p.objetivo) === claveDe(o) && vale(p.desde, p.hasta, mes))
    .sort((a, b) => (a.desde < b.desde ? 1 : -1))[0] ?? null
  const servicios = d.servicios.filter((s) => s.company_id === empresaId && s.activo !== false)
  const clientesDe = (pred: (o: Objetivo) => boolean) => new Set(vigentes.filter((a) => pred(a.objetivo)).map((a) => a.clienteId)).size
  /** Con cuántos trabajadores se compara un paquete con lo suelto: su límite más bajo (0 si no va por trabajadores). */
  const topeDe = (p: { lineas: { limiteTrabajadores: number | null }[] }) => {
    const t = p.lineas.map((l) => l.limiteTrabajadores).filter((x): x is number => x !== null)
    return t.length ? Math.min(...t) : 0
  }
  const delServicio = (sid: string) => (o: Objetivo) => o.tipo !== 'paquete' && o.servicioId.split('#')[0] === sid

  const entradas: Entrada[] = [
    ...servicios.map((s) => {
      const sid = String(s.id)
      const niveles = catalogo.niveles.filter((n) => n.servicioId === sid)
      let resumen: string
      if (niveles.length) {
        const ps = niveles.map((n) => general({ tipo: 'nivel', servicioId: sid, nivelId: n.id })).filter((p): p is Precio => !!p && p.forma.tipo === 'fijo')
          .map((p) => (p.forma as { importeCent: number }).importeCent)
        resumen = `${niveles.length} ${niveles.length === 1 ? 'nivel' : 'niveles'}${ps.length ? ` · de ${sinCentimos(Math.min(...ps)).replace(' €', '')} a ${sinCentimos(Math.max(...ps))} al mes` : ''}`
      } else {
        const g = general({ tipo: 'servicio', servicioId: sid })
        resumen = g ? resumenDeForma(g.forma) : 'Sin precio de tarifa · cada cliente con el suyo'
      }
      const suelto = !niveles.length && general({ tipo: 'servicio', servicioId: sid })?.forma
      return { id: `servicio:${sid}`, tipo: 'servicio' as const, nombre: String(s.nombre), resumen, clientes: clientesDe(delServicio(sid)),
        cuandoToque: !!suelto && suelto.tipo === 'fijo' && suelto.periodo === 'vez' }
    }),
    ...catalogo.paquetes.filter((p) => p.empresaId === empresaId).map((p) => {
      const g = general({ tipo: 'paquete', paqueteId: p.id })
      const suelto = porSeparado(catalogo, p, topeDe(p), mes)
      const precio = g && g.forma.tipo === 'fijo' ? g.forma.importeCent : null
      const resumen = precio === null ? 'Sin precio' : `${sinCentimos(precio)} al mes${suelto !== null && suelto > precio ? ` · ahorra ${sinCentimos(suelto - precio)}` : ''}`
      return { id: `paquete:${p.id}`, tipo: 'paquete' as const, nombre: p.nombre, resumen, clientes: clientesDe((o) => o.tipo === 'paquete' && o.paqueteId === p.id) }
    }),
  ]

  const especialesDe = (o: Objetivo, hayGeneral: boolean): DetalleTarifa['especiales'] => {
    const porCliente = new Map<string, Precio>()
    for (const p of precios.filter((x) => x.clienteId !== null && claveDe(x.objetivo) === claveDe(o) && vale(x.desde, x.hasta, mes))) {
      const ya = porCliente.get(p.clienteId!)
      if (!ya || p.desde > ya.desde) porCliente.set(p.clienteId!, p)
    }
    return [...porCliente.values()]
      .filter((p) => !hayGeneral || precioDelMes(precios, empresaId, o, p.clienteId!, mes)?.dePrecio === 'especial')
      .map((p) => ({ clienteId: p.clienteId!, cliente: nombreCliente.get(p.clienteId!) ?? 'Cliente', precio: formaEnPalabras(p.forma), desde: `Desde ${mesLargo(p.desde)}`,
        palabra: (hayGeneral ? 'Precio especial' : 'Precio de este cliente') as 'Precio especial' | 'Precio de este cliente' }))
      .sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'))
  }

  const detalle = (id: string): DetalleTarifa | null => {
    const entrada = entradas.find((e) => e.id === id)
    if (!entrada) return null
    if (entrada.tipo === 'servicio') {
      const sid = id.slice('servicio:'.length)
      const s = servicios.find((x) => String(x.id) === sid)
      const niveles = catalogo.niveles.filter((n) => n.servicioId === sid).sort((a, b) => a.orden - b.orden).map((n) => {
        const g = general({ tipo: 'nivel', servicioId: sid, nivelId: n.id })
        return { id: n.id, nombre: n.nombre, precio: g && g.forma.tipo === 'fijo' ? euros(g.forma.importeCent).replace(' €', '') : null, incluye: n.incluye, masElegido: n.masElegido,
          clientes: clientesDe((o) => o.tipo === 'nivel' && o.nivelId === n.id) }
      })
      const g = niveles.length ? null : general({ tipo: 'servicio', servicioId: sid })
      const especiales = niveles.length
        ? catalogo.niveles.filter((n) => n.servicioId === sid).flatMap((n) => especialesDe({ tipo: 'nivel', servicioId: sid, nivelId: n.id }, !!general({ tipo: 'nivel', servicioId: sid, nivelId: n.id }))
          .map((e) => ({ ...e, precio: `${n.nombre} a ${e.precio}` })))
        : especialesDe({ tipo: 'servicio', servicioId: sid }, !!g)
      return {
        entrada, tipoTexto: niveles.length ? 'Servicio con niveles' : 'Servicio', descripcion: null, niveles, general: g,
        queIncluye: s && typeof s.incluye === 'string' && s.incluye.trim() ? { texto: s.incluye.trim(), porDefecto: false }
          : { texto: QUE_INCLUYE_POR_DEFECTO[String(s?.clave ?? '')] ?? null, porDefecto: true },
        formaTipo: g?.forma.tipo ?? null, reglas: g ? reglasDe(g.forma) : [], porTrabajador: s?.forma === 'por_empleado' || g?.forma.tipo !== 'fijo' && !!g,
        paquete: null, especiales, sinPrecioGeneral: !niveles.length && !g,
      }
    }
    const pid = id.slice('paquete:'.length)
    const p = catalogo.paquetes.find((x) => x.id === pid)!
    const g = general({ tipo: 'paquete', paqueteId: pid })
    const precio = g && g.forma.tipo === 'fijo' ? g.forma.importeCent : null
    const n = topeDe(p)
    const suelto = porSeparado(catalogo, p, n, mes)
    const nombreDe = (o: Objetivo) => {
      if (o.tipo === 'paquete') return ''
      const s = catalogo.servicios.find((x) => x.id === o.servicioId)?.nombre ?? 'Servicio'
      return o.tipo === 'nivel' ? `${s} · ${catalogo.niveles.find((x) => x.id === o.nivelId)?.nombre ?? ''}` : s
    }
    return {
      entrada, tipoTexto: 'Paquete', descripcion: p.descripcion, queIncluye: null, niveles: [], general: g, formaTipo: g?.forma.tipo ?? null, reglas: [], porTrabajador: false,
      excesoCent: p.excesoPorTrabajadorCent,
      paquete: {
        lineas: p.lineas.map((l) => {
          const gl = general(l.objetivo)
          const imp = gl ? importeDeForma(gl.forma, l.limiteTrabajadores ?? 0) : null
          return { texto: nombreDe(l.objetivo), detalle: l.limiteTrabajadores !== null ? `Hasta ${l.limiteTrabajadores} trabajadores` : 'Cada mes', suelto: imp ? euros(imp.cent) : null,
            objetivo: l.objetivo, limite: l.limiteTrabajadores }
        }),
        precio: precio === null ? null : euros(precio).replace(' €', ''),
        porSeparado: suelto === null ? null : `${euros(suelto)} al mes`,
        ahorro: suelto !== null && precio !== null && suelto > precio ? `${euros(suelto - precio)} al mes (${sinCentimos((suelto - precio) * 12)} al año)` : null,
        exceso: p.excesoPorTrabajadorCent !== null && n > 0
          ? `Desde el ${n + 1}.º trabajador se cobra cada uno a ${euros(p.excesoPorTrabajadorCent)} al mes.`
          : 'Este paquete no cobra nada aparte si el cliente se pasa.',
      },
      especiales: especialesDe({ tipo: 'paquete', paqueteId: pid }, !!g), sinPrecioGeneral: !g,
    }
  }
  const nombreDe = (o: Objetivo): string => {
    if (o.tipo === 'paquete') return catalogo.paquetes.find((x) => x.id === o.paqueteId)?.nombre ?? 'Paquete'
    const sv = catalogo.servicios.find((x) => x.id === o.servicioId)?.nombre ?? 'Servicio'
    return o.tipo === 'nivel' ? `${sv} · ${catalogo.niveles.find((x) => x.id === o.nivelId)?.nombre ?? ''}` : sv
  }
  const opciones: OpcionDeCambio[] = []
  for (const s of servicios) {
    const sid = String(s.id)
    const niveles = catalogo.niveles.filter((n) => n.servicioId === sid).sort((a, b) => a.orden - b.orden)
    const objetivos: Objetivo[] = niveles.length ? niveles.map((n) => ({ tipo: 'nivel', servicioId: sid, nivelId: n.id })) : [{ tipo: 'servicio', servicioId: sid }]
    for (const o of objetivos) if (general(o)) opciones.push({ clave: claveDe(o), nombre: nombreDe(o), objetivo: o })
  }
  for (const p of catalogo.paquetes.filter((x) => x.empresaId === empresaId)) {
    const o: Objetivo = { tipo: 'paquete', paqueteId: p.id }
    if (general(o)) opciones.push({ clave: claveDe(o), nombre: p.nombre, objetivo: o })
  }
  const clientes = [...new Set(vigentes.map((a) => a.clienteId))].map((id) => {
    const c = d.clientes.find((x) => String(x.cliente_id) === id)
    return { id, nombre: nombreCliente.get(id) || 'Cliente', nif: c && typeof c.nif === 'string' ? c.nif : null }
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  // Las líneas con su propio importe (importadas así de GoCardless) no son de la tarifa: no las cambia «Cambiar precios».
  const catalogoDeEmpresa = { ...catalogo, precios: precios }
  const deTarifa = asignaciones.filter((a) => a.empresaId === empresaId && (a.objetivo.tipo === 'paquete' || !a.objetivo.servicioId.includes('#')))
  return {
    entradas, detalle, opciones, clientes,
    ensayar: (op) => ensayarCambio(catalogoDeEmpresa, deTarifa, { ...op, empresaId }, nombreDe),
    nombreDeCliente: (id) => nombreCliente.get(id) || 'Cliente',
  }
}
