// src/modules/conta/nucleo/conciliar/VentanasReglas.tsx
//
// X30 · Las dos ventanas de las reglas de «Conciliar» (maqueta 23b), sencillas y sin jerga:
//   · «＋ Crear regla con este»: arriba, una frase que se lee («Si el concepto contiene “IBERDROLA” y es un pago →
//     62800000 · SUMINISTROS»); debajo, las casillas para cambiarla (el texto, pago o ingreso, el importe exacto o entre
//     dos, el banco, la subcuenta, el concepto del asiento y la analítica). Antes de guardar dice a cuántos pendientes se
//     aplicaría y deja aplicarla hacia atrás. La misma ventana corrige una regla del listado.
//   · «Reglas (N)»: todas, con cuántas veces ha conciliado cada una y la última vez; corregir, apagar, encender o borrar
//     (solo una apagada: la base no borra una que tiene conciliados vivos, y lo dice).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BancoVista } from '@/modules/conta/services/bancosPantallas'
import { nombreCorto } from '@/modules/conta/lib/bancosVista'
import type { Opcion } from '@/modules/conta/services/asientoGeneralService'
import { fechaVista } from '../ficha/teclas'
import { CasillaLupa } from '../piezas/Lupa'
import { formatoImporte } from '../piezas/logica'
import { cuandoCorto, type Linea } from './conciliar'
import { aCuantosAplica, faltaEnRegla, fraseDeRegla, type ModoImporte, type ReglaEd, type ReglaVista, type Signo } from './reglas'

type Registro = { id: string; codigo: string; descripcion: string }

const numero = (t: string): number | null => {
  const x = t.trim().replace(/\./g, '').replace(',', '.')
  if (!x) return null
  const n = Number(x)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}
const texto = (n: number | null) => (n === null ? '' : formatoImporte(n))

