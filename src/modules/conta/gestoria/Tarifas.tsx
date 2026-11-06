// src/modules/conta/gestoria/Tarifas.tsx
//
// G01 · Tarea 4 · Ventas › Clientes y cuotas › Tarifas: cambiar la tarifa
// general de un servicio o la propia de un cliente «desde el mes» que se diga
// (FormularioBloques). La que valía ese mes se cierra el mes de antes y queda
// apuntado quién y por qué (conta_tarifa_guardar, en la base). Al guardar, la
// frase con contenido: «Tarifa laboral de <cliente>: 24,20 € desde diciembre.
// Afecta a 3 empleados». Debajo, las tarifas que valen este mes.

import { useMemo, useState } from 'react'
import { FormularioBloques, type Bloque } from '@/modules/conta/ui/formulario/FormularioBloques'
import { euros, tarifaDelMes, vale } from '../../../../supabase/functions/conta-gocardless-leer/comparacion'
import type { DatosGestoria } from '@/modules/conta/services/gestoriaService'

import { MESES, leerImporte, mesesDesde } from '@/modules/conta/gestoria/vista'

export function Tarifas({ datos, emisores, clientes, mes, inicial, alGuardar }: {
  datos: DatosGestoria
  emisores: { id: string; nombre: string }[]
  clientes: { id: string; nombre: string }[]
  mes: string
  /** Desde la ficha de un cliente («Cambiar la tarifa de este cliente»): ya rellena con él y su emisor. */
  inicial?: { cliente: string | null; empresa: string | null }
  alGuardar: (a: { empresa: string; servicio: string; cliente: string | null; importe: number; periodo: 'mes' | 'anio'; desde: string; motivo: string | null }) => Promise<{ frase: string }>
}) {
  const siguiente = mesesDesde(mes, 13).slice(1, 2)[0]?.valor ?? `${mes}-01`
  const empresa0 = emisores.find((e) => e.id === inicial?.empresa)?.id ?? emisores[0]?.id ?? ''
  const cliente0 = clientes.find((c) => c.id === inicial?.cliente)?.id ?? ''
  const [v, setV] = useState<Record<string, string>>({ emisor: empresa0, servicio: '', cliente: cliente0, importe: '', periodo: 'mes', desde: siguiente, motivo: '' })
  const [aviso, setAviso] = useState<{ texto: string; tono: 'ok' | 'mal' } | null>(null)
  const servicios = datos.servicios.filter((s) => s.emisorId === v.emisor && s.forma !== 'por_uso')
  const servicio = servicios.find((s) => s.id === v.servicio) ?? servicios[0]
  const actual = servicio ? tarifaDelMes(datos.tarifas, v.cliente || '—', v.emisor, servicio.clave, mes) : null
  const importe = leerImporte(v.importe)

  const guardar = async () => {
    if (!servicio) { setAviso({ texto: 'Elige el servicio.', tono: 'mal' }); return }
    if (importe === null) { setAviso({ texto: 'Escribe el importe con coma para los céntimos: «24,20».', tono: 'mal' }); return }
    try {
      const r = await alGuardar({ empresa: v.emisor, servicio: servicio.id, cliente: v.cliente || null, importe, periodo: v.periodo === 'anio' ? 'anio' : 'mes', desde: v.desde, motivo: v.motivo.trim() || null })
      setAviso({ texto: r.frase, tono: 'ok' })
    } catch (e) { setAviso({ texto: `No se ha guardado: ${e instanceof Error ? e.message : String(e)}`, tono: 'mal' }) }
  }

  const vigentes = useMemo(() => datos.tarifas
    .filter((t) => t.emisor === v.emisor && vale(t.desde, t.hasta, mes))
    .map((t) => ({ ...t, nombre: datos.servicios.find((s) => s.emisorId === t.emisor && s.clave === t.servicio)?.nombre ?? t.servicio, cliente: t.clienteId ? clientes.find((c) => c.id === t.clienteId)?.nombre ?? 'Un cliente' : null }))
    .sort((a, b) => (a.cliente === null ? -1 : 0) - (b.cliente === null ? -1 : 0) || a.nombre.localeCompare(b.nombre, 'es') || (a.cliente ?? '').localeCompare(b.cliente ?? '', 'es')),
  [datos, v.emisor, mes, clientes])

  const bloques: Bloque[] = [
    {
      id: 'que', titulo: 'Qué tarifa', ancho: 3, campos: [
        { id: 'emisor', etiqueta: 'Empresa que factura', columnas: 6, tipo: 'opciones', opciones: emisores.map((e) => ({ valor: e.id, texto: e.nombre })) },
        { id: 'servicio', etiqueta: 'Servicio', columnas: 6, tipo: 'opciones', opciones: servicios.map((s) => ({ valor: s.id, texto: s.nombre })) },
        { id: 'cliente', etiqueta: 'De quién', columnas: 6, tipo: 'opciones', opciones: [{ valor: '', texto: 'General (todos los clientes sin tarifa propia)' }, ...clientes.map((c) => ({ valor: c.id, texto: c.nombre }))] },
      ],
    },
    {
      id: 'cuanto', titulo: 'Cuánto y desde cuándo', ancho: 3, campos: [
        { id: 'importe', etiqueta: servicio?.forma === 'por_empleado' ? 'Importe por empleado' : 'Importe', columnas: 3, tipo: 'importe', pista: actual ? `Ahora: ${euros(actual.tarifa.importeCent)} (${actual.propia ? 'propia' : 'general'})` : 'Ahora no tiene tarifa' },
        { id: 'periodo', etiqueta: 'Cada cuánto', columnas: 3, tipo: 'opciones', opciones: [{ valor: 'mes', texto: 'Al mes' }, { valor: 'anio', texto: 'Al año' }] },
        { id: 'desde', etiqueta: 'Desde el mes', columnas: 6, tipo: 'opciones', opciones: mesesDesde(mes) },
        { id: 'motivo', etiqueta: 'Por qué (queda apuntado)', columnas: 6, tipo: 'texto', pista: 'Subida de enero, acuerdo con el cliente…' },
      ],
    },
    {
      id: 'vigentes', titulo: `Las tarifas que valen en ${MESES[Number(mes.slice(5, 7)) - 1]}`, ancho: 6,
      contenido: vigentes.length === 0 ? <p className="cxg-apoyo">Esta empresa aún no tiene tarifas.</p> : (
        <table className="cxg-tabla-tarifas">
          <thead><tr><th>Servicio</th><th>De quién</th><th className="cxg-der">Importe</th><th className="cxg-col-desde">Desde</th></tr></thead>
          <tbody>{vigentes.map((t, i) => (
            <tr key={i}><td>{t.nombre}<span className="cxg-solo-movil cxg-apoyo-fila">desde {MESES[Number(t.desde.slice(5, 7)) - 1]} de {t.desde.slice(0, 4)}</span></td><td>{t.cliente ?? 'General'}</td><td className="cxg-der cxg-cifra cxg-nowrap">{euros(t.importeCent)} {t.periodo === 'anio' ? 'al año' : 'al mes'}</td><td className="cxg-col-desde">{MESES[Number(t.desde.slice(5, 7)) - 1]} de {t.desde.slice(0, 4)}</td></tr>
          ))}</tbody>
        </table>
      ),
    },
  ]
  return (
    <div className="cxg-pagina">
      <FormularioBloques titulo="Cambiar una tarifa" bloques={bloques} valores={{ ...v, servicio: servicio?.id ?? '' }}
        alCambiar={(id, x) => { setAviso(null); setV((o) => ({ ...o, [id]: x, ...(id === 'emisor' ? { servicio: '', cliente: '' } : {}) })) }}
        alGuardar={() => void guardar()} aviso={aviso} guardarPrincipal teclas={null} />
    </div>
  )
}
