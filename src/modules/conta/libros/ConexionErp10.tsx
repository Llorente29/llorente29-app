// src/modules/conta/libros/ConexionErp10.tsx
//
// X10b (19/11, Julio): ERP10 es de Sumied. La conexión vive arriba de Libros › Cierre ›
// Salida a ERP10, en la tarjeta «Conexión con ERP10» (antes, X10, en Integraciones de
// Folvy). Lleva:
//   · las claves de la cuenta, una vez (al Vault, por connector-credentials; no se
//     vuelven a enseñar) y la base del despacho;
//   · el código de empresa de la sociedad abierta (Sumied no pide a Cegid la lista de
//     empresas: solo entra en las sociedades que tienen su código aquí);
//   · «Probar», que confirma con contenido (regla 8): «Conectada con ERP10: empresa con
//     NIF terminado en …, 1.234 líneas desde el 01/10/2026», y debajo lo que hay en ERP10
//     por mes y tipo (el nombre que da ERP10: «Por factura», «DiezBank»…) y si los PDF se
//     bajan. O el fallo, en palabras.
// Empieza plegada en una línea (con lo que falta, si falta): así la salida sigue cabiendo en la ventana.

import { useState } from 'react'
import { tiposDelMes } from '@/modules/conta/erp10/conexion'
import { guardarClavesErp10, guardarCodigoErp10, loQueFalta, probarErp10, type ConexionErp10, type Probado } from '@/modules/conta/services/erp10ApiService'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesDe = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
const miles = (n: number) => new Intl.NumberFormat('es-ES').format(n)
const cuantas = (n: number, uno: string, varios: string) => `${miles(n)} ${n === 1 ? uno : varios}`
const CLASES: Record<string, [string, string]> = { recibida: ['recibida', 'recibidas'], emitida: ['emitida', 'emitidas'], asiento: ['asiento', 'asientos'], dia: ['día del TPV', 'días del TPV'] }
const CLAVES = [
  ['client_id', 'Identificador de cliente (del correo de Cegid)'],
  ['client_secret', 'Clave de cliente (del correo de Cegid)'],
  ['username', 'Usuario del despacho'],
  ['password', 'Código de acceso (el que da el panel de QBO al conceder el acceso, no la contraseña de ERP10)'],
] as const
type Clave = (typeof CLAVES)[number][0]