/** La ventana de una regla: crearla desde un movimiento o corregir una del listado. */
export function VentanaRegla({ inicial, pendientes, bancos, cuentas, nombreDe, base, ocupado, alGuardar, alCerrar }: {
  inicial: ReglaEd
  /** Lo pendiente de todos los bancos (para «a cuántos se aplicaría»). Sin leer aún, null. */
  pendientes: readonly Linea[] | null
  bancos: readonly BancoVista[]
  cuentas: Registro[]
  nombreDe: (c: string | null) => string
  base: { locales: Opcion[]; marcas: Opcion[]; plataformas: Opcion[]; hosteleria: boolean } | null
  ocupado: boolean
  alGuardar: (r: ReglaEd, haciaAtras: boolean, cuantos: number) => void
  alCerrar: () => void
}) {
  const [r, setR] = useState<ReglaEd>(inicial)
  const [imp, setImp] = useState({ exacto: texto(inicial.importe.exacto), desde: texto(inicial.importe.desde), hasta: texto(inicial.importe.hasta) })
  const [atras, setAtras] = useState(false)
  const poner = (x: Partial<ReglaEd>) => setR((y) => ({ ...y, ...x }))
  const ponerImporte = (k: 'exacto' | 'desde' | 'hasta', t: string) => {
    setImp((y) => ({ ...y, [k]: t }))
    setR((y) => ({ ...y, importe: { ...y.importe, [k]: numero(t) } }))
  }
  const aplica = useMemo(() => (pendientes ? aCuantosAplica(r, pendientes) : null), [r, pendientes])
  const falta = faltaEnRegla(r)
  const nombreBanco = (id: string) => { const b = bancos.find((x) => x.id === id); return b ? nombreCorto(b) : 'ese banco' }
  const frase = fraseDeRegla(r, nombreDe, nombreBanco)
  const cuantos = aplica?.length ?? 0
  const sumaCent = (aplica ?? []).reduce((t, l) => t + Math.abs(l.m.importeCent), 0)

  return (
    <div className="kp-lupa-velo" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar() }}>
      <div className="kp-lupa cn-dlg" role="dialog" aria-modal="true" aria-label={r.id ? 'Corregir la regla' : 'Crear regla'} data-prueba="ventana-regla"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); alCerrar() } }}>
        <header className="kp-lupa-titulo"><strong>{r.id ? 'Corregir la regla' : 'Crear regla con este movimiento'}</strong>
          <button type="button" className="kp-ventana-aspa" aria-label="Cerrar" onClick={alCerrar}>✕</button></header>
        <p className="cn-frase" data-prueba="frase-regla" title={frase}>{frase}</p>
        <div className="cn-dlg-casillas">
          <label>El concepto contiene
            <input id="cn-rg-contiene" autoFocus value={r.contiene} onChange={(e) => poner({ contiene: e.target.value.toUpperCase() })} />
          </label>
          <label>Es
            <select id="cn-rg-signo" value={r.signo} onChange={(e) => poner({ signo: e.target.value as Signo })}>
              <option value="pago">un pago</option><option value="ingreso">un ingreso</option><option value="los dos">pago o ingreso</option>
            </select>
          </label>
          <label>Importe
            <select id="cn-rg-importe" value={r.importe.modo} onChange={(e) => poner({ importe: { ...r.importe, modo: e.target.value as ModoImporte } })}>
              <option value="cualquiera">cualquiera</option><option value="exacto">exacto</option><option value="entre">entre</option>
            </select>
          </label>
          {r.importe.modo === 'exacto' && <label>de<input id="cn-rg-exacto" className="kp-num" value={imp.exacto} onChange={(e) => ponerImporte('exacto', e.target.value)} /></label>}
          {r.importe.modo === 'entre' && <>
            <label>de<input id="cn-rg-desde" className="kp-num" value={imp.desde} onChange={(e) => ponerImporte('desde', e.target.value)} /></label>
            <label>a<input id="cn-rg-hasta" className="kp-num" value={imp.hasta} onChange={(e) => ponerImporte('hasta', e.target.value)} /></label>
          </>}
          <label>Banco
            <select id="cn-rg-banco" value={r.bancoId ?? ''} onChange={(e) => poner({ bancoId: e.target.value || null })}>
              <option value="">todos</option>
              {bancos.map((b) => <option key={b.id} value={b.id}>{nombreCorto(b)}</option>)}
            </select>
          </label>
          <label className="cn-dlg-ancha">Subcuenta
            <span className="cn-dlg-sub">
              <CasillaLupa id="cn-rg-subcuenta" etiqueta="Subcuenta" registros={cuentas} valor={r.cuenta}
                poner={(x) => poner({ cuenta: x?.codigo ?? null })} />
              <span className="cn-corto" title={nombreDe(r.cuenta)}>{nombreDe(r.cuenta).toUpperCase()}</span>
            </span>
          </label>
          <label className="cn-dlg-ancha">Concepto del asiento
            <input id="cn-rg-concepto" value={r.concepto} placeholder="El del banco" onChange={(e) => poner({ concepto: e.target.value })} />
          </label>
          {base && <>
            <label>Local
              <CasillaLupa id="cn-rg-local" etiqueta="Local" registros={base.locales} valor={r.local} vista={(x) => x.descripcion} poner={(x) => poner({ local: x?.id ?? null })} />
            </label>
            {base.hosteleria && <>
              <label>Marca<CasillaLupa id="cn-rg-marca" etiqueta="Marca" registros={base.marcas} valor={r.marca} vista={(x) => x.descripcion} poner={(x) => poner({ marca: x?.id ?? null })} /></label>
              <label>Plataforma<CasillaLupa id="cn-rg-plataforma" etiqueta="Plataforma" registros={base.plataformas} valor={r.plataforma} vista={(x) => x.descripcion} poner={(x) => poner({ plataforma: x?.id ?? null })} /></label>
            </>}
          </>}
        </div>
        <p className="cn-dlg-cuantos" data-prueba="a-cuantos">
          {aplica === null ? 'Contando los pendientes…'
            : cuantos === 0 ? 'Ahora no se aplicaría a ningún pendiente: mirará lo que entre desde hoy.'
              : `Se aplicaría a ${cuantos === 1 ? '1 pendiente' : `${cuantos} pendientes`} (${formatoImporte(sumaCent / 100)} €).`}
        </p>
        {cuantos > 0 && (
          <label className="cn-dlg-atras">
            <input type="checkbox" checked={atras} onChange={(e) => setAtras(e.target.checked)} data-prueba="hacia-atras" />
            Aplicarla también a {cuantos === 1 ? 'ese pendiente' : `esos ${cuantos}`} ahora (hacia atrás): se contabilizan con esta regla.
          </label>
        )}
        <footer className="cn-dlg-pie">
          {falta && <span className="kp-aviso" data-tono="ambar">{falta}</span>}
          <button type="button" onClick={alCerrar}>Cancelar</button>
          <button type="button" className="cn-principal" data-boton="guardar-regla" disabled={!!falta || ocupado} onClick={() => alGuardar(r, atras && cuantos > 0, cuantos)}>
            {atras && cuantos > 0 ? `Guardar y aplicar a ${cuantos}` : 'Guardar la regla'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** «Reglas (N)»: el listado de todas. */
export function VentanaListaReglas({ reglas, nombreDe, bancos, ocupado, corregir, cambiarEstado, borrar, alCerrar }: {
  reglas: readonly ReglaVista[] | null
  nombreDe: (c: string | null) => string
  bancos: readonly BancoVista[]
  ocupado: boolean
  corregir: (r: ReglaVista) => void
  cambiarEstado: (r: ReglaVista, estado: 'activa' | 'apagada') => void
  borrar: (r: ReglaVista) => void
  alCerrar: () => void
}) {
  const nombreBanco = (id: string) => { const b = bancos.find((x) => x.id === id); return b ? nombreCorto(b) : 'otro banco' }
  // El foco, dentro del listado al abrirlo: Escape lo cierra a él, no a la pestaña.
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => { caja.current?.focus() }, [])
  return (
    <div className="kp-lupa-velo" onMouseDown={(e) => { if (e.target === e.currentTarget) alCerrar() }}>
      <div ref={caja} tabIndex={-1} className="kp-lupa cn-dlg cn-dlg-lista" role="dialog" aria-modal="true" aria-label="Reglas del banco" data-prueba="lista-reglas"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); alCerrar() } }}>
        <header className="kp-lupa-titulo"><strong>Reglas del banco{reglas ? ` (${reglas.length})` : ''}</strong>
          <button type="button" className="kp-ventana-aspa" aria-label="Cerrar" onClick={alCerrar}>✕</button></header>
        <div className="kp-lupa-lista">
          <table aria-label="Reglas">
            <thead><tr><th>Regla</th><th>Veces</th><th>La última</th><th>Estado</th><th aria-label="Qué hacer" /></tr></thead>
            <tbody>
              {(reglas ?? []).map((x) => {
                const f = fraseDeRegla(x, nombreDe, nombreBanco)
                return (
                  <tr key={x.id!} data-regla={x.id!} data-estado={x.estado}>
                    <td><span className="cn-corto" title={f}>{f.replace(/^Si /, '')}</span>
                      {x.partida && <span className="cn-etiqueta" title="La pone Sumied en toda empresa: propone en ámbar hasta que la confirmes">de partida</span>}</td>
                    <td className="kp-num">{x.veces}</td>
                    <td>{x.ultima ? cuandoCorto(x.ultima) : '—'}</td>
                    <td title={x.desde ? `Mira lo que entra desde el ${fechaVista(x.desde.slice(0, 10))}` : 'Mira también lo que ya estaba'}>
                      {x.estado === 'activa' ? (x.confirmaciones >= 3 ? 'concilia sola' : 'propone') : x.estado === 'apagada' ? 'apagada' : 'por guardar'}
                    </td>
                    <td className="cn-dlg-acciones">
                      <button type="button" className="cn-enlace" disabled={ocupado} onClick={() => corregir(x)}>Corregir</button>
                      {x.estado === 'activa' && <button type="button" className="cn-enlace" disabled={ocupado} onClick={() => cambiarEstado(x, 'apagada')}>Apagar</button>}
                      {x.estado === 'apagada' && <>
                        <button type="button" className="cn-enlace" disabled={ocupado} onClick={() => cambiarEstado(x, 'activa')}>Encender</button>
                        <button type="button" className="cn-enlace" disabled={ocupado} onClick={() => borrar(x)}>Borrar</button>
                      </>}
                    </td>
                  </tr>
                )
              })}
              {reglas && reglas.length === 0 && <tr><td colSpan={5} className="kp-lupa-nada">Aún no hay ninguna regla: créala desde un movimiento con «＋ Crear regla con este».</td></tr>}
              {!reglas && <tr><td colSpan={5} className="kp-lupa-nada">Leyendo las reglas…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
