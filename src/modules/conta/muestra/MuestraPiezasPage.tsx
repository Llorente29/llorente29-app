// src/modules/conta/muestra/MuestraPiezasPage.tsx
//
// M01 · La página de muestra de las tres piezas comunes (encargo F01, tarea
// 3): la tabla densa, el formulario por bloques y el panel del documento, con
// datos INVENTADOS escritos aquí (nada se lee ni se escribe en la base). Es lo
// que miran A, B y C antes de pasar una pantalla (docs/conta/marco.md) y lo
// que prueba la e2e de m01.
//
// Solo se monta fuera de producción (module.tsx): no es una pantalla del
// producto, es el muestrario.

import { useMemo, useState } from 'react'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useIsMobile } from '@/shell/useIsMobile'
import { NOMBRE_CUENTA_PGC } from '@/modules/conta/lib/pgc'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { AccionesPantalla, BotonAccion } from '@/modules/conta/ui/marco/AccionesPantalla'
import { TablaDensa, type ColumnaDensa } from '@/modules/conta/ui/tabla/TablaDensa'
import { cumpleFiltros, guardarVista, borrarVista, leerVistas, type CampoFiltro, type VistaGuardada } from '@/modules/conta/ui/tabla/tablaDensa'
import { FormularioBloques, type Bloque } from '@/modules/conta/ui/formulario/FormularioBloques'
import { PanelDocumento } from '@/modules/conta/ui/documento/PanelDocumento'
import type { Subcuenta } from '@/modules/conta/ui/formulario/formulario'

const almacen = (): Storage | null => { try { return window.localStorage } catch { return null } }

// ── Datos inventados ────────────────────────────────────────────────────

interface FilaMuestra { id: string; fecha: string; numero: number; concepto: string; tercero: string; debe: number; haber: number; estado: 'propuesto' | 'validado' }

const TERCEROS = ['Distribuciones Prueba SL', 'Panadería Inventada', 'Bebidas de Ejemplo SA', 'Limpiezas Ficticias SL', 'Alquileres Muestra SL']
const CONCEPTOS = ['Factura de compra', 'Pago a proveedor', 'Ventas del día', 'Comisión de la plataforma', 'Alquiler del local']

/** Cuarenta asientos inventados, siempre los mismos (la captura sale igual cada vez). */
const FILAS: FilaMuestra[] = Array.from({ length: 40 }, (_, i) => {
  const importe = Math.round(((i * 7919) % 90000) + 1250) / 100
  return {
    id: `m${i + 1}`,
    fecha: `2026-10-${String(1 + ((i * 3) % 28)).padStart(2, '0')}`,
    numero: 1200 + i,
    concepto: `${CONCEPTOS[i % CONCEPTOS.length]} · ejemplo ${i + 1}`,
    tercero: TERCEROS[i % TERCEROS.length],
    debe: importe,
    haber: importe,
    estado: i % 6 === 0 ? 'propuesto' : 'validado',
  }
})

const SUBCUENTAS: Subcuenta[] = Object.entries(NOMBRE_CUENTA_PGC).map(([c, nombre]) => ({ codigo: c.padEnd(8, '0'), nombre }))

/** La factura de ejemplo, dibujada aquí (sin ficheros ni datos de nadie). */
const FACTURA_SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560">
<rect width="420" height="560" fill="#fff"/><text x="28" y="48" font-family="Arial" font-size="18" font-weight="700" fill="#0E1A2B">Distribuciones Prueba SL</text>
<text x="28" y="70" font-family="Arial" font-size="11" fill="#5B6678">NIF B00000000 · Calle Inventada 1 · Ejemplo</text>
<text x="28" y="118" font-family="Arial" font-size="14" font-weight="700" fill="#0E1A2B">FACTURA F-2026-118</text>
<text x="28" y="138" font-family="Arial" font-size="11" fill="#5B6678">Fecha 12/10/2026 · Vence 11/11/2026</text>
<line x1="28" y1="160" x2="392" y2="160" stroke="#DDE3EB"/>
<text x="28" y="186" font-family="Arial" font-size="12" fill="#0E1A2B">Servicio de ejemplo (todo inventado)</text><text x="392" y="186" font-family="Arial" font-size="12" text-anchor="end" fill="#0E1A2B">250,00</text>
<line x1="28" y1="420" x2="392" y2="420" stroke="#DDE3EB"/>
<text x="300" y="446" font-family="Arial" font-size="12" fill="#5B6678">Base</text><text x="392" y="446" font-family="Arial" font-size="12" text-anchor="end">250,00</text>
<text x="300" y="466" font-family="Arial" font-size="12" fill="#5B6678">IVA 21 %</text><text x="392" y="466" font-family="Arial" font-size="12" text-anchor="end">52,50</text>
<text x="300" y="492" font-family="Arial" font-size="13" font-weight="700">Total</text><text x="392" y="492" font-family="Arial" font-size="13" font-weight="700" text-anchor="end">302,50</text>
</svg>`)}`

