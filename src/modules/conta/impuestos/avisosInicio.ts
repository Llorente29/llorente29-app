// src/modules/conta/impuestos/avisosInicio.ts
//
// I01b · P5 · Los avisos de impuestos de Inicio (encargo, punto 7), de
// conta_impuesto_calendario (con los festivos de verdad y lo ya presentado):
//   · el plazo que toca de cada modelo sin presentar, en los próximos 15 días
//     (o ya pasado): el de domiciliar si se domicilia; si no, el de presentar;
//   · el certificado, SOLO si caduca en 30 días o en 7 (o ya caducó);
//   · el cargo de lo presentado a pagar que no ha llegado al banco (respuesta
//     5 de Julio: «si, avisar»).
// Inicio interrumpe: aquí el umbral sí filtra (regla 7, «dónde SÍ va un
// umbral»), pero un «nada» nunca se dice habiendo algo.

import type { Nivel } from '@/modules/conta/esqueleto/preferencias'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { rutaImpuestos, rutaIvaPeriodo } from '@/config/navegacion'
import { cuandoEs, diasHasta, nombreDeFila, periodoEnPalabras, type Calendario } from './calendario'
import { avisoCaducidad } from './certificados'

export interface AvisoInicio { clave: string; modelo: string | null; titulo: string; apoyo: string; tono: 'duda' | 'falta' | 'neutro'; a: string }

const PRESENTADA = ['filed', 'booked', 'paid', 'offset', 'refunded', 'not_required']

export function avisosInicio(c: Calendario, nivel: Nivel, horizonte = 15): AvisoInicio[] {
  const out: AvisoInicio[] = []
  for (const f of c.filas) {
    if (f.declaracion && PRESENTADA.includes(f.declaracion.estado)) continue
    const domiciliado = f.domicilia && !!f.domiciliacion && f.domiciliacion >= c.hoy
    const dia = domiciliado ? f.domiciliacion! : f.presentacion
    const dias = diasHasta(c.hoy, dia)
    if (dias > horizonte) continue
    const titulo = `${nombreDeFila(f, nivel)}${nivel === 'experto' ? '' : f.cadencia === 'annual' ? ` de ${f.ejercicio}` : ` · ${periodoEnPalabras(f.periodo)}`}`
    out.push({
      clave: `${f.modelo}-${f.ejercicio}-${f.periodo}`, modelo: f.modelo, titulo,
      apoyo: dias < 0 ? `Se pasó el plazo: era hasta el ${diaMesCorto(dia)}.`
        : `${domiciliado ? 'Domiciliado: presentarlo' : 'Presentarlo'} hasta el ${diaMesCorto(dia)}, ${cuandoEs(dias)}.${f.se_calcula ? '' : ' Se calculará aquí pronto.'}`,
      tono: dias < 0 || dias <= 3 ? 'falta' : dias <= 7 ? 'duda' : 'neutro',
      a: f.se_calcula ? rutaIvaPeriodo(f.ejercicio, f.periodo) : rutaImpuestos(),
    })
  }
  if (c.certificado) {
    const a = avisoCaducidad(c.certificado.caduca, c.hoy)
    if (a) out.push({ clave: 'certificado', modelo: null, titulo: 'El certificado', apoyo: a.texto, tono: a.tono, a: rutaImpuestos('certificados') })
  }
  for (const p of c.pagos_sin_llegar) {
    out.push({
      clave: `pago-${p.declaracion}`, modelo: p.modelo,
      titulo: `${p.modelo === '303' ? `IVA del ${periodoEnPalabras(p.periodo)}` : `El ${p.modelo} del ${p.periodo}`} de ${p.ejercicio}`,
      apoyo: `${p.domicilia ? 'El cargo domiciliado' : 'El pago'} de ${eurosExactos(p.importe)} no ha llegado al banco: el plazo era el ${diaMesCorto(p.plazo)}. Cásalo cuando llegue.`,
      tono: 'duda', a: rutaIvaPeriodo(p.ejercicio, p.periodo),
    })
  }
  return out
}
