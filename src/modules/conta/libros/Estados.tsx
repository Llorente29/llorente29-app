// src/modules/conta/libros/Estados.tsx
//
// C05 · Balance de situación, pérdidas y ganancias y cambios en el patrimonio
// neto con los modelos oficiales (maqueta N14Balance). Arriba, la barra de la
// IA con lo que ve (saldos anómalos, cuentas sin sitio, patrimonio neto por
// debajo de la mitad del capital con la cita de la LSC, el modelo con su
// porqué, «Otros resultados» que la memoria tiene que explicar). Dos
// columnas: el ejercicio y el anterior en gris (regla 8: si no hay anterior,
// lo dice). Cada línea se despliega en sus cuentas, y cada cuenta lleva a su
// Mayor. La PyG, además, «Por local» (y «Por marca» si las hay): columnas que
// suman el total al céntimo (regla 10).
//
// S02 · PR 2 · En la plantilla INFORME (diseno/plantillas/Informe.tsx): el
// encabezado del patrón con «Ver: <estado>. Cambiar» (EncabezadoLibro), la
// fecha y la vista arriba (ControlesInforme, VistaInforme), la comprobación
// ARRIBA y no al pie («Cuadra» o por qué no, en ámbar: regla 7) y las tablas
// a todo el ancho (TablaInforme). El activo y el pasivo, uno debajo del otro.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaLibros, rutaMayor } from '@/config/navegacion'
import { Boton, Chip } from '@/modules/conta/diseno'
import { ComprobacionInforme, ControlesInforme, FiltroSelector, TablaInforme, VistaInforme, type ColumnaInforme, type LineaInforme } from '@/modules/conta/diseno/plantillas'
import { ErrorConReintento, Guardado, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { NOTA_CLIENTES_PASIVO, esLineaClientes, notaClientes } from '@/modules/conta/lib/notaClientes'
import {
  calcularEstado, columnaAnterior, cuadreBalance, mapeoEfectivo, modeloPropuesto, resultadoTresCifras, vistasDeResultado,
  type LineaCalculada, type Modelo, type ResultadoEstado, type SaldoCuenta,
} from '@/modules/conta/lib/cuentasAnuales'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { excelTabla, pdfTabla, type FilaTabla } from '@/modules/conta/libros/exportar'
import { EncabezadoLibro } from '@/modules/conta/libros/EncabezadoLibro'
import { fraseDelPeriodo } from '@/modules/conta/libros/encabezado'
import { aSaldoCuenta, leerLineas, leerMapeo, planDeEmpresa, resultadoRepartido, saldosCuentas, type SaldoConLocal } from '@/modules/conta/services/librosService'
import { MARCA } from '../cuenta/marca'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'

type Vista = 'oficial' | 'detallado' | 'local' | 'marca'
const NOMBRE = { balance: 'Balance de situación', pyg: 'Pérdidas y ganancias', ecpn: 'Cambios en el patrimonio neto' } as const

/** Los fines de mes de un ejercicio, hasta hoy o su final. */
function finesDeMes(inicio: string, fin: string, hoy: string): string[] {
  const r: string[] = []
  let y = Number(inicio.slice(0, 4)); let m = Number(inicio.slice(5, 7))
  for (;;) {
    const ultimo = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
    const tope = hoy < fin ? hoy : fin
    if (ultimo >= tope) { r.push(tope); break }
    r.push(ultimo)
    m++; if (m > 12) { m = 1; y++ }
  }
  return r.reverse()
}
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

export function Estados({ estado, salida }: { estado: 'balance' | 'pyg' | 'ecpn'; salida?: 'pdf' | 'excel' }) {
  const L = useLibros()
  const hoy = new Date().toISOString().slice(0, 10)
  const fechas = finesDeMes(L.ejercicio.inicio, L.ejercicio.fin, hoy)
  const [fecha, setFecha] = useState(fechas[0])
  const [vista, setVista] = useState<Vista>('oficial')
  const [hecho, setHecho] = useState<string | null>(null)

  const d = useLeer(async () => {
    const plan = await planDeEmpresa(L.accountId, L.companyId)
    const modelo: Modelo = L.ejercicio.modelo?.elegido ?? (plan === 'pymes' ? 'pymes' : 'abreviado')
    const est = estado === 'ecpn' ? 'balance' : estado
    const [lineas, mapeo, lineasPyg, mapeoPyg, saldos, saldosAnt, porLocal] = await Promise.all([
      leerLineas(modelo, est), leerMapeo(L.companyId, modelo, est),
      leerLineas(modelo, 'pyg'), leerMapeo(L.companyId, modelo, 'pyg'),
      saldosCuentas(L.companyId, L.ejercicio.inicio, fecha),
      L.anterior ? saldosCuentas(L.companyId, L.anterior.inicio, L.anterior.fin) : Promise.resolve(null),
      estado === 'pyg' ? saldosCuentas(L.companyId, L.ejercicio.inicio, fecha, true) : Promise.resolve(null),
    ])
    const repartido = estado === 'pyg' && L.locales.length > 1 ? await resultadoRepartido(L.companyId, L.ejercicio.inicio, fecha).catch(() => null) : null
    return { modelo, plan, lineas, mapeo, lineasPyg, mapeoPyg, saldos, saldosAnt, porLocal, repartido }
  }, `${L.companyId}:${L.ejercicio.id}:${estado}:${fecha}:${L.vuelta}`)

  const calc = useMemo(() => {
    if (!d.datos) return null
    const x = d.datos
    const est = estado === 'pyg' ? 'pyg' : 'balance'
    const mapeo = mapeoEfectivo(x.mapeo.serie, x.mapeo.propio)
    const conv = (s: SaldoConLocal[]) => s.map((y) => aSaldoCuenta(y, est))
    const actual = calcularEstado(est, x.lineas, mapeo, conv(x.saldos))
    const anterior = x.saldosAnt ? calcularEstado(est, x.lineas, mapeo, conv(x.saldosAnt)) : null
    // Para la IA y el modelo: balance y PyG del mismo corte.
    const mapeoPyg = mapeoEfectivo(x.mapeoPyg.serie, x.mapeoPyg.propio)
    const pyg = calcularEstado('pyg', x.lineasPyg, mapeoPyg, x.saldos.map((y) => aSaldoCuenta(y, 'pyg')))
    const bal = est === 'balance' ? actual : null
    // S01e: el anterior también, para que el modelo diga lo mismo que en Cuentas anuales.
    const pygAnt = x.saldosAnt ? calcularEstado('pyg', x.lineasPyg, mapeoPyg, x.saldosAnt.map((y) => aSaldoCuenta(y, 'pyg'))) : null
    const balAnt = est === 'balance' ? anterior : null
    return { actual, anterior, pyg, bal, pygAnt, balAnt }
  }, [d.datos, estado])

  const col = columnaAnterior(L.anterior ? { estado: L.anterior.origen === 'migrated' ? 'traido' : L.anterior.estado === 'closed' ? 'cerrado' : 'abierto' } : null)
  // S01: «Por local», solo con el eje encendido (Definiciones › Analítica), y con su nombre.
  const { local: ejeLocal } = useAnalitica()
  const vistas = vistasDeResultado(ejeLocal ? L.locales.length : 0, L.marcas.length)
  const titulo = NOMBRE[estado]
  // S02 · La vista del patrón (VistaInforme): las que tiene este estado, ni una más.
  const opcionesVista: { id: Vista; nombre: string }[] = estado === 'ecpn' ? [] : [
    { id: 'oficial', nombre: 'Oficial' }, { id: 'detallado', nombre: estado === 'pyg' ? 'Detallada' : 'Detallado' },
    ...(estado === 'pyg' && vistas.porLocal ? [{ id: 'local' as const, nombre: `Por ${ejeLocal?.nombre.toLowerCase() ?? 'local'}` }] : []),
  ]
  const columnas: ColumnaInforme[] = [ddmm(fecha), ...(col.sale ? [{ titulo: L.anterior!.code, apagada: true }] : [])]

  const filasExport = (r: ResultadoEstado, ant: ResultadoEstado | null): FilaTabla[] => r.lineas.filter((l) => !l.oculta).map((l) => {
    const a = ant?.lineas.find((x) => x.code === l.code)
    return [`${'  '.repeat(Math.max(0, l.level - 1))}${l.text}`, l.importe, ...(col.sale ? [a?.importe ?? null] : [])]
  })
  const exportar = (como: 'pdf' | 'excel') => {
    if (!calc) return
    const cab = ['Línea', ddmm(fecha), ...(col.sale ? [`${L.anterior!.code}`] : [])]
    const filas = filasExport(calc.actual, calc.anterior)
    const nombre = `${titulo} ${L.ejercicio.code} a ${fecha}`
    const ok = como === 'pdf'
      ? pdfTabla(`${nombre}.pdf`, titulo, `Modelo ${d.datos!.modelo} · a ${ddmm(fecha)} · ejercicio ${L.ejercicio.code}`, cab, filas, undefined, 'Modelos oficiales del PGC (texto consolidado del BOE). Las partidas «a crear» solo salen con saldo.')
      : excelTabla(`${nombre}.xlsx`, titulo, cab, filas)
    setHecho(ok ? `Bajado: ${nombre}.${como === 'pdf' ? 'pdf' : 'xlsx'}, ${filas.length} líneas.` : 'No había nada que bajar: el estado no tiene ninguna línea con saldo.')
  }

  // S02 · El encabezado del patrón: el nombre del estado, y en la frase a qué fecha y con qué modelo.
  const modelo = d.datos ? `modelo ${d.datos.modelo}` : null
  const frase = estado === 'balance'
    ? `A ${ddmm(fecha)}${modelo ? `, ${modelo}` : ''}${col.sale ? `, con ${L.anterior!.code} al lado` : ''}.`
    : estado === 'pyg'
      ? `${fraseDelPeriodo(L.ejercicio.inicio, fecha)}${modelo ? `, ${modelo}` : ''}${col.sale ? `, con ${L.anterior!.code} al lado` : ''}.`
      : `${fraseDelPeriodo(L.ejercicio.inicio, fecha)}: cómo estaba el patrimonio neto al empezar, lo que ha cambiado y cómo está.`
  const exportarPdf = <Boton variante={salida === 'pdf' ? 'principal' : 'secundario'} icono="descargar" onClick={() => exportar('pdf')} disabled={!calc}>Exportar PDF</Boton>
  const exportarExcel = <Boton variante={salida === 'excel' ? 'principal' : 'secundario'} onClick={() => exportar('excel')} disabled={!calc}>Excel</Boton>
  const encabezado = (
    <EncabezadoLibro titulo={titulo} frase={frase}
      principal={salida === 'pdf' ? exportarPdf : salida === 'excel' ? exportarExcel : undefined}
      secundarios={<>{salida !== 'pdf' && exportarPdf}{salida !== 'excel' && exportarExcel}</>}
      masAcciones={[{ titulo: 'Estados', acciones: [{ id: 'mapeo', etiqueta: 'Qué cuentas alimentan cada línea', a: rutaLibros('anuales', 'mapeo'), grupo: 'Estados' }] }]} />
  )

  if (d.error) return <section className="cxl-pagina" aria-label={titulo}>{encabezado}<ErrorConReintento mensaje={d.error} reintentar={d.recargar} /></section>
  const lineas = (r: ResultadoEstado) => r.lineas.filter((l) => !l.oculta).map((l) => lineaDelInforme(l, calc?.anterior ?? null, col.sale))
  return (
    <section className="cxl-pagina" aria-label={titulo}>
      {encabezado}
      <ControlesInforme>
        <FiltroSelector etiqueta={estado === 'pyg' ? 'Hasta' : 'A fecha'} valor={fecha} alCambiar={setFecha}
          opciones={fechas.map((f) => ({ valor: f, texto: `${estado === 'pyg' ? 'el ' : ''}${ddmm(f)}` }))} />
        {opcionesVista.length > 0 && <VistaInforme etiqueta="Cómo verlo" vistas={opcionesVista} actual={vista} alCambiar={setVista} />}
      </ControlesInforme>
      <Guardado texto={hecho} />
      {L.ejercicio.origen === 'migrated' && <p className="s-aviso-lista" role="status">Ejercicio <strong>traído</strong> de {L.ejercicio.cierre ? `${MARCA.nombre}` : 'otro programa'}: se enseña tal cual, sin recalcular su cierre.</p>}

      {!calc && <div className="s-lista-cargando" aria-busy="true" aria-label={`Cargando ${titulo.toLowerCase()}`} />}
      {calc && estado === 'balance' && <Comprobacion r={calc.actual} estado="balance" />}
      {calc && estado === 'pyg' && vista !== 'local' && <Comprobacion r={calc.actual} estado="pyg" />}
      {calc && d.datos && <BarraIa calc={calc} estado={estado} modelo={d.datos.modelo} plantilla={L.ejercicio.plantillaMedia} plantillaAnterior={L.anterior?.plantillaMedia ?? null} />}

      {calc && estado === 'balance' && (['activo', 'pn_pasivo'] as const).map((lado) => {
        const nombre = lado === 'activo' ? 'Activo' : 'Patrimonio neto y pasivo'
        return (
          <section key={lado} className="cxl-informe-lado" aria-label={nombre}>
            <h2 className="s-informe-titulo">{nombre}</h2>
            <TablaInforme etiqueta={nombre} concepto="Partida" columnas={columnas} todasAbiertas={vista === 'detallado'}
              lineas={lineas({ ...calc.actual, lineas: calc.actual.lineas.filter((l) => l.side === lado) })} />
          </section>
        )
      })}
      {calc && estado === 'balance' && calc.actual.sinSitio.length > 0 && <SinSitio r={calc.actual} />}
      {calc && estado === 'pyg' && vista !== 'local' && (
        <>
          <TablaInforme etiqueta={titulo} concepto="Partida" columnas={columnas} todasAbiertas={vista === 'detallado'} lineas={lineas(calc.actual)} />
          {calc.actual.sinSitio.length > 0 && <SinSitio r={calc.actual} />}
        </>
      )}
      {calc && estado === 'pyg' && vista === 'local' && d.datos?.porLocal && (
        <PorLocal saldos={d.datos.porLocal} lineas={d.datos.lineas} mapeo={mapeoEfectivo(d.datos.mapeo.serie, d.datos.mapeo.propio)} total={calc.actual} repartido={d.datos.repartido} />
      )}
      {calc && estado === 'ecpn' && d.datos && <Ecpn d={d.datos} />}
      {/* S01e: el patrimonio neto no tiene despliegue ni columna gris: su pie es el suyo. */}
      {calc && estado !== 'ecpn' && vista !== 'local' && <p className="s-informe-pie">Despliega una línea para ver sus cuentas; cada cuenta lleva a su Mayor. {col.sale ? `La columna gris es el ejercicio ${L.anterior!.code}${col.texto ? ` (${col.texto})` : ''}.` : 'No hay ejercicio anterior: no hay columna que comparar, y no se inventan ceros.'}</p>}
    </section>
  )
}

/** Una partida del modelo, en la forma de la plantilla Informe: su cifra, la del año anterior y sus cuentas, cada una a su Mayor. */
function lineaDelInforme(l: LineaCalculada, anterior: ResultadoEstado | null, conAnterior: boolean): LineaInforme {
  const a = anterior?.lineas.find((x) => x.code === l.code)
  const hayCuentas = l.cuentas.length > 0
  const cifra = l.importe === 0 && !hayCuentas && !l.isTotal ? '—' : eurosExactos(l.importe)
  const cifraAnt = a ? (a.importe === 0 && !a.cuentas.length && !a.isTotal ? '—' : eurosExactos(a.importe)) : '—'
  const cuentasAnt = anterior?.lineas.flatMap((x) => x.cuentas) ?? []
  return {
    id: l.code, calle: l.text, total: l.isTotal, nivel: l.level, titulo: l.legalRef || undefined,
    valores: conAnterior ? [cifra, cifraAnt] : [cifra],
    aviso: l.importe < 0 && !l.isTotal,
    marca: l.toCreate ? <Chip tono="duda">a crear · solo con saldo</Chip> : undefined,
    // C06b: los clientes van por el signo de su saldo (no compensación): dicho debajo, en llano.
    nota: esLineaClientes(l) ? NOTA_CLIENTES_PASIVO : undefined,
    cuentas: l.cuentas.map((c) => ({
      nombre: c.name, codigo: c.code, a: rutaMayor(c.code), aviso: c.anomalo,
      valores: conAnterior ? [eurosExactos(c.importe), eurosExactos(cuentasAnt.find((y) => y.code === c.code)?.importe ?? 0)] : [eurosExactos(c.importe)],
      extra: c.porDefecto ? <Link to={rutaLibros('anuales', 'mapeo')} className="cxl-defecto">colocada por defecto · Completar</Link> : undefined,
    })),
  }
}

/**
 * S02 · La frase de comprobación, arriba (ComprobacionInforme). Lo que no
 * cuadra se dice aquí, en ámbar, con su porqué (regla 7: no se esconde).
 */
function Comprobacion({ r, estado }: { r: ResultadoEstado; estado: 'balance' | 'pyg' }) {
  if (estado === 'balance') {
    const c = cuadreBalance(r)
    return (
      <ComprobacionInforme cuadra={c.cuadra} etiqueta="Cuadre del balance">
        {c.cuadra
          ? <><strong>Cuadra.</strong> Activo = PN + Pasivo · ✓ {eurosExactos(Math.abs(c.diferencia))}</>
          : <><strong>No cuadra.</strong> {c.porque}</>}
      </ComprobacionInforme>
    )
  }
  const n = r.sinSitio.length
  return (
    <ComprobacionInforme cuadra={n === 0} etiqueta="Comprobación de la cuenta de resultados">
      {n === 0
        ? <><strong>Cuadra.</strong> Todas las cuentas con saldo de gastos e ingresos tienen su línea en el modelo.</>
        : <><strong>No cuadra.</strong> {n === 1 ? 'Una cuenta con saldo no tiene' : `${n} cuentas con saldo no tienen`} línea en el modelo: el resultado no las recoge hasta que se coloquen (abajo, en rojo).</>}
    </ComprobacionInforme>
  )
}

function SinSitio({ r }: { r: ResultadoEstado }) {
  return (
    <div className="cxl-sin-sitio" role="alert">
      <strong>Sin sitio en el modelo:</strong> {r.sinSitio.map((s) => `${s.code} ${s.name} (${eurosExactos(s.saldo)})`).join(' · ')}.
      {' '}Con saldo y sin línea no se puede presentar: <Link to={rutaLibros('anuales', 'mapeo')}>dile dónde va</Link>.
    </div>
  )
}

/** Activo total y cifra de negocios de un balance y una PyG (como en Cuentas anuales). */
function magnitudes(bal: ResultadoEstado, pyg: ResultadoEstado, plantillaMedia: number) {
  const total = bal.lineas.find((l) => l.code === 'ACT.TOTAL')
  const activo = total ? total.importe : bal.lineas.filter((l) => l.side === 'activo' && l.level === 1 && !l.isTotal).reduce((a, l) => a + l.importe, 0)
  return { activo, cifraNegocios: pyg.lineas.find((l) => l.code === '1')?.importe ?? 0, plantillaMedia }
}

function BarraIa({ calc, estado, modelo, plantilla, plantillaAnterior }: {
  calc: { actual: ResultadoEstado; pyg: ResultadoEstado; bal: ResultadoEstado | null; pygAnt: ResultadoEstado | null; balAnt: ResultadoEstado | null }
  estado: 'balance' | 'pyg' | 'ecpn'; modelo: Modelo; plantilla: number; plantillaAnterior: number | null
}) {
  const notas: { titulo: string; texto: string; enlace?: { a: string; texto: string } }[] = []
  // S01e: en el patrimonio neto solo lo que habla del patrimonio neto; las notas
  // del balance nombraban cuentas que esta tabla no enseña.
  const soloPn = estado === 'ecpn'
  const cuentas = calc.actual.lineas.flatMap((l) => l.cuentas)
  // C06b: la cifra de la línea oficial de clientes, y los que van al pasivo (no compensación).
  const clientes = soloPn ? null : notaClientes(calc.actual, eurosExactos)
  if (soloPn) { /* nada de cuentas sueltas */ } else if (clientes) {
    notas.push({ titulo: clientes.titulo, texto: clientes.texto, enlace: { a: rutaMayor(clientes.cuenta), texto: 'Ver' } })
  } else {
    const otros = cuentas.filter((c) => c.anomalo)
    if (otros.length) notas.push({ titulo: `${otros.length} ${otros.length === 1 ? 'cuenta con saldo' : 'cuentas con saldo'} del lado contrario.`, texto: `En ámbar en la tabla: ${otros.slice(0, 3).map((c) => `${c.code} ${c.name}`).join(', ')}. Puede ser normal (un anticipo) o un apunte en la cuenta equivocada.` })
  }
  if (calc.bal) {
    const pn = calc.bal.lineas.find((l) => l.code === 'PNP.A')?.importe ?? 0
    const capital = calc.bal.lineas.find((l) => l.code === 'PNP.A.A1.I')?.importe ?? 0
    if (pn < 0) notas.push({ titulo: 'Patrimonio neto negativo.', texto: 'Con las pérdidas del año el patrimonio queda por debajo de cero. Si sigue así al cierre, la LSC (art. 363.1.e) obliga a reequilibrarlo. Tu asesora lo ve también.' })
    else if (capital > 0 && pn < capital / 2) notas.push({ titulo: 'Patrimonio neto por debajo de la mitad del capital.', texto: 'Es causa de disolución si sigue así al cierre (LSC art. 363.1.e), salvo que se aumente o reduzca el capital. Solo es un aviso.' })
  }
  if (soloPn) return <Barra notas={notas} estado={estado} />
  const otrosRes = calc.pyg.lineas.find((l) => l.code === 'OR')
  if (otrosRes && otrosRes.cuentas.length) notas.push({ titulo: 'Hay «Otros resultados».', texto: 'La memoria tiene que explicarlos (norma de elaboración de la PyG). Queda apuntado para la memoria.' })
  if (calc.actual.sinSitio.length) notas.push({ titulo: `${calc.actual.sinSitio.length} ${calc.actual.sinSitio.length === 1 ? 'cuenta' : 'cuentas'} sin sitio en el modelo.`, texto: 'Salen en rojo debajo, con su saldo. Sin línea no se puede presentar.', enlace: { a: rutaLibros('anuales', 'mapeo'), texto: 'Colocar' } })
  const defecto = calc.actual.porDefecto.length
  if (defecto) notas.push({ titulo: `${defecto} ${defecto === 1 ? 'cuenta colocada' : 'cuentas colocadas'} por defecto.`, texto: 'El modelo no las nombra: van con su hermana más parecida. Revísalas.', enlace: { a: rutaLibros('anuales', 'mapeo'), texto: 'Completar' } })
  if (calc.bal) {
    const ant = calc.balAnt && calc.pygAnt && plantillaAnterior !== null ? magnitudes(calc.balAnt, calc.pygAnt, plantillaAnterior) : null
    const p = modeloPropuesto(magnitudes(calc.bal, calc.pyg, plantilla), ant)
    notas.push({ titulo: `Modelo ${modelo}.`, texto: p.frase, enlace: { a: rutaLibros('anuales', 'cuentas-anuales'), texto: 'Cómo se decide' } })
  }
  if (estado === 'pyg' && calc.bal === null) {
    const r = resultadoTresCifras(calc.pyg, calc.pyg, 0)
    notas.push({ titulo: `Resultado ${r.pyg >= 0 ? 'positivo' : 'negativo'}: ${eurosExactos(r.pyg)}.`, texto: 'Es la misma cifra que sale en el balance como resultado del ejercicio; al regularizar pasa a la 129.' })
  }
  return <Barra notas={notas} estado={estado} />
}

function Barra({ notas, estado }: { notas: { titulo: string; texto: string; enlace?: { a: string; texto: string } }[]; estado: string }) {
  return (
    <section className="cxl-ia" aria-label="Lo que veo">
      <div className="cxl-ia-titulo"><span className="cx-marca-ia" aria-hidden="true">IA</span> Lo que veo{estado === 'balance' ? ' en este balance' : estado === 'ecpn' ? ' en el patrimonio neto' : ''}</div>
      {notas.length === 0 ? <div>{estado === 'ecpn' ? 'Nada fuera de lo normal en el patrimonio neto.' : 'Nada fuera de lo normal: todo tiene su sitio y los saldos están del lado que toca.'}</div>
        : notas.slice(0, 3).map((n) => <div key={n.titulo}><strong>{n.titulo}</strong> {n.texto} {n.enlace && <Link to={n.enlace.a}>{n.enlace.texto}</Link>}</div>)}
    </section>
  )
}

function PorLocal({ saldos, lineas, mapeo, total, repartido }: {
  saldos: SaldoConLocal[]; lineas: Parameters<typeof calcularEstado>[1]; mapeo: Parameters<typeof calcularEstado>[2]; total: ResultadoEstado
  repartido: { locationId: string | null; resultado: number }[] | null
}) {
  const L = useLibros()
  const grupos = new Map<string | null, SaldoCuenta[]>()
  for (const s of saldos) { const k = s.locationId; grupos.set(k, [...(grupos.get(k) ?? []), aSaldoCuenta(s, 'pyg')]) }
  // Todos los locales de la empresa, aunque no tengan apuntes (regla 7: un
  // local a cero sale a cero, no desaparece), los que traigan los saldos y no
  // estén en la lista, y «Común» al final.
  const columnas: (string | null)[] = [...L.locales.map((x) => x.id), ...[...grupos.keys()].filter((k): k is string => k !== null && !L.locales.some((x) => x.id === k)), null]
  const res = new Map(columnas.map((k) => [k, calcularEstado('pyg', lineas, mapeo, grupos.get(k) ?? [])]))
  const nombre = (k: string | null) => (k === null ? 'Común' : L.locales.find((x) => x.id === k)?.nombre ?? 'Local sin nombre')
  const visibles = total.lineas.filter((l) => !l.oculta && (l.isTotal || l.level <= 2))
  const sumaLocales = (code: string) => Math.round(columnas.reduce((a, k) => a + Math.round((res.get(k)!.lineas.find((x) => x.code === code)?.importe ?? 0) * 100), 0)) / 100
  const cuadra = visibles.every((l) => Math.round(sumaLocales(l.code) * 100) === Math.round(l.importe * 100))
  if (!saldos.length) return <div className="cx-tarjeta"><Vacio titulo="Aún no hay resultado en este periodo." explicacion="Cuando haya ventas y gastos asentados, sale aquí por local." /></div>
  const filas: LineaInforme[] = visibles.map((l) => ({
    id: l.code, calle: l.text, total: l.isTotal, nivel: l.level, titulo: l.legalRef || undefined,
    valores: [...columnas.map((k) => eurosExactos(res.get(k)!.lineas.find((x) => x.code === l.code)?.importe ?? 0)), eurosExactos(l.importe)],
  }))
  if (repartido) {
    filas.push({
      id: 'repartido', calle: 'Resultado con lo común repartido (tu regla)', total: true,
      valores: [...columnas.map((k) => (k === null ? '—' : eurosExactos(repartido.find((x) => x.locationId === k)?.resultado ?? 0))), eurosExactos(repartido.reduce((a, x) => a + x.resultado, 0))],
    })
  }
  return (
    <>
      {/* Regla 10: las columnas suman el total al céntimo, y si no, se dice arriba. */}
      <ComprobacionInforme cuadra={cuadra} etiqueta="Suma de las columnas">
        {cuadra ? <><strong>Cuadra.</strong> Las columnas suman el total al céntimo.</> : <><strong>No cuadra.</strong> Las columnas no suman el total: revisa los apuntes sin local ni «común».</>}
      </ComprobacionInforme>
      <TablaInforme etiqueta="Pérdidas y ganancias por local" concepto="Partida" columnas={[...columnas.map(nombre), 'Total']} lineas={filas} />
    </>
  )
}

/**
 * Cambios en el patrimonio neto. El estado total es una matriz por columna de
 * patrimonio: saldo al empezar el ejercicio (apertura), lo que ha cambiado y
 * el saldo a la fecha. En pymes no hay estado de ingresos y gastos aparte.
 */
function Ecpn({ d }: { d: { modelo: Modelo; lineas: Parameters<typeof calcularEstado>[1]; mapeo: { serie: Parameters<typeof mapeoEfectivo>[0]; propio: Parameters<typeof mapeoEfectivo>[1] }; saldos: SaldoConLocal[] } }) {
  const mapeo = mapeoEfectivo(d.mapeo.serie, d.mapeo.propio)
  const inicio = calcularEstado('balance', d.lineas, mapeo, d.saldos.map((s) => ({ code: s.code, name: s.name, templateCode: s.templateCode, debe: s.aperturaDebe, haber: s.aperturaHaber })))
  const fin = calcularEstado('balance', d.lineas, mapeo, d.saldos.map((s) => aSaldoCuenta(s, 'balance')))
  const pn = fin.lineas.filter((l) => l.code.startsWith('PNP.A') && l.level <= 3 && !l.oculta)
  const filas: LineaInforme[] = pn.map((l) => {
    const a = inicio.lineas.find((x) => x.code === l.code)?.importe ?? 0
    return { id: l.code, calle: l.text, nivel: l.level, titulo: l.legalRef || undefined, valores: [eurosExactos(a), eurosExactos(l.importe - a), eurosExactos(l.importe)] }
  })
  return (
    <>
      <TablaInforme etiqueta="Estado de cambios en el patrimonio neto" concepto="Patrimonio neto" columnas={['Al empezar', 'Cambios', 'A la fecha']} lineas={filas} />
      <p className="s-informe-pie">{d.modelo === 'pymes' ? 'El PGC de pymes no tiene estado de ingresos y gastos reconocidos aparte: el estado de cambios en el patrimonio neto es esta matriz.' : 'El estado de ingresos y gastos reconocidos directamente en el patrimonio (cuentas de los grupos 8 y 9) sale cuando la empresa tenga apuntes en ellas.'} Los movimientos salen de las cuentas de capital y reservas (grupo 1) y del resultado del ejercicio (129).</p>
    </>
  )
}