export function ConexionErp10Tarjeta({ accountId, companyId, quien, conexion, error, abierta, abrir, cambiada }: {
  accountId: string; companyId: string; quien: string | null
  conexion: ConexionErp10 | null; error: string | null
  abierta: boolean; abrir: (si: boolean) => void
  /** Algo ha cambiado (claves o código): quien la monta vuelve a leer la conexión. */
  cambiada: () => void
}) {
  const [claves, setClaves] = useState<Record<Clave, string>>({ client_id: '', client_secret: '', username: '', password: '' })
  // Lo escrito; sin escribir, lo guardado.
  const [baseEscrita, setBase] = useState<string | null>(null)
  const [codigoEscrito, setCodigo] = useState<string | null>(null)
  const base = baseEscrita ?? conexion?.nombreBd ?? ''
  const codigo = codigoEscrito ?? conexion?.codigo ?? ''
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [dicho, setDicho] = useState<{ ok: boolean; texto: string; probado?: Probado } | null>(null)
  const [cambiarClaves, setCambiarClaves] = useState(false)

  const falta = loQueFalta(conexion)
  const pideClaves = !!conexion && (!conexion.conClaves || cambiarClaves)

  async function guardarClaves() {
    if (!conexion) return
    setHaciendo('Guardando las claves…'); setDicho(null)
    try {
      const t = await guardarClavesErp10(accountId, conexion, claves, base, quien)
      setClaves({ client_id: '', client_secret: '', username: '', password: '' }); setCambiarClaves(false)
      setDicho({ ok: true, texto: t }); cambiada()
    } catch (e) {
      setDicho({ ok: false, texto: e instanceof Error ? e.message : 'No se han guardado las claves.' })
    } finally { setHaciendo(null) }
  }
  async function probar() {
    if (!conexion) return
    const c = codigo.trim()
    if (!c) { setDicho({ ok: false, texto: 'Falta el código de empresa.' }); return }
    setHaciendo('Entrando en ERP10…'); setDicho(null)
    try {
      if (c !== conexion.codigo || !conexion.sociedadId) { await guardarCodigoErp10(accountId, companyId, conexion, c, quien); cambiada() }
      const p = await probarErp10(companyId)
      setDicho({ ok: true, texto: p.frase, probado: p })
    } catch (e) {
      const m = e instanceof Error ? e.message : 'No ha contestado.'
      setDicho({ ok: false, texto: /[.!?]$/.test(m) ? m : `${m}.` })
      cambiada()
    } finally { setHaciendo(null) }
  }

  const estado = error ? 'No se ha podido leer'
    : !conexion ? 'Leyendo…'
    : falta ? falta.replace(/\.$/, '')
    : conexion.estado === 'down' ? 'La última vez no se pudo entrar'
    : `Código de empresa ${conexion.codigo}`

  return (
    <section className={`cxe-conexion${abierta ? ' cxe-conexion-abierta' : ''}`} aria-labelledby="cxe-conexion-titulo" id="conexion-erp10">
      <div className="cxe-conexion-linea">
        <h2 className="cxe-conexion-titulo" id="cxe-conexion-titulo">Conexión con ERP10</h2>
        <span className={falta || error || conexion?.estado === 'down' ? 'cxe-chip-ambar' : conexion ? 'cxe-chip-verde' : 'cxe-chip-gris'}>{estado}</span>
        {dicho && !abierta && <span className={dicho.ok ? 'cxe-conexion-bien' : 'cxe-conexion-mal'} role={dicho.ok ? 'status' : 'alert'}>{dicho.texto}</span>}
        <button type="button" className="cxe-enlace cxe-conexion-fin" aria-expanded={abierta} onClick={() => abrir(!abierta)}>{abierta ? 'Plegar' : falta ? 'Conectar' : 'Ver la conexión'}</button>
      </div>
      {abierta && (
        <div className="cxe-conexion-cuerpo">
          {error && <p className="cxe-conexion-mal" role="alert">{error}</p>}
          {conexion && (
            <>
              <div className="cxe-conexion-bloque" aria-label="Las claves">
                <h3>Las claves <span className="cx-ayuda">· una vez para toda la cuenta; se guardan cifradas y no se vuelven a enseñar</span></h3>
                {conexion.conClaves && !cambiarClaves ? (
                  <p>Claves guardadas · base del despacho <strong>{conexion.nombreBd || '—'}</strong>. <button type="button" className="cxe-enlace" onClick={() => setCambiarClaves(true)}>Cambiarlas</button></p>
                ) : null}
                {pideClaves && (
                  <div className="cxe-conexion-campos">
                    <label>Base del despacho en ERP10<input type="text" value={base} onChange={(e) => setBase(e.target.value)} autoComplete="off" disabled={!!haciendo} /></label>
                    {CLAVES.map(([k, etq]) => (
                      <label key={k}>{etq}<input type="password" value={claves[k]} onChange={(e) => setClaves((c) => ({ ...c, [k]: e.target.value }))} autoComplete="off" disabled={!!haciendo} /></label>
                    ))}
                    <div className="cxe-conexion-botones">
                      {cambiarClaves && <button type="button" className="cxe-sec" onClick={() => setCambiarClaves(false)} disabled={!!haciendo}>Dejarlas como están</button>}
                      <button type="button" className="cxe-grande" onClick={() => { void guardarClaves() }} disabled={!!haciendo}>Guardar las claves</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="cxe-conexion-bloque" aria-label="Esta sociedad">
                <h3>Esta sociedad <span className="cx-ayuda">· Sumied solo entra en las sociedades con su código: ninguna otra empresa del despacho</span></h3>
                <div className="cxe-conexion-codigo">
                  <label>Código de empresa en ERP10<input type="text" inputMode="numeric" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="off" disabled={!!haciendo} /></label>
                  <button type="button" className="cxe-grande" onClick={() => { void probar() }} disabled={!!haciendo || !conexion.conClaves} title={conexion.conClaves ? undefined : 'Primero guarda las claves.'}>Probar</button>
                </div>
                {!dicho && conexion.estado === 'down' && conexion.ultimoFallo && <p className="cxe-conexion-mal">La última vez no se pudo entrar: {conexion.ultimoFallo}</p>}
              </div>
              {haciendo && <p className="cx-ayuda" aria-busy="true">{haciendo}</p>}
              {dicho && <p className={dicho.ok ? 'cxe-conexion-bien' : 'cxe-conexion-mal'} role={dicho.ok ? 'status' : 'alert'}>{dicho.texto}</p>}
              {dicho?.probado && <LoQueHay p={dicho.probado} />}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function LoQueHay({ p }: { p: Probado }) {
  if (!p.enErp10.length) return null
  const pdfBien = p.pdf.filter((x) => x.status === 200 && x.bytes > 0).length
  return (
    <div role="group" className="cxe-conexion-hay" aria-label="Lo que hay en ERP10">
      <h3>Lo que hay en ERP10</h3>
      <p>{p.ultimoConApuntes
        ? `El último mes con apuntes en ERP10 es ${mesDe(p.ultimoConApuntes.mes)}, con ${cuantas(p.ultimoConApuntes.lineas, 'línea', 'líneas')}.`
        : 'ERP10 no tiene apuntes de esta empresa en los últimos tres años.'}</p>
      <ul>
        {p.enErp10.map((m) => {
          const s = p.deSumied.find((x) => x.mes === m.mes)
          const salio = s && s.partidas ? Object.entries(s.clases).map(([k, n]) => cuantas(n, ...(CLASES[k] ?? [k, k]))).join(', ') : 'nada'
          const tipos = tiposDelMes(m)
          return (
            <li key={m.mes}>
              <strong>{mesDe(m.mes)}:</strong> {cuantas(m.lineas, 'línea', 'líneas')} en {cuantas(m.asientos, 'asiento', 'asientos')}
              {tipos.length > 0 && ` (${tipos.map((t) => `${t.nombre}: ${cuantas(t.lineas, 'línea', 'líneas')}`).join(' · ')})`}
              {m.facturas != null && `, ${cuantas(m.facturas, 'factura', 'facturas')}`}. De Sumied salió: {salio}.
            </li>
          )
        })}
      </ul>
      <p>
        {p.pdf.length === 0 ? 'No hay facturas en ERP10 para ver si su PDF se baja.'
          : pdfBien === p.pdf.length ? `El PDF de las facturas se baja (${cuantas(p.pdf.length, 'probada', 'probadas')}).`
          : `De ${cuantas(p.pdf.length, 'factura probada', 'facturas probadas')}, ${miles(pdfBien)} ${pdfBien === 1 ? 'baja' : 'bajan'} su PDF${p.pdf.find((x) => x.motivo)?.motivo ? `; ERP10 dice: «${p.pdf.find((x) => x.motivo)!.motivo}»` : ''}.`}
      </p>
    </div>
  )
}
