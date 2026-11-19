// src/modules/conta/libros/SociedadesErp10.tsx
//
// X10 (19/11) · Debajo de las claves del conector «ERP10 (despacho)»: las sociedades de
// la cuenta, cada una con su código de empresa de ERP10 (lo teclea quien conecta: Sumied
// no pide a Cegid la lista de empresas) y un botón «Probar». Mismo estilo que la
// pantalla del conector.
//
// «Probar» entra en ERP10 con esa sociedad y confirma con contenido (regla 8):
// «Conectada con ERP10: empresa con NIF terminado en …, 1.234 líneas desde el
// 01/10/2026», o el fallo en palabras. Debajo, lo que hay en ERP10 por mes (solo
// recuentos), si los PDF se bajan y lo que salió de Sumied esos meses.

import { useEffect, useState } from 'react'
import { Check, Loader2, PlugZap } from 'lucide-react'
import { guardarCodigoErp10, leerSociedadesErp10, probarErp10, type Probado, type SociedadErp10 } from '@/modules/conta/services/erp10ApiService'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesDe = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
const miles = (n: number) => new Intl.NumberFormat('es-ES').format(n)
const CLASES: Record<string, string> = { recibida: 'recibidas', emitida: 'emitidas', asiento: 'asientos', dia: 'días del TPV' }

