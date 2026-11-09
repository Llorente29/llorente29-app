// supabase/functions/_shared/cobro/datos.ts
//
// G05 · Tarea 3 (09/11/2026). DE LAS FILAS DE LA BASE AL CATÁLOGO Y LAS
// ASIGNACIONES del cálculo del precio (_shared/tarifa/precio.ts). Era del G04
// (src/modules/conta/gestoria/g04/modelo.ts) y pasa aquí sin cambiar nada,
// para que el recibo lo calcule el SERVIDOR con el mismo código que la
// pantalla: lo que se cobra no puede venir del navegador. Puro.
//
// Lo prueban, como antes, tests/unit/modules/conta/gestoria/g04/modelo.test.ts
// y modeloTarifa.test.ts.

import type { Asignacion, Catalogo, Forma, Objetivo, Precio, Trabajador } from '../tarifa/precio.ts'

type Fila = Record<string, unknown>

/** Lo que hace falta leer de la base (las mismas filas que lee la pantalla de Clientes). */
export interface FilasDeLaTarifa {
  servicios: Fila[]
  precios: Fila[]
  asignaciones: Fila[]
  niveles: Fila[]
  paquetes: Fila[]
  lineasDePaquete: Fila[]
  ajustes: Fila[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const cent = (v: unknown): number => Math.round(Number(v ?? 0) * 100)
const mesDe = (d: unknown): string => String(d ?? '').slice(0, 7)

function formaDe(p: Fila): Forma {
  const imp = cent(p.importe)
  const tramos = Array.isArray(p.tramos) ? (p.tramos as Fila[]).map((t) => ({ desde: Number(t.desde), hasta: t.hasta == null ? null : Number(t.hasta), importeCent: cent(t.importe), porUnidad: !!t.porUnidad })) : []
  switch (p.forma) {
    case 'por_trabajador': return { tipo: 'por_trabajador', importeCent: imp }
    case 'tramos': return { tipo: 'tramos', tramos }
    case 'tramo_y_por_trabajador': return { tipo: 'tramo_y_por_trabajador', tramos }
    default: return { tipo: 'fijo', periodo: p.periodo === 'anio' ? 'anio' : p.periodo === 'vez' ? 'vez' : 'mes', importeCent: imp }
  }
}

function objetivoDe(x: Fila): Objetivo | null {
  if (x.paquete_id) return { tipo: 'paquete', paqueteId: String(x.paquete_id) }
  if (x.nivel_id) return { tipo: 'nivel', servicioId: String(x.servicio_id), nivelId: String(x.nivel_id) }
  if (x.servicio_id) return { tipo: 'servicio', servicioId: String(x.servicio_id) }
  return null
}

/**
 * El catálogo y lo que tiene cada cliente, para el cálculo. Las líneas de
 * trabajadores del mismo servicio se juntan en una asignación (sus
 * trabajadores). Una línea con su propio importe (importada así de GoCardless)
 * lleva su precio propio, solo para ella.
 */
export function catalogoYAsignaciones(d: FilasDeLaTarifa): { catalogo: Catalogo; asignaciones: Asignacion[] } {
  const servicios = d.servicios.map((s) => ({ id: String(s.id), empresaId: String(s.company_id), nombre: String(s.nombre) }))
  const precios: Precio[] = d.precios.map((p) => ({ id: String(p.id), empresaId: String(p.empresa_id), objetivo: objetivoDe(p)!, clienteId: str(p.cliente_id),
    forma: formaDe(p), desde: mesDe(p.desde), hasta: p.hasta ? mesDe(p.hasta) : null })).filter((p) => p.objetivo)
  const formaDelServicio = new Map(d.servicios.map((s) => [String(s.id), String(s.forma)]))
  const asignaciones: Asignacion[] = []
  const grupos = new Map<string, Asignacion>()
  for (const a of d.asignaciones) {
    if (a.tipo !== 'cuota') continue
    const objetivo = objetivoDe(a)
    if (!objetivo) continue
    const base = { clienteId: String(a.cliente_id), empresaId: String(a.empresa_id), desde: mesDe(a.desde), hasta: a.hasta ? mesDe(a.hasta) : null,
      altaEl: str(a.alta_el), bajaEl: str(a.baja_el) }
    if (a.importe_propio != null) {
      // Su precio, solo para ella: un objetivo propio con el nombre del servicio.
      const sid = `${String(a.servicio_id)}#${String(a.id)}`
      const nombre = servicios.find((s) => s.id === String(a.servicio_id))?.nombre ?? 'Servicio'
      servicios.push({ id: sid, empresaId: base.empresaId, nombre })
      const porTrabajador = formaDelServicio.get(String(a.servicio_id)) === 'por_empleado'
      precios.push({ id: `propio:${String(a.id)}`, empresaId: base.empresaId, objetivo: { tipo: 'servicio', servicioId: sid }, clienteId: base.clienteId,
        forma: porTrabajador ? { tipo: 'por_trabajador', importeCent: cent(a.importe_propio) } : { tipo: 'fijo', periodo: a.periodo === 'anio' ? 'anio' : 'mes', importeCent: cent(a.importe_propio) },
        desde: base.desde, hasta: base.hasta })
      asignaciones.push({ id: String(a.id), ...base, objetivo: { tipo: 'servicio', servicioId: sid },
        ...(a.empleado_nombre ? { trabajadores: [{ nombre: String(a.empleado_nombre), desde: base.desde, hasta: base.hasta, altaEl: base.altaEl, bajaEl: base.bajaEl }] } : {}) })
      continue
    }
    if (a.empleado_nombre) {
      const k = `${base.clienteId}|${base.empresaId}|${JSON.stringify(objetivo)}`
      const t: Trabajador = { nombre: String(a.empleado_nombre), desde: base.desde, hasta: base.hasta, altaEl: base.altaEl, bajaEl: base.bajaEl, lineaId: String(a.id).replace(/^linea:/, '') }
      const g = grupos.get(k)
      if (g) {
        g.trabajadores!.push(t)
        if (t.desde < g.desde) g.desde = t.desde
        if (g.hasta !== null && (t.hasta === null || t.hasta > g.hasta)) g.hasta = t.hasta
      } else {
        const nueva: Asignacion = { id: String(a.id), ...base, objetivo, trabajadores: [t] }
        grupos.set(k, nueva)
        asignaciones.push(nueva)
      }
      continue
    }
    asignaciones.push({ id: String(a.id), ...base, objetivo })
  }
  const ajustes = d.ajustes[0]
  return {
    catalogo: {
      servicios,
      niveles: d.niveles.map((n) => ({ id: String(n.id), servicioId: String(n.servicio_id), nombre: String(n.nombre), orden: Number(n.orden ?? 1), incluye: (n.incluye as string[]) ?? [], masElegido: !!n.mas_elegido })),
      paquetes: d.paquetes.map((p) => ({ id: String(p.id), empresaId: String(p.company_id), nombre: String(p.nombre), descripcion: str(p.descripcion),
        excesoPorTrabajadorCent: p.exceso_por_trabajador == null ? null : cent(p.exceso_por_trabajador),
        lineas: d.lineasDePaquete.filter((l) => l.paquete_id === p.id).map((l) => ({
          objetivo: (l.nivel_id ? { tipo: 'nivel', servicioId: String(l.servicio_id), nivelId: String(l.nivel_id) } : { tipo: 'servicio', servicioId: String(l.servicio_id) }) as Extract<Objetivo, { tipo: 'servicio' | 'nivel' }>,
          limiteTrabajadores: l.limite_trabajadores == null ? null : Number(l.limite_trabajadores) })) })),
      precios,
      ajustes: { mitadDeMes: ajustes?.mitad_de_mes === 'proporcional' ? 'proporcional' : 'mes_entero' },
    },
    asignaciones,
  }
}