const CAMPOS: CampoFiltro[] = [
  { id: 'desde', etiqueta: 'Desde', tipo: 'desde' },
  { id: 'hasta', etiqueta: 'Hasta', tipo: 'hasta' },
  { id: 'tercero', etiqueta: 'Proveedor o cliente', tipo: 'opciones', opciones: [{ valor: '', texto: 'Todos' }, ...TERCEROS.map((t) => ({ valor: t, texto: t }))] },
  { id: 'texto', etiqueta: 'Buscar', tipo: 'texto', pista: 'Concepto, número, importe…' },
]

const VALORES_FACTURA: Record<string, string> = {
  proveedor: 'Distribuciones Prueba SL', numero: 'F-2026-118', fecha: '2026-10-12', vence: '2026-11-11',
  base: '250,00', tipoIva: '21', cuota: '52,50', retencion: '0,00', total: '302,50',
  gasto: '62900000', local: 'Común', pago: 'Transferencia', banco: '57200000',
}
const PROPUESTOS: Record<string, string> = { gasto: '62900000', tipoIva: '21', local: 'Común', pago: 'Transferencia', banco: '57200000' }

export default function MuestraPiezasPage() {
  const { userName } = useCuentaConta()
  const movil = useIsMobile()
  const usuario = userName ?? 'yo'

  // La tabla.
  const [vista, setVista] = useState('todos')
  const [filtros, setFiltros] = useState<Record<string, string>>({})
  const [guardadas, setGuardadas] = useState<VistaGuardada[]>(() => leerVistas('muestra', usuario, almacen()))
  const [abierta, setAbierta] = useState<string | null>(null)
  const filas = useMemo(() => FILAS.filter((f) => (vista === 'propuestos' ? f.estado === 'propuesto' : true)
    && cumpleFiltros(CAMPOS, filtros, { fecha: f.fecha, opcion: () => f.tercero, texto: `${f.concepto} ${f.tercero} ${f.numero} ${eurosExactos(f.debe)}` })), [vista, filtros])
  const propuestos = FILAS.filter((f) => f.estado === 'propuesto').length
  const columnas: ColumnaDensa<FilaMuestra>[] = [
    { id: 'fecha', titulo: 'Fecha', ancho: '96px', celda: (f) => `${f.fecha.slice(8, 10)}/${f.fecha.slice(5, 7)}`, exportar: (f) => f.fecha },
    { id: 'numero', titulo: 'Nº', ancho: '72px', cifra: true, celda: (f) => f.numero, exportar: (f) => f.numero },
    { id: 'concepto', titulo: 'Concepto', celda: (f) => <span title={f.concepto}>{f.concepto}</span>, exportar: (f) => f.concepto, pesoPdf: 3 },
    { id: 'tercero', titulo: 'Proveedor o cliente', ancho: '220px', celda: (f) => f.tercero, exportar: (f) => f.tercero, pesoPdf: 2 },
    { id: 'debe', titulo: 'Debe', ancho: '120px', cifra: true, celda: (f) => eurosExactos(f.debe), exportar: (f) => f.debe },
    { id: 'haber', titulo: 'Haber', ancho: '120px', cifra: true, celda: (f) => eurosExactos(f.haber), exportar: (f) => f.haber },
    {
      id: 'estado', titulo: 'Estado', ancho: '120px',
      celda: (f) => <span className={f.estado === 'propuesto' ? 'cxf-estado cxf-estado-ambar' : 'cxf-estado cxf-estado-verde'}>{f.estado === 'propuesto' ? 'Para revisar' : 'Validado'}</span>,
      exportar: (f) => (f.estado === 'propuesto' ? 'Para revisar' : 'Validado'),
    },
  ]
  const elegirVista = (id: string) => {
    const g = guardadas.find((v) => v.id === id)
    if (g) { setVista(g.id); setFiltros(g.filtros); return }
    setVista(id)
  }

  // El formulario.
  const [valores, setValores] = useState(VALORES_FACTURA)
  const [posicion, setPosicion] = useState(3)
  const [aviso, setAviso] = useState<{ texto: string; tono: 'ok' | 'mal' } | null>(null)
  const bloques: Bloque[] = [
    {
      id: 'datos', titulo: 'Datos de la factura', ancho: 6, campos: [
        { id: 'proveedor', etiqueta: 'Proveedor', columnas: 2 },
        { id: 'numero', etiqueta: 'Número', columnas: 1 },
        { id: 'fecha', etiqueta: 'Fecha', tipo: 'fecha', columnas: 1 },
        { id: 'vence', etiqueta: 'Vence', tipo: 'fecha', columnas: 1 },
        { id: 'local', etiqueta: 'Local', columnas: 1, propuesto: PROPUESTOS.local },
      ],
    },
    {
      id: 'iva', titulo: 'IVA', ancho: 3, campos: [
        { id: 'base', etiqueta: 'Base', tipo: 'importe', columnas: 2 },
        { id: 'tipoIva', etiqueta: '% IVA', tipo: 'opciones', columnas: 2, propuesto: PROPUESTOS.tipoIva, opciones: [{ valor: '21', texto: '21 %' }, { valor: '10', texto: '10 %' }, { valor: '4', texto: '4 %' }] },
        { id: 'cuota', etiqueta: 'Cuota', tipo: 'importe', columnas: 2 },
      ],
    },
    {
      id: 'total', titulo: 'Retención y total', ancho: 3, campos: [
        { id: 'retencion', etiqueta: 'Retención', tipo: 'importe', columnas: 3 },
        { id: 'total', etiqueta: 'Total', tipo: 'importe', columnas: 3, soloLectura: true },
      ],
    },
    { id: 'gasto', titulo: 'Gasto', ancho: 3, campos: [{ id: 'gasto', etiqueta: 'Subcuenta de gasto', tipo: 'subcuenta', columnas: 6, propuesto: PROPUESTOS.gasto }] },
    {
      id: 'pago', titulo: 'Pago', ancho: 3, campos: [
        { id: 'pago', etiqueta: 'Cómo se paga', columnas: 3, propuesto: PROPUESTOS.pago },
        { id: 'banco', etiqueta: 'Banco', tipo: 'subcuenta', columnas: 3, propuesto: PROPUESTOS.banco },
      ],
    },
    {
      id: 'asiento', titulo: 'Asiento que se crea', ancho: 6, contenido: (
        <table className="cxt-tabla cxf-asiento" aria-label="Asiento que se crea">
          <thead><tr><th>Subcuenta</th><th>Nombre</th><th className="cxt-cifra">Debe</th><th className="cxt-cifra">Haber</th></tr></thead>
          <tbody>
            <tr><td className="cxm-cifra">{valores.gasto}</td><td>{SUBCUENTAS.find((s) => s.codigo === valores.gasto)?.nombre ?? '—'}</td><td className="cxt-cifra">250,00</td><td className="cxt-cifra" /></tr>
            <tr><td className="cxm-cifra">47200000</td><td>{NOMBRE_CUENTA_PGC['472']}</td><td className="cxt-cifra">52,50</td><td className="cxt-cifra" /></tr>
            <tr><td className="cxm-cifra">40000001</td><td>{valores.proveedor}</td><td className="cxt-cifra" /><td className="cxt-cifra">302,50</td></tr>
          </tbody>
        </table>
      ),
    },
  ]

  return (
    <div className="cxm-muestra">
      <AccionesPantalla>
        <BotonAccion principal tecla="Ctrl S" atajo="Control+S" onClick={() => setAviso({ texto: 'Guardado (de muestra: no se escribe nada en ninguna parte).', tono: 'ok' })}>Guardar</BotonAccion>
        <BotonAccion tecla="Ctrl Intro" atajo="Control+Enter" onClick={() => setAviso({ texto: 'Validado y pasa a la siguiente (de muestra).', tono: 'ok' })}>Validar y siguiente</BotonAccion>
      </AccionesPantalla>
      <header className="cxm-muestra-cabeza">
        <h1 className="cxm-muestra-titulo">Muestra de las piezas</h1>
        <p className="cxm-apoyo">Datos inventados, escritos en la página: no se lee ni se guarda nada. Solo existe fuera de producción.</p>
      </header>

      <section aria-labelledby="muestra-tabla" className="cxm-muestra-bloque">
        <h2 id="muestra-tabla" className="cxm-muestra-sub">Tabla densa</h2>
        <TablaDensa<FilaMuestra>
          etiqueta="Asientos de muestra" nombreFila={['asiento', 'asientos']} filas={filas} total={FILAS.length} clave={(f) => f.id}
          columnas={columnas} movil={movil}
          teTocaHoy={[{ id: 'propuestos', etiqueta: 'para revisar', numero: propuestos, activo: vista === 'propuestos', alPulsar: () => setVista(vista === 'propuestos' ? 'todos' : 'propuestos') }]}
          vistas={{
            lista: [
              { id: 'todos', texto: 'Todos' }, { id: 'propuestos', texto: 'Para revisar', n: propuestos },
              ...guardadas.map((g) => ({ id: g.id, texto: g.nombre, guardada: true })),
            ],
            activa: vista, alElegir: elegirVista,
            alGuardar: (nombre) => setGuardadas(guardarVista('muestra', usuario, nombre, vista, filtros, almacen())),
            alBorrar: (id) => { setGuardadas(borrarVista('muestra', usuario, id, almacen())); if (vista === id) setVista('todos') },
          }}
          filtros={{ campos: CAMPOS, valores: filtros, alCambiar: setFiltros }}
          exportar={{ nombre: 'Muestra de asientos', titulo: 'Muestra de asientos', subtitulo: 'Datos inventados' }}
          cuadre={(f) => ({ debe: f.debe, haber: f.haber })}
          abierta={abierta} alAbrir={(f) => setAbierta(abierta === f.id ? null : f.id)}
          detalle={(f) => <p className="cxm-muestra-detalle">Debajo de la fila, lo que la pantalla quiera enseñar de «{f.concepto}» (en el diario, sus apuntes).</p>}
          tarjeta={(f) => (
            <span className="cxm-muestra-tarjeta"><span>{f.concepto}</span><span className="cxm-cifra">{eurosExactos(f.debe)}</span><span className="cxm-apoyo">{f.tercero} · {f.fecha.slice(8, 10)}/{f.fecha.slice(5, 7)}</span></span>
          )}
        />
      </section>

      <section aria-labelledby="muestra-formulario" className="cxm-muestra-bloque">
        <h2 id="muestra-formulario" className="cxm-muestra-sub">Formulario por bloques y panel del documento</h2>
        <FormularioBloques
          titulo="Factura F-2026-118 · Distribuciones Prueba SL" estado={{ texto: 'Para revisar', tono: 'ambar' }}
          posicion={{ actual: posicion, total: 12, anterior: posicion > 1 ? () => setPosicion((p) => p - 1) : undefined, siguiente: posicion < 12 ? () => setPosicion((p) => p + 1) : undefined }}
          bloques={bloques} valores={valores} alCambiar={(id, v) => setValores((x) => ({ ...x, [id]: v }))} subcuentas={SUBCUENTAS}
          alGuardar={() => setAviso({ texto: 'Guardado (de muestra: no se escribe nada en ninguna parte).', tono: 'ok' })}
          alValidar={() => { setAviso({ texto: `Validada la ${posicion} de 12; paso a la siguiente (de muestra).`, tono: 'ok' }); setPosicion((p) => Math.min(12, p + 1)) }}
          aviso={aviso}
          documento={(
            <PanelDocumento titulo="F-2026-118 · Distribuciones Prueba SL" url={FACTURA_SVG} tipo="imagen" alCambiar={() => setAviso({ texto: 'Aquí se subiría otro documento (de muestra).', tono: 'ok' })}
              porque={<p style={{ margin: 0 }}>Este proveedor siempre va a «Otros servicios» (62900000), con IVA del 21 % y pago por transferencia. Lo he visto en sus 8 facturas anteriores.</p>} />
          )}
        />
      </section>
    </div>
  )
}
