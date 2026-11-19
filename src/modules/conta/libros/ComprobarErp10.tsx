// src/modules/conta/libros/ComprobarErp10.tsx
//
// X06 · El paso 3 de «Salida a ERP10»: «Comprueba que queda igual» (la maqueta
// aprobada, maqueta_salida_paso3.png). Lo de dentro; la cabecera con los pasos y
// «Darlo por igualado» la pone SalidaErp10.
//
//   A la izquierda: con qué se ha comparado y a qué fecha, cuántas cuentas tienen
//   diferencia y «Subir otro Excel»; la tabla cuenta a cuenta (saldo en Sumied, en
//   ERP10 y la diferencia) con tres grupos: las que no quedan igual (con su filo
//   ámbar), las que llevan cosas que todavía no salen por aquí y las que quedan
//   igual (plegadas: «… y N más. Verlas todas»), y el total de las tres columnas.
//   A la derecha: «Por qué no queda igual» de la cuenta elegida: su diferencia
//   grande, un aviso por cada cosa que la explica (con «Volver a sacar solo esa» y
//   «Ya la he metido a mano» donde se puede) y las notas: la misma factura en otras
//   cuentas y lo que Sumied no sabe.
//
// El sumas y saldos se lee aquí, en el navegador (abrirExcel, reconocer,
// leerSumasYSaldos): no se guarda.
//
// X10 (19/11): primero se compara con ERP10 leído ahora (sin Excel: «Comparar con
// ERP10», a la fecha que se elija); «Subir un Excel» sigue como segunda opción. Lo
// único que cambia arriba es con qué se ha comparado: «Comparado con ERP10 (leído
// ahora, 19/11 13:40), a 30/11».

import { useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento, rutaMayor } from '@/config/navegacion'
import { fechaLarga } from '@/modules/conta/lib/formato'
import { importe } from '@/modules/conta/erp10/salida'
import { conDiferencia, explicar, type Comparacion, type Comprobar, type CuentaComparada } from '@/modules/conta/erp10/comparar'

export interface Subido { nombre: string; fecha: string; avisos: string[]; /** X10: leído de ERP10 ahora (día y hora), sin Excel. */ leidoEn?: string }

const euros = (cent: number) => importe(cent / 100)
/** El día de Madrid de un sello de tiempo (para no decir el día de antes pasada la medianoche). */
const hoyDe = (sello: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(sello))
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const PLEGADAS = 2
/** Las anchuras de las cinco columnas, las mismas en la tabla y en su total (que va fuera, para que no ruede). */
const Columnas = () => <colgroup><col style={{ width: '15%' }} /><col style={{ width: '27%' }} /><col style={{ width: '21%' }} /><col style={{ width: '20%' }} /><col style={{ width: '17%' }} /></colgroup>

