// src/modules/conta/bancos/CuentasYExtractos.tsx
//
// B01 · Bancos › Cuentas y extractos (sin maqueta, en el estilo de N17). Una
// tarjeta por banco: su nombre con su cuenta («Banco Norte · 57200911»), el
// IBAN, de qué local es, el aviso «Revisa esta cuenta» si un extracto trajo
// otro IBAN (P1: nunca se corrige solo), los IBAN recordados, sus TARJETAS de
// débito (respuesta 3: los 4 últimos dígitos, quién la lleva y su local; el
// número entero no se guarda nunca) y sus extractos con el cuadre.
// Abajo, las cuentas 572 del plan que aún no son un banco de Folvy.
//
// Sin tarjetas de crédito: ninguna empresa las usa (respuesta 3, punto 4).

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { useLeer } from '@/modules/conta/libros/contexto'
import { ibanLegible, nombreConCodigo, textoExtractoDeshecho } from '@/modules/conta/lib/bancosVista'
import { DialogoMotivo } from '@/modules/conta/bancos/CierreDelMes'
import {
  altaCuenta, bajaTarjeta, corregirIban, deshacerExtracto, guardarAlias, cuentasPorDarDeAlta, guardarTarjeta, localDeCuenta, type BancoVista, type Extracto,
} from '@/modules/conta/services/bancosPantallas'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { LO_HECHO } from '@/modules/conta/bancos/marca'

type Aviso = { tipo: 'ok' | 'error'; texto: string } | null
const COMUN = 'comun'

export function CuentasYExtractos() {
  const { companyId, datos, vuelta, recargar } = useBancos()
  const [query] = useSearchParams()
  const [aviso, setAviso] = useState<Aviso>(null)
  const porDar = useLeer(() => cuentasPorDarDeAlta(companyId), `${companyId}:${vuelta}`)
  const [alta, setAlta] = useState<{ codigo: string; nombre: string; iban: string } | null>(null)

  const hacer = async (f: () => Promise<string>) => {
    setAviso(null)
    try { setAviso({ tipo: 'ok', texto: await f() }); refrescarCuentasMenu(); recargar() } catch (e) { setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }) }
  }

  return (
    <section className="cxb-seccion" aria-labelledby="cxb-cuentas-titulo">
      <div className="cxl-seccion"><div><h2 id="cxb-cuentas-titulo">Cuentas y extractos</h2><p className="cx-ayuda">Tus cuentas del banco, sus tarjetas de débito y lo que se ha subido de cada una.</p></div></div>
      {aviso && <div className={aviso.tipo === 'ok' ? 'cx-guardado' : 'cx-error'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>{aviso.texto}</div>}
      {datos.bancos.length === 0 && <div className="cx-tarjeta"><p>Aún no hay ningún banco. Da de alta una de las cuentas de abajo o sube su primer extracto, que trae el IBAN.</p></div>}
      {datos.bancos.map((b) => (
        <TarjetaBanco key={b.id} b={b} extractos={datos.extractos.filter((e) => e.cuentaId === b.id)} hacer={hacer}
          prellenar={query.get('banco') === b.id ? query.get('tarjeta') : null} />
      ))}

      <div className="cx-tarjeta cxb-lista" aria-label="Cuentas por dar de alta">
        <h3 className="cxl-subtitulo">Cuentas del plan que aún no son un banco</h3>
        {porDar.error && <div className="cx-error" role="alert">{porDar.error}</div>}
        {porDar.datos?.length === 0 && <p className="cx-ayuda">Ninguna: cada cuenta de bancos del plan tiene su banco aquí.</p>}
        {(porDar.datos ?? []).map((c) => (
          <div key={c.codigo} className="cxb-lista-fila">
            <span className="cxb-lista-texto"><strong>{nombreConCodigo(c.nombre, c.codigo)}</strong>{c.ibanEnNombre && <span className="cx-ayuda">El nombre trae un IBAN: {ibanLegible(c.ibanEnNombre)}</span>}</span>
            <button type="button" className="cx-boton-sec" onClick={() => setAlta({ codigo: c.codigo, nombre: c.nombre, iban: c.ibanEnNombre ?? '' })}>Dar de alta</button>
          </div>
        ))}
      </div>
      {alta && <DialogoAlta inicial={alta} alCerrar={() => setAlta(null)} alGuardar={(c) => hacer(async () => {
        await altaCuenta(companyId, c); setAlta(null)
        return `Dada de alta: ${nombreConCodigo(c.nombre, c.codigo)}, ${c.comun ? 'común a todos los locales' : `del local ${datos.locales.find((l) => l.id === c.localId)?.nombre ?? ''}`}. Ya puedes subir su extracto.`
      })} />}
    </section>
  )
}