export default function SociedadesErp10({ accountId, connectorId, conClaves, quien }: {
  accountId: string; connectorId: string; conClaves: boolean; quien: { id: string | null; nombre: string | null }
}) {
  const [sociedades, setSociedades] = useState<SociedadErp10[] | null>(null)
  const [codigos, setCodigos] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [dicho, setDicho] = useState<Record<string, { ok: boolean; texto: string; probado?: Probado }>>({})

  useEffect(() => {
    let fuera = false
    leerSociedadesErp10(accountId, connectorId)
      .then((s) => { if (fuera) return; setSociedades(s); setCodigos(Object.fromEntries(s.map((x) => [x.companyId, x.codigo]))) })
      .catch((e) => { if (!fuera) setError(e instanceof Error ? e.message : 'No se han podido leer las sociedades.') })
    return () => { fuera = true }
  }, [accountId, connectorId])

  async function probar(s: SociedadErp10) {
    const codigo = (codigos[s.companyId] ?? '').trim()
    setDicho((d) => ({ ...d, [s.companyId]: undefined as never }))
    if (!codigo) { setDicho((d) => ({ ...d, [s.companyId]: { ok: false, texto: 'Falta el código de empresa.' } })); return }
    setHaciendo(s.companyId)
    try {
      // Primero se guarda el código (si ha cambiado), después se entra.
      const guardada = codigo !== s.codigo || !s.conexionId ? await guardarCodigoErp10(accountId, connectorId, s, codigo, quien) : s
      setSociedades((xs) => (xs ?? []).map((x) => (x.companyId === s.companyId ? guardada : x)))
      const p = await probarErp10(s.companyId)
      setDicho((d) => ({ ...d, [s.companyId]: { ok: true, texto: p.frase, probado: p } }))
    } catch (e) {
      const m = e instanceof Error ? e.message : 'No ha contestado.'
      setDicho((d) => ({ ...d, [s.companyId]: { ok: false, texto: /[.!?]$/.test(m) ? m : `${m}.` } }))
    } finally { setHaciendo(null) }
  }

  return (
    <section className="rounded-xl border border-border-default bg-card" aria-labelledby="erp10-sociedades">
      <div className="px-4 py-3 border-b border-border-default">
        <h2 id="erp10-sociedades" className="text-sm font-semibold text-text-primary">Las sociedades</h2>
        <p className="text-xs text-text-secondary mt-0.5">
          Cada sociedad con su código de empresa en ERP10. Sumied solo entra en estas: ninguna otra empresa del despacho.
        </p>
      </div>
      <div className="px-4 py-3 space-y-3">
        {error && <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs" role="alert">{error}</div>}
        {!sociedades && !error && <p className="text-sm text-text-secondary" aria-busy="true">Leyendo las sociedades…</p>}
        {sociedades?.length === 0 && <p className="text-sm text-text-secondary">Esta cuenta no tiene sociedades.</p>}
        {!conClaves && sociedades && sociedades.length > 0 && (
          <p className="text-xs text-warning">Primero escribe las claves de arriba y guárdalas: sin ellas no se puede probar.</p>
        )}
        {sociedades?.map((s) => {
          const d = dicho[s.companyId]
          return (
            <div key={s.companyId} className="space-y-2" data-sociedad={s.companyId}>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">{s.nombre}</p>
                  <p className="text-[11px] text-text-secondary">{s.nif ? `NIF ${s.nif}` : 'Sin NIF en Sumied: ponlo en su ficha antes de probar.'}</p>
                </div>
                <label className="block">
                  <span className="block text-xs font-medium text-text-secondary mb-1">Código de empresa</span>
                  <input
                    type="text" inputMode="numeric" value={codigos[s.companyId] ?? ''} disabled={!!haciendo}
                    onChange={(e) => setCodigos((c) => ({ ...c, [s.companyId]: e.target.value }))}
                    aria-label={`Código de empresa de ${s.nombre}`} autoComplete="off"
                    className="w-28 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                </label>
                <button
                  type="button" onClick={() => { void probar(s) }} disabled={!!haciendo || !conClaves}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium border border-border-default text-text-primary hover:bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                >
                  {haciendo === s.companyId ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
                  {haciendo === s.companyId ? 'Entrando en ERP10…' : 'Probar'}
                </button>
              </div>
              {!d && s.estado === 'down' && s.ultimoFallo && (
                <p className="text-xs text-danger">La última vez no se pudo entrar: {s.ultimoFallo}</p>
              )}
              {d && (
                <div className={`p-2 rounded-md text-xs border ${d.ok ? 'bg-success-bg text-success border-success/20' : 'bg-danger-bg text-danger border-danger/20'}`} role={d.ok ? 'status' : 'alert'}>
                  <p className="inline-flex items-center gap-1">{d.ok && <Check size={12} />}{d.texto}</p>
                </div>
              )}
              {d?.probado && <LoQueHay p={d.probado} />}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Lo que hay en ERP10 de esta sociedad, por mes, y lo que salió de Sumied. Solo recuentos. */
function LoQueHay({ p }: { p: Probado }) {
  if (!p.enErp10.length) return null
  const pdfBien = p.pdf.filter((x) => x.status === 200 && x.bytes > 0).length
  return (
    <div role="group" className="text-xs text-text-secondary border border-border-default rounded-md p-2 space-y-1" aria-label="Lo que hay en ERP10">
      <p className="font-medium text-text-primary">Lo que hay en ERP10</p>
      <ul className="space-y-0.5">
        {p.enErp10.map((m) => {
          const s = p.deSumied.find((x) => x.mes === m.mes)
          const salio = s && s.partidas ? Object.entries(s.clases).map(([k, n]) => `${n} ${CLASES[k] ?? k}`).join(', ') : 'nada'
          return (
            <li key={m.mes}>
              <strong>{mesDe(m.mes)}:</strong> {miles(m.lineas)} líneas en {miles(m.asientos)} asientos
              {m.tipos.length > 0 && ` (${m.tipos.map((t) => `tipo ${t.tipo ?? 'sin tipo'}: ${miles(t.asientos)}`).join(' · ')})`}
              {m.facturas != null && `, ${miles(m.facturas)} facturas`}. De Sumied salió: {salio}.
            </li>
          )
        })}
      </ul>
      <p>
        {p.pdf.length === 0 ? 'No hay facturas en ERP10 para ver si su PDF se baja.'
          : pdfBien === p.pdf.length ? `El PDF de las facturas se baja (probadas ${p.pdf.length}).`
          : `De ${p.pdf.length} facturas probadas, ${pdfBien} bajan su PDF${p.pdf.find((x) => x.motivo)?.motivo ? `; ERP10 dice: «${p.pdf.find((x) => x.motivo)!.motivo}»` : ''}.`}
      </p>
    </div>
  )
}