export function ComprobarErp10(p: {
  subido: Subido | null
  base: Comprobar | null
  comparacion: Comparacion | null
  error: string | null
  elegida: string | null
  elegir: (cuenta: string) => void
  subir: (f: File) => void
  /** X10 · Comparar con ERP10 leído ahora, a esa fecha (AAAA-MM-DD). */
  leerErp10?: (hasta: string) => void
  aMano: (entryId: string) => void
  volver: (entryId: string) => void
  ocupado: boolean
  /** X07: está volviendo a comparar; lo de antes sigue a la vista. */
  cargando?: boolean
  /** El mes que se compara (para saber si lo último igualado es este). */
  mes?: string | null
}) {
  const entrada = useRef<HTMLInputElement | null>(null)
  const [hasta, setHasta] = useState(() => finDeMes(p.mes))
  const [abiertos, setAbiertos] = useState<{ igual: boolean; noSale: boolean }>({ igual: false, noSale: false })
  const alSubir = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) p.subir(f); e.target.value = '' }
  const subirBoton = (texto: string, clase: string) => (
    <>
      <button type="button" className={clase} disabled={p.ocupado} onClick={() => entrada.current?.click()}>{texto}</button>
      <input ref={entrada} type="file" accept=".xlsx,.xls" aria-label="El sumas y saldos de ERP10" hidden onChange={alSubir} />
    </>
  )

  if (!p.subido) {
    return (
      <div className="cxe-cuerpo cxe-cuerpo-uno">
        <div className="cxe-izq">
          <div className="cxe-subir" role="note">
            <h2 className="cxe-subir-titulo">{p.leerErp10 ? 'Compara con ERP10' : 'Sube el «Sumas y saldos» de ERP10'}</h2>
            {p.leerErp10 ? (
              <>
                <p><strong>Después de importar</strong> los ficheros, Sumied entra en ERP10, lee sus saldos y los pone al lado de los suyos, cuenta a cuenta: qué queda igual, qué no y por qué.</p>
                <div className="cxe-erp10-fecha">
                  <label>A fecha <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} disabled={p.ocupado} aria-label="A fecha" /></label>
                  <button type="button" className="cxe-grande" disabled={p.ocupado || !hasta} onClick={() => p.leerErp10!(hasta)}>Comparar con ERP10</button>
                </div>
                <p className="cx-ayuda">O, si lo prefieres, sácalo de ERP10 en Excel y {subirBoton('sube el Excel', 'cxe-enlace')}. No se guarda: se lee aquí.</p>
              </>
            ) : (
              <>
                <p>Sácalo de ERP10 en Excel <strong>después de importar</strong> los ficheros. Sumied lo pone al lado de lo suyo, cuenta a cuenta, y te dice qué queda igual, qué no y por qué.</p>
                <p className="cx-ayuda">El fichero no se guarda: se lee aquí.</p>
                <div>{subirBoton('Subir el Excel', 'cxe-grande')}</div>
              </>
            )}
            {p.error && <p className="cxe-mal" role="alert">{p.error}</p>}
            {p.base?.igualado && <p className="cx-ayuda">La última vez se dio por igualado {mesYQuien(p.base.igualado)}.</p>}
          </div>
        </div>
      </div>
    )
  }

  const c = p.comparacion
  // X07 · Lo igualado de esta comparación (el mes, el fichero y la fecha): la pantalla se ve acabada.
  const g = p.base?.igualado
  const igualado = g && g.mes === p.mes && g.fichero === p.subido.nombre && g.fechaSaldos === p.subido.fecha ? g : null
  const pendientes = c ? c.noIgual.filter((x) => x.bloquea).length : 0
  const elegida = c?.cuentas.find((x) => x.cuenta === p.elegida) ?? c?.noIgual[0] ?? c?.noSale[0] ?? null
  const ultimoLote = p.base?.lotes.length ? p.base.lotes[p.base.lotes.length - 1].id : null
  const codigoSumied = (erp: string) => p.base?.saldos.find((s) => (s.erp ?? s.codigo) === erp)?.codigo ?? erp

  const filaCuenta = (x: CuentaComparada) => (
    <tr key={x.cuenta} className={`cxe-fila${x.grupo === 'no_igual' && x.bloquea ? ' cxe-fila-filo' : ''}`} aria-selected={elegida?.cuenta === x.cuenta} tabIndex={0}
      onClick={() => p.elegir(x.cuenta)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.elegir(x.cuenta) } }}>
      <td><span className="cxe-cuenta">{x.cuenta}</span></td>
      <td>{x.nombre}</td>
      <td className="cxe-num">{euros(x.sumied)}</td>
      <td className="cxe-num">{euros(x.erp10)}</td>
      <td className="cxe-num cxe-dif">{x.diferencia ? euros(x.diferencia) : ''}</td>
    </tr>
  )
  const grupo = (lista: CuentaComparada[], titulo: string, clase: string, plegable: 'igual' | 'noSale' | null) => {
    if (!lista.length) return null
    // X07 · Si solo hay cuentas que quedan igual, se ven todas (la tabla rueda por dentro): sin hueco debajo de dos filas.
    const abierto = !plegable || abiertos[plegable] || (plegable === 'igual' && !!c && !c.noIgual.length && !c.noSale.length)
    const vistas = abierto ? lista : lista.slice(0, PLEGADAS)
    return (
      <tbody>
        <tr className={`cxe-grupo ${clase}`}><th colSpan={5} scope="rowgroup">{titulo}</th></tr>
        {vistas.map(filaCuenta)}
        {!abierto && lista.length > PLEGADAS && (
          <tr className="cxe-mas"><td colSpan={5}>… y {lista.length - PLEGADAS} más. <button type="button" className="cxe-enlace" onClick={() => setAbiertos((a) => ({ ...a, [plegable!]: true }))}>Verlas todas</button></td></tr>
        )}
      </tbody>
    )
  }
  const sumaNoSale = c ? c.noSale.reduce((t, x) => t + Math.abs(x.diferencia), 0) : 0

  return (
    <div className="cxe-cuerpo">
      <div className="cxe-izq">
        <div className="cxe-franja">
          <span className="cxe-chip-gris">{p.subido.leidoEn ? `Comparado con ERP10 (leído ahora, ${p.subido.leidoEn}), a ${dm(p.subido.fecha)}` : `Comparado con ${p.subido.nombre} de ERP10, a ${dm(p.subido.fecha)}`}</span>
          {c && (igualado
            ? <span className="cxe-chip-verde">Igualado el {fechaLarga(hoyDe(igualado.cuando))}{igualado.quien ? `, por ${igualado.quien}` : ''}</span>
            : pendientes
              ? <span className="cxe-chip-ambar">{conDiferencia(pendientes)}</span>
              : <span className="cxe-chip-verde">{c.noIgual.length ? 'Todas las diferencias, explicadas' : 'Todo queda igual'}</span>)}
          <span className="cxe-franja-fin">
            {p.leerErp10 && <button type="button" className="cxe-enlace" disabled={p.ocupado} onClick={() => p.leerErp10!(p.subido!.fecha)}>Leer otra vez</button>}
            {p.leerErp10 && ' · '}
            {subirBoton(p.leerErp10 ? 'Subir un Excel' : 'Subir otro Excel', 'cxe-enlace')}
          </span>
        </div>
        {p.subido.avisos.map((a) => <p key={a} className="cxe-aviso-linea" role="note">{a}</p>)}
        {p.error && <p className="cxe-mal" role="alert">{p.error}</p>}
        {!c && !p.error && <div aria-busy="true" aria-label="Comparando" className="cxe-marco"><p className="cx-ayuda" style={{ padding: 12 }}>Comparando con lo de Sumied…</p></div>}
        {c && (
          <div className="cxe-marco" aria-busy={p.cargando || undefined}>
            <div className="cxe-rueda">
              <table className="cxe-tabla cxe-comparar" aria-label="Cuenta a cuenta">
                <Columnas />
                <thead><tr><th>Cuenta</th><th>Nombre</th><th className="cxe-num">Saldo en Sumied</th><th className="cxe-num">Saldo en ERP10</th><th className="cxe-num">Diferencia</th></tr></thead>
                {pendientes
                  ? grupo(c.noIgual, `${c.noIgual.length} ${c.noIgual.length === 1 ? 'cuenta no queda igual' : 'cuentas no quedan igual'}`, 'cxe-grupo-ambar', null)
                  : grupo(c.noIgual, `${c.noIgual.length} ${c.noIgual.length === 1 ? 'cuenta tiene' : 'cuentas tienen'} la diferencia explicada`, 'cxe-grupo-verde', null)}
                {grupo(c.noSale, `${c.noSale.length} ${c.noSale.length === 1 ? 'cuenta lleva' : 'cuentas llevan'} cosas que todavía no salen por aquí · ${euros(sumaNoSale)}`, 'cxe-grupo-gris', 'noSale')}
                {grupo(c.igual, `${c.igual.length} ${c.igual.length === 1 ? 'cuenta queda igual' : 'cuentas quedan igual'}`, 'cxe-grupo-verde', 'igual')}
              </table>
            </div>
            <table className="cxe-tabla cxe-total" aria-label="Total">
              <Columnas />
              <tbody><tr>
                <th scope="row" colSpan={2}>Total de las {c.cuentas.length} cuentas</th>
                <td className="cxe-num">{euros(c.totales.sumied)}</td><td className="cxe-num">{euros(c.totales.erp10)}</td><td className="cxe-num cxe-dif">{euros(c.totales.diferencia)}</td>
              </tr></tbody>
            </table>
          </div>
        )}
      </div>

      <aside className="cxe-der" aria-labelledby="cxe-porque">
        <div className="cxe-der-cabeza">
          <h2 className="cxe-der-titulo" id="cxe-porque">{igualado ? 'Igualado' : 'Por qué no queda igual'}</h2>
          {elegida && <Link className="cx-enlace" to={rutaMayor(codigoSumied(elegida.cuenta))}>Abrir su mayor</Link>}
        </div>
        <div className="cxe-der-cuerpo">
          {igualado && (
            <div className="cxe-nota cxe-nota-verde" role="note">
              <p><strong>Igualado: no queda nada por mirar.</strong> Lo dio por igualado {igualado.quien ?? 'alguien de la cuenta'} el {fechaLarga(hoyDe(igualado.cuando))}, con {igualado.fichero} a {dm(igualado.fechaSaldos)}.</p>
            </div>
          )}
          {!elegida && c && <div className="cxe-nota"><p><strong>Todo queda igual.</strong> Las {c.cuentas.length} cuentas tienen el mismo saldo en Sumied y en ERP10.</p></div>}
          {elegida && <PorQue x={elegida} c={c!} ultimoLote={ultimoLote} aMano={p.aMano} volver={p.volver} ocupado={p.ocupado} />}
        </div>
      </aside>
    </div>
  )
}

