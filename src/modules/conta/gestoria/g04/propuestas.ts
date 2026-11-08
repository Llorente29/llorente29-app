// src/modules/conta/gestoria/g04/propuestas.ts
//
// G04 · Tarea 4 · Lo que Sumied propone y una persona confirma (Julio, nº 14):
// en «Añadirla como línea», el servicio que más se parece al nombre de la
// suscripción de GoCardless, con su trabajador si va por trabajador. Con la
// misma regla de la importación del G01 (conversion.ts · clasificar):
// «GESTORIA MENSUAL…» es la gestoría mensual; «GESTION LABORAL <nombre>», la
// laboral de ese trabajador. Si no, el servicio que comparte más palabras con
// el nombre (si es uno solo). Si no se parece ninguno, sin propuesta: elige la
// persona. Puro: lo prueba tests/unit/modules/conta/gestoria/g04/propuestas.test.ts.

import { clasificar, normalizar } from '../../../../../supabase/functions/conta-gocardless-leer/conversion'

export interface ServicioParaProponer { id: string; nombre: string; clave: string; porTrabajador: boolean }
export interface PropuestaDeServicio { servicioId: string | null; trabajador: string | null }

const palabras = (t: string) => normalizar(t).split(/[^A-Z0-9Ñ]+/).filter((p) => p.length >= 3)

export function proponerServicio(nombreSuscripcion: string, servicios: readonly ServicioParaProponer[]): PropuestaDeServicio {
  const c = clasificar(nombreSuscripcion)
  const porClave = (clave: string) => servicios.find((s) => s.clave === clave) ?? null
  if (c.tipo === 'gestoria') { const s = porClave('gestoria_mensual'); if (s) return { servicioId: s.id, trabajador: null } }
  if (c.tipo === 'laboral') { const s = porClave('gestion_laboral'); if (s) return { servicioId: s.id, trabajador: c.detalle } }
  const deLaSuscripcion = palabras(nombreSuscripcion)
  const puntos = servicios.map((s) => ({ s, n: palabras(s.nombre).filter((p) => deLaSuscripcion.includes(p)).length })).filter((x) => x.n > 0)
  const mejor = Math.max(0, ...puntos.map((x) => x.n))
  const empatados = puntos.filter((x) => x.n === mejor)
  if (!mejor || empatados.length !== 1) return { servicioId: null, trabajador: null }
  const s = empatados[0].s
  if (!s.porTrabajador) return { servicioId: s.id, trabajador: null }
  // El trabajador: lo que queda del nombre al quitar las palabras del servicio.
  const delServicio = new Set(palabras(s.nombre))
  const resto = nombreSuscripcion.trim().split(/\s+/).filter((p) => !delServicio.has(normalizar(p).replace(/[^A-Z0-9Ñ]/g, ''))).join(' ').replace(/^[-:·,\s]+/, '').trim()
  return { servicioId: s.id, trabajador: resto || null }
}