function TarjetaBanco({ b, extractos, hacer, prellenar }: { b: BancoVista; extractos: Extracto[]; hacer: (f: () => Promise<string>) => Promise<void>; prellenar: string | null }) {
  const { datos } = useBancos()
  const nombreLocal = (id: string | null) => (id ? datos.locales.find((l) => l.id === id)?.nombre ?? 'un local' : 'Común')
  const [local, setLocal] = useState(b.localId ?? COMUN)
  const [alias, setAlias] = useState(b.alias ?? '')
  const [deshacer, setDeshacer] = useState<Extracto | null>(null)
  const [nueva, setNueva] = useState({ ultimos4: prellenar ?? '', titular: '', local: '' })
  useEffect(() => { if (prellenar) document.getElementById(`tarjeta-${b.id}`)?.scrollIntoView({ block: 'center' }) }, [prellenar, b.id])

  return (
    <article className="cx-tarjeta cxb-banco-tarjeta" aria-label={b.nombre}>
      <div className="cx-tarjeta-cabeza cxb-banco-cabeza">
        <div>
          <h3 className="cxl-subtitulo">{nombreConCodigo(b.nombre, b.cuenta)}</h3>
          <span className="cx-ayuda cx-cifra">{ibanLegible(b.iban)}</span>
        </div>
        <label className="cxb-local">
          <span>Nombre corto en la barra</span>
          <input className="cx-input" value={alias} maxLength={24} placeholder={b.nombre} aria-label={`Nombre corto de ${b.nombre}`}
            onChange={(e) => setAlias(e.target.value)}
            onBlur={() => { if (alias.trim() !== (b.alias ?? '')) hacer(async () => { await guardarAlias(b.id, alias); return alias.trim() ? `${b.nombre} sale en la barra como «${alias.trim()}».` : `${b.nombre} sale en la barra con su nombre entero.` }) }} />
        </label>
        <label className="cxb-local">
          <span>Local</span>
          <select className="cx-input" value={local} onChange={(e) => {
            const v = e.target.value; setLocal(v)
            hacer(async () => { await localDeCuenta(b.id, v === COMUN ? null : v, v === COMUN); return `${b.nombre}: ahora es ${v === COMUN ? 'común a todos los locales' : `del local ${nombreLocal(v)}`}.` })
          }}>
            <option value={COMUN}>Común a todos</option>
            {datos.locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
      </div>
      {!b.cuenta && <div className="cx-aviso" role="note">Este banco no tiene su cuenta en contabilidad: no puedo casar nada hasta que la tenga.</div>}

      {b.ibanRevision && (
        <div className="cx-aviso cxb-revisa" role="alert">
          <span><strong>Revisa esta cuenta.</strong> El último extracto trae el IBAN {ibanLegible(b.ibanRevision.iban_propuesto)} y la cuenta tiene {ibanLegible(b.iban)}. {b.ibanRevision.motivo} No lo cambio solo.</span>
          <button type="button" className="cx-boton-sec" onClick={() => hacer(async () => { await corregirIban(b.id, b.ibanRevision!.iban_propuesto); return `IBAN de ${b.nombre} corregido: ${ibanLegible(b.ibanRevision!.iban_propuesto)}.` })}>
            Es el bueno: corregirlo
          </button>
        </div>
      )}
      {b.ibanes.length > 0 && <p className="cx-ayuda">También le llegan extractos con {b.ibanes.map(ibanLegible).join(', ')}: van a esta cuenta solos.</p>}

      <div className="cxb-subbloque" id={`tarjeta-${b.id}`}>
        <h4>Tarjetas de débito · {b.tarjetas.length}</h4>
        <p className="cx-ayuda">Sus pagos salen en el extracto de esta cuenta. Con la tarjeta dada de alta sé quién la lleva y a quién pedirle el ticket.</p>
        {b.tarjetas.map((t) => (
          <div key={t.id} className="cxb-lista-fila">
            <span className="cxb-lista-texto"><strong>Tarjeta ···{t.ultimos4} · {t.titular}</strong><span className="cx-ayuda">{t.localId ? `Del local ${nombreLocal(t.localId)}` : 'Común a todos los locales'}</span></span>
            <button type="button" className="cx-boton-sec" onClick={() => hacer(async () => { await bajaTarjeta(t.id); return `Tarjeta ···${t.ultimos4} de ${t.titular} dada de baja. Sus pagos ya casados siguen siendo suyos.` })}>Dar de baja</button>
          </div>
        ))}
        <form className="cxb-tarjeta-nueva" aria-label={`Añadir una tarjeta a ${b.nombre}`} onSubmit={(e) => {
          e.preventDefault()
          const comun = nueva.local === COMUN
          hacer(async () => {
            await guardarTarjeta(b.id, { ultimos4: nueva.ultimos4, titular: nueva.titular, localId: comun || !nueva.local ? null : nueva.local, comun })
            const t = `Tarjeta ···${nueva.ultimos4.replace(/\D/g, '')} de ${nueva.titular.trim()} dada de alta en ${b.nombre}. Desde ahora sus pagos van a su nombre.`
            setNueva({ ultimos4: '', titular: '', local: '' })
            return t
          })
        }}>
          <label className="cx-campo"><span>Últimos 4 dígitos</span>
            <input className="cx-input cx-cifra" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={nueva.ultimos4} placeholder="1234"
              onChange={(e) => setNueva({ ...nueva, ultimos4: e.target.value.replace(/\D/g, '').slice(0, 4) })} autoFocus={!!prellenar} />
          </label>
          <label className="cx-campo"><span>Quién la lleva</span>
            <input className="cx-input" value={nueva.titular} onChange={(e) => setNueva({ ...nueva, titular: e.target.value })} placeholder="Nombre" />
          </label>
          <label className="cx-campo"><span>¿De qué local?</span>
            <select className="cx-input" value={nueva.local} onChange={(e) => setNueva({ ...nueva, local: e.target.value })}>
              <option value="">Elige…</option>
              <option value={COMUN}>Común a todos</option>
              {datos.locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </label>
          <button type="submit" className="cx-boton" disabled={nueva.ultimos4.length !== 4 || !nueva.titular.trim() || !nueva.local}>Añadir tarjeta</button>
        </form>
        <p className="cx-ayuda">Solo los 4 últimos dígitos: el número entero no se guarda nunca.</p>
      </div>

      <div className="cxb-subbloque">
        <h4>Extractos · {extractos.length}</h4>
        {extractos.length === 0 && <p className="cx-ayuda">Aún no se ha subido ninguno. Suelta su Norma 43 o su Excel en cualquier pantalla de Bancos.</p>}
        {extractos.length > 0 && (
          <table className="cxl-tabla">
            <thead><tr><th>Periodo</th><th>Fichero</th><th className="cxl-der">Movimientos</th><th>Cuadre</th><th>Con el anterior</th><th className="cxl-movil-oculta">Subido</th><th><span className="cx-oculto">Deshacer</span></th></tr></thead>
            <tbody>
              {extractos.map((e) => (
                <tr key={e.id}>
                  <td className="cxl-mono">{fechaLarga(e.desde)} – {fechaLarga(e.hasta)}</td>
                  <td>{e.fichero ?? '—'}<span className="cxl-apoyo">{e.formato === 'norma43' ? 'Norma 43' : e.formato.replace(/^csv:/, 'Excel · ')}</span></td>
                  <td className="cxl-der">{e.movimientos}<span className="cxl-apoyo">{e.nuevos} nuevos{e.repetidos ? ` · ${e.repetidos} ya estaban` : ''}</span></td>
                  <td>{e.cuadra ? <>Cuadra<span className="cxl-apoyo">saldo final {eurosExactos(e.saldoFinalCent! / 100)}</span></> : <span className="cxl-ambar-celda">Sin comprobar<span className="cxl-apoyo">{e.sinComprobar}</span></span>}</td>
                  <td>{e.continuidad === 'sigue' ? 'Sigue al anterior' : e.continuidad === 'primero' ? 'El primero' : e.continuidad === 'hueco'
                    ? <span className="cxl-ambar-celda">Falta un trozo: {eurosExactos(e.huecoCent! / 100)}</span> : 'Sin saldos'}</td>
                  <td className="cxl-movil-oculta">{fechaLarga(e.subido)}<span className="cxl-apoyo">{e.quien ?? ''}</span></td>
                  <td><button type="button" className="cx-boton-sec" aria-label={`Deshacer el extracto ${e.fichero ?? ''} del ${fechaLarga(e.desde)} al ${fechaLarga(e.hasta)}`}
                    onClick={() => setDeshacer(e)}>Deshacer…</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {deshacer && (
        <DialogoMotivo titulo={`Deshacer el extracto ${deshacer.fichero ?? ''}`.trim()}
          explicacion={`Se quitan sus ${deshacer.nuevos} movimientos de ${b.nombre}, del ${fechaLarga(deshacer.desde)} al ${fechaLarga(deshacer.hasta)}, también los que estén como «¿es el mismo?», para que puedas subir el fichero bueno. Solo se puede si ninguno está casado; queda en «${LO_HECHO}».`}
          boton="Deshacer el extracto" alCerrar={() => setDeshacer(null)}
          alAceptar={async (motivo) => { const e = deshacer; setDeshacer(null); await hacer(async () => textoExtractoDeshecho(await deshacerExtracto(e.id, motivo))) }} />
      )}
    </article>
  )
}

function DialogoAlta({ inicial, alCerrar, alGuardar }: {
  inicial: { codigo: string; nombre: string; iban: string }
  alCerrar: () => void
  alGuardar: (c: { nombre: string; iban: string; codigo: string; localId: string | null; comun: boolean }) => Promise<void>
}) {
  const { datos } = useBancos()
  const [nombre, setNombre] = useState(inicial.nombre)
  const [iban, setIban] = useState(inicial.iban)
  const [local, setLocal] = useState('')
  return (
    <Dialogo titulo={`Dar de alta ${inicial.codigo}`} alCerrar={alCerrar}>
      <form className="cx-formulario" onSubmit={(e) => { e.preventDefault(); alGuardar({ nombre: nombre.trim(), iban, codigo: inicial.codigo, localId: local === COMUN ? null : local, comun: local === COMUN }) }}>
        <label className="cx-campo"><span>Cómo la llamas</span><input className="cx-input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
        <label className="cx-campo"><span>IBAN</span><input className="cx-input cx-cifra" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" /></label>
        <label className="cx-campo"><span>¿De qué local es esta cuenta?</span>
          <select className="cx-input" value={local} onChange={(e) => setLocal(e.target.value)}>
            <option value="">Elige…</option>
            <option value={COMUN}>Común a todos</option>
            {datos.locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </label>
        <div className="cx-pie"><button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button><button type="submit" className="cx-boton" disabled={!nombre.trim() || !iban.trim() || !local}>Dar de alta</button></div>
      </form>
    </Dialogo>
  )
}