function PorQue({ x, c, ultimoLote, aMano, volver, ocupado }: {
  x: CuentaComparada; c: Comparacion; ultimoLote: string | null; aMano: (id: string) => void; volver: (id: string) => void; ocupado: boolean
}) {
  const { avisos, notas } = explicar(x, c.cuentas, ultimoLote)
  const noSale = x.partidas.filter((p) => p.clase === 'no_sale_aqui')
  return (
    <>
      <div className="cxe-cuenta-elegida">
        <span>{x.cuenta} · {x.nombre}</span>
        <strong className="cxe-grande-dif" aria-label={`Diferencia ${euros(x.diferencia)}`}>{x.diferencia ? euros(x.diferencia) : '0,00'}</strong>
      </div>
      {x.grupo === 'igual' && <div className="cxe-nota"><p><strong>Queda igual:</strong> {euros(x.sumied)} en Sumied y en ERP10.</p></div>}
      {avisos.map((a) => (
        <div key={`${a.titulo}${a.entryId ?? ''}`} className={a.tono === 'ambar' ? 'cxe-aviso' : 'cxe-nota'} role="note">
          <p><strong>{a.titulo}</strong> {a.texto}</p>
          {a.acciones.length > 0 && a.entryId && (
            <div className="cxe-aviso-botones">
              {a.acciones.includes('volver') && <button type="button" className="cxe-ambar" disabled={ocupado} onClick={() => volver(a.entryId!)}>Volver a sacar solo esa</button>}
              {a.acciones.includes('a_mano') && <button type="button" className={a.acciones.includes('volver') ? 'cxe-ambar-sec' : 'cxe-ambar'} disabled={ocupado} onClick={() => aMano(a.entryId!)}>Ya la he metido a mano</button>}
            </div>
          )}
          {a.titulo === 'Todavía no sale por aquí.' && noSale.length > 0 && (
            <ul>{noSale.map((p) => (
              <li key={p.asiento!.entryId}><Link className="cx-enlace" to={rutaAsiento(p.asiento!.entryId)}>{p.asiento!.serie}/{p.asiento!.numero}</Link> · {fechaLarga(p.asiento!.fecha)} · {p.asiento!.factura ?? p.asiento!.concepto}: {euros(Math.abs(p.importe))}</li>
            ))}</ul>
          )}
        </div>
      ))}
      {notas.map((n) => <div key={n.titulo} className="cxe-nota"><p><strong>{n.titulo}</strong> {n.texto}</p></div>)}
    </>
  )
}

/** El último día del mes (AAAA-MM-01) que se compara; hoy si no hay mes. */
function finDeMes(mes: string | null | undefined): string {
  if (!mes) return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

function mesYQuien(g: NonNullable<Comprobar['igualado']>): string {
  return `el ${fechaLarga(hoyDe(g.cuando))}${g.quien ? `, por ${g.quien}` : ''} (${g.fichero}, a ${dm(g.fechaSaldos)})`
}
