// src/modules/conta/bancos/revolut/ActivarPagos.tsx
//
// B01 Revolut · PR 2c-1 · ACTIVAR Y DEJAR DE PAGAR CON REVOLUT, en la tarjeta
// de Revolut de Bancos › Cuentas y extractos (maqueta «Activar pagos»,
// aprobada por Julio el 01/11). Cuatro piezas:
//
//   · TuLlaveYPin: tu llave de acceso en este dispositivo y tu PIN de pago,
//     con el código del correo para activar la una o crear el otro.
//   · AsistentePagos: «Activar pagos» en tres pasos, en la misma ventana:
//     1. tu llave y tu PIN (al menos uno), 2. topes y quién paga, 3. autorizar
//     en Revolut el permiso de pagar (PAY). Solo un administrador.
//   · TopesYPermisos: los topes y quién puede pagar. Solo un administrador.
//   · DejarDePagar: primero, en Sumied y al instante, nadie paga (y se cancela
//     lo que esperaba); después, a Revolut con solo READ y WRITE. Si la persona
//     cancela en Revolut, en Sumied ya está quitado y la pantalla lo dice.
// Cada botón dice lo que ha pasado, con contenido (regla 8).

import { useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { rpc, tabla } from '@/modules/conta/services/bd'
import { leerMiSegunda, tieneSegunda } from '@/modules/conta/bancos/revolut/pagosRevolut'
import { listUserProfilesByAccount } from '@/modules/multitenancy/services/userProfilesService'
import { crearLlave, hayLlaves, motivoPin, nombreDelDispositivo, pagar, textoDeFalloLlave, type OpcionesRegistrar } from '@/modules/conta/pagos/llaveNavegador'
import { eurosTope, recordarVuelta, revolut } from '@/modules/conta/bancos/revolut/revolut'

type Aviso = { tipo: 'ok' | 'error'; texto: string }
const Mensaje = ({ a }: { a: Aviso | null }) => a ? <div className={a.tipo === 'ok' ? 'cx-guardado' : 'cx-error'} role={a.tipo === 'ok' ? 'status' : 'alert'}>{a.texto}</div> : null

// ── Tu llave y tu PIN ───────────────────────────────────────────────────────

type Que = 'llave' | 'pin'

export function TuLlaveYPin({ alCambiar }: { alCambiar?: () => void }) {
  const mia = useLeer(() => leerMiSegunda(), 'mi-segunda')
  const [que, setQue] = useState<Que | null>(null)
  const [reto, setReto] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [codigoBueno, setCodigoBueno] = useState(false)
  const [pin, setPin] = useState(''); const [pin2, setPin2] = useState('')
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const m = mia.datos
  const disp = nombreDelDispositivo()
  const conLlaves = hayLlaves()

  const empezar = async (q: Que) => {
    setQue(q); setReto(null); setCodigo(''); setCodigoBueno(false); setPin(''); setPin2(''); setAviso(null); setHaciendo(true)
    const r = await pagar<{ reto: string }>('codigo_pedir', { para: q === 'llave' ? 'activar_llave' : 'crear_pin' })
    setHaciendo(false)
    if (!r.ok) { setAviso({ tipo: 'error', texto: r.texto }); return }
    setReto(r.reto); setAviso({ tipo: 'ok', texto: r.texto ?? 'Te hemos mandado un código al correo.' })
  }

  const activarLlave = async () => {
    setHaciendo(true)
    const o = await pagar<{ reto: string; opciones: OpcionesRegistrar }>('llave_registrar_opciones', {})
    if (!o.ok) { setHaciendo(false); setAviso({ tipo: 'error', texto: o.texto }); return }
    let credencial
    try { credencial = await crearLlave(o.opciones) } catch (e) { setHaciendo(false); setAviso({ tipo: 'error', texto: textoDeFalloLlave(e) }); return }
    const r = await pagar('llave_registrar', { reto: o.reto, credencial, dispositivo: disp })
    setHaciendo(false)
    setAviso(r.ok ? { tipo: 'ok', texto: r.texto ?? 'Llave activada.' } : { tipo: 'error', texto: r.texto })
    if (r.ok) { setQue(null); mia.recargar(); alCambiar?.() }
  }

  const usarCodigo = async () => {
    if (!reto) return
    setHaciendo(true)
    const r = await pagar('codigo_usar', { reto, codigo })
    if (!r.ok) { setHaciendo(false); setAviso({ tipo: 'error', texto: r.texto }); return }
    setCodigoBueno(true); setAviso(null)
    if (que === 'llave') { await activarLlave(); return }
    setHaciendo(false)
  }

  const crearPin = async () => {
    const motivo = motivoPin(pin)
    if (motivo) { setAviso({ tipo: 'error', texto: motivo }); return }
    if (pin !== pin2) { setAviso({ tipo: 'error', texto: 'Los dos PIN no son iguales. Escríbelo otra vez.' }); return }
    setHaciendo(true)
    const r = await pagar('pin_crear', { pin })
    setHaciendo(false)
    setAviso(r.ok ? { tipo: 'ok', texto: r.texto ?? 'PIN de pago guardado.' } : { tipo: 'error', texto: r.texto })
    if (r.ok) { setQue(null); setPin(''); setPin2(''); mia.recargar(); alCambiar?.() }
  }

  if (mia.error) return <div className="cx-error" role="alert">{mia.error}</div>
  if (!m) return <p className="cx-ayuda" role="status">Mirando tu llave y tu PIN…</p>
  const pinTexto = m.pin.bloqueado ? 'bloqueado: créalo otra vez con el código del correo' : m.pin.tiene ? 'creado' : 'sin crear'
  return (
    <div className="cx-formulario" data-prueba="tu-llave-y-pin">
      <div className="cxb-lista-fila">
        <span className="cxb-lista-texto"><strong>Tu llave en este {disp}</strong>
          <span className="cx-ayuda">{m.llaveAqui ? `activa${m.llaveAqui.dispositivo ? ` · ${m.llaveAqui.dispositivo}` : ''}` : !conLlaves ? 'este navegador no tiene llaves de acceso: usa el PIN de pago' : 'sin activar · huella, cara o Windows Hello · pide el código del correo una vez'}</span></span>
        {!m.llaveAqui && conLlaves && <button type="button" className="cx-boton-sec" disabled={haciendo} onClick={() => void empezar('llave')}>Activar</button>}
      </div>
      <div className="cxb-lista-fila">
        <span className="cxb-lista-texto"><strong>Tu PIN de pago</strong>
          <span className="cx-ayuda">{pinTexto} · 6 cifras, para cuando no tengas la llave a mano</span></span>
        <button type="button" className="cx-boton-sec" disabled={haciendo} onClick={() => void empezar('pin')}>{m.pin.tiene ? 'Cambiar' : 'Crear'}</button>
      </div>
      {que && reto && !codigoBueno && (
        <div className="cx-formulario" data-prueba="codigo">
          <label className="cx-campo"><span>El código del correo (6 cifras)</span>
            <input className="cx-input cx-cifra" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />
          </label>
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => { setQue(null); setAviso(null) }}>Cancelar</button>
            <button type="button" className="cx-boton" disabled={haciendo || codigo.length !== 6} onClick={() => void usarCodigo()}>{que === 'llave' ? 'Seguir y activar mi llave' : 'Seguir'}</button>
          </div>
        </div>
      )}
      {que === 'pin' && codigoBueno && (
        <div className="cx-formulario" data-prueba="pin-nuevo">
          <label className="cx-campo"><span>Tu PIN de pago nuevo</span>
            <input className="cx-input cx-cifra" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className="cx-campo"><span>Otra vez</span>
            <input className="cx-input cx-cifra" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
          </label>
          <p className="cx-ayuda">Sin seis cifras iguales, sin cifras seguidas y sin trozos que se repiten. Se guarda cifrado; con 5 fallos se bloquea.</p>
          <div className="cx-pie">
            <button type="button" className="cx-boton" disabled={haciendo || pin.length !== 6 || pin2.length !== 6} onClick={() => void crearPin()}>Guardar el PIN</button>
          </div>
        </div>
      )}
      {haciendo && <p className="cx-ayuda" role="status">Un momento…</p>}
      <Mensaje a={aviso} />
    </div>
  )
}

// ── Los topes ───────────────────────────────────────────────────────────────

interface Topes { tope_pago: number; tope_dia: number; aprobado_hoy: number }

function EditarTopes({ companyId, topes, alGuardar }: { companyId: string; topes: Topes; alGuardar: () => void }) {
  const [pago, setPago] = useState(String(topes.tope_pago))
  const [dia, setDia] = useState(String(topes.tope_dia))
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const guardar = async () => {
    const p = Number(pago.replace(/\./g, '').replace(',', '.')), d = Number(dia.replace(/\./g, '').replace(',', '.'))
    if (!(p > 0) || !(d > 0)) { setAviso({ tipo: 'error', texto: 'Los dos topes tienen que ser mayores que cero.' }); return }
    if (p > d) { setAviso({ tipo: 'error', texto: 'El tope por pago no puede ser mayor que el del día.' }); return }
    setHaciendo(true)
    try {
      const r = await rpc<{ frase: string }>('conta_pago_topes_poner', { p_company: companyId, p_tope_pago: p, p_tope_dia: d })
      setAviso({ tipo: 'ok', texto: r.frase }); alGuardar()
    } catch (e) { setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }) }
    setHaciendo(false)
  }
  return (
    <div className="cx-formulario" data-prueba="topes">
      <label className="cx-campo"><span>Tope por pago (€)</span><input className="cx-input cx-cifra" inputMode="decimal" value={pago} onChange={(e) => setPago(e.target.value)} /></label>
      <label className="cx-campo"><span>Tope al día (€)</span><input className="cx-input cx-cifra" inputMode="decimal" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
      <p className="cx-ayuda">Por encima de un tope, el pago pide además la segunda aprobación. Hoy van aprobados {eurosTope(topes.aprobado_hoy ?? 0)}.</p>
      <div className="cx-pie"><button type="button" className="cx-boton-sec" disabled={haciendo} onClick={() => void guardar()}>Guardar los topes</button></div>
      <Mensaje a={aviso} />
    </div>
  )
}

// ── Activar pagos: el asistente ─────────────────────────────────────────────

type PasoPagos = 'llave' | 'topes' | 'revolut'
const PASOS_PAGOS: { id: PasoPagos; texto: string }[] = [
  { id: 'llave', texto: '1 · Tu llave y tu PIN' },
  { id: 'topes', texto: '2 · Topes y quién paga' },
  { id: 'revolut', texto: '3 · Autoriza en Revolut' },
]

export function AsistentePagos({ alCerrar }: { alCerrar: () => void }) {
  const { companyId, quien } = useBancos()
  const [paso, setPaso] = useState<PasoPagos>('llave')
  const mia = useLeer(() => leerMiSegunda(), 'mi-segunda-asistente')
  const topes = useLeer(paso === 'topes' || paso === 'revolut' ? () => rpc<Topes>('conta_pago_topes', { p_company: companyId }) : null, `topes:${companyId}:${paso !== 'llave'}`)
  const [cambiarTopes, setCambiarTopes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const indice = PASOS_PAGOS.findIndex((p) => p.id === paso)

  const autorizar = async () => {
    setError(null); setHaciendo(true)
    const r = await revolut<{ url: string }>('activar_pagos', { empresa: companyId })
    setHaciendo(false)
    if (!r.ok) { setError(r.texto); return }
    recordarVuelta(window.location.pathname)
    window.location.assign(r.url)
  }

  return (
    <Dialogo titulo="Activar pagos con Revolut" alCerrar={alCerrar}>
      <ol className="cxb-revolut-pasos" aria-label="Progreso">
        {PASOS_PAGOS.map((p, i) => <li key={p.id} data-estado={i < indice ? 'hecho' : i === indice ? 'ahora' : 'falta'} aria-current={i === indice ? 'step' : undefined}>{p.texto}{i < indice ? ' ✓' : ''}</li>)}
      </ol>
      <div className="cx-aviso"><strong>Sumied nunca paga solo.</strong> Cada pago lo aprueba una persona que puede pagar. Con un IBAN nuevo, por encima de un tope o con un titular que no coincide, además hace falta la segunda aprobación con la llave o el PIN de pago.</div>

      {paso === 'llave' && <>
        <h3 className="cxl-subtitulo">Antes de pagar, tu llave y tu PIN de pago</h3>
        <p className="cx-ayuda">Son tu segunda aprobación. Con la llave confirmas con la huella, la cara o Windows Hello; el PIN de pago es para cuando no la tengas a mano.</p>
        <TuLlaveYPin alCambiar={mia.recargar} />
        {mia.datos && !tieneSegunda(mia.datos) && <div className="cx-aviso" role="status"><strong>Hace falta al menos uno de los dos.</strong> Sin llave ni PIN no podrías dar la segunda aprobación, y un pago con un IBAN nuevo se quedaría esperando.</div>}
      </>}

      {paso === 'topes' && <>
        <h3 className="cxl-subtitulo">Topes y quién paga</h3>
        {topes.error && <div className="cx-error" role="alert">{topes.error}</div>}
        {topes.datos && !cambiarTopes && (
          <div className="cxb-lista-fila">
            <span className="cxb-lista-texto"><strong>{eurosTope(topes.datos.tope_pago)} por pago y {eurosTope(topes.datos.tope_dia)} al día</strong>
              <span className="cx-ayuda">Podrás pagar tú{quien ? `, ${quien}` : ''}. Más personas, después, en «Topes y permisos».</span></span>
            <button type="button" className="cx-boton-sec" onClick={() => setCambiarTopes(true)}>Cambiar</button>
          </div>
        )}
        {topes.datos && cambiarTopes && <EditarTopes companyId={companyId} topes={topes.datos} alGuardar={() => { setCambiarTopes(false); topes.recargar() }} />}
      </>}

      {paso === 'revolut' && <>
        <h3 className="cxl-subtitulo">Autoriza en Revolut el permiso de pagar</h3>
        <p className="cx-ayuda">Revolut te pedirá entrar y pulsar «Activar acceso». El permiso nuevo es <strong>«Pagar» (PAY)</strong>, además de leer, que ya tenía. Es el mismo certificado: no hay que tocar nada en Revolut › Ajustes › API. Vuelves solo a esta ventana.</p>
        <div className="cxb-revolut-esquema" aria-label="Esquema de lo que enseña Revolut">
          <span>Sumied quiere acceder a tu cuenta</span><span>• Ver cuentas y movimientos</span><span>• Crear beneficiarios y borradores</span><span>• <strong>Hacer pagos</strong> (nuevo)</span>
          <small>Esquema, no captura</small>
        </div>
      </>}

      {error && <div className="cx-error" role="alert">{error}</div>}
      {haciendo && <p className="cx-ayuda" role="status">Hablando con Revolut…</p>}
      <div className="cx-pie">
        {indice > 0 && <button type="button" className="cx-boton-sec" onClick={() => { setError(null); setPaso(PASOS_PAGOS[indice - 1].id) }}>← Volver</button>}
        {paso === 'llave' && <button type="button" className="cx-boton" disabled={!tieneSegunda(mia.datos)} onClick={() => setPaso('topes')}>Seguir</button>}
        {paso === 'topes' && <button type="button" className="cx-boton" disabled={!topes.datos || cambiarTopes} onClick={() => setPaso('revolut')}>Seguir</button>}
        {paso === 'revolut' && <button type="button" className="cx-boton" disabled={haciendo} onClick={() => void autorizar()}>Autorizar en Revolut</button>}
      </div>
    </Dialogo>
  )
}

// ── Topes y permisos ────────────────────────────────────────────────────────

interface Persona { userId: string; nombre: string; rol: string }

export function TopesYPermisos({ alCerrar }: { alCerrar: () => void }) {
  const { companyId, accountId } = useBancos()
  // Quién paga, por su usuario (no por el nombre, que se puede repetir): los permisos vivos de la empresa.
  const quien = useLeer(async () => {
    const { data, error } = await tabla('conta_pago_permiso').select('user_id').eq('company_id', companyId).is('revoked_at', null)
    if (error) throw new Error(`No se ha podido leer quién puede pagar: ${error.message}`)
    return new Set(((data ?? []) as unknown as { user_id: string }[]).map((x) => x.user_id))
  }, `quien-paga:${companyId}`)
  const topes = useLeer(() => rpc<Topes>('conta_pago_topes', { p_company: companyId }), `topes-permisos:${companyId}`)
  const personas = useLeer(() => listUserProfilesByAccount(accountId, { includeInactive: false })
    .then((ps) => ps.filter((p) => p.active).map((p): Persona => ({ userId: p.userId, nombre: p.displayName ?? 'Sin nombre', rol: p.role }))), `personas:${accountId}`)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [haciendo, setHaciendo] = useState<string | null>(null)

  const cambiar = async (p: Persona, dar: boolean) => {
    setHaciendo(p.userId); setAviso(null)
    try {
      const r = await rpc<{ frase: string }>(dar ? 'conta_pago_permiso_dar' : 'conta_pago_permiso_quitar', { p_company: companyId, p_user: p.userId })
      setAviso({ tipo: 'ok', texto: r.frase }); quien.recargar()
    } catch (e) { setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }) }
    setHaciendo(null)
  }

  return (
    <Dialogo titulo="Topes y permisos de pago" alCerrar={alCerrar}>
      <h3 className="cxl-subtitulo">Topes</h3>
      {topes.error && <div className="cx-error" role="alert">{topes.error}</div>}
      {topes.datos && <EditarTopes companyId={companyId} topes={topes.datos} alGuardar={topes.recargar} />}
      <h3 className="cxl-subtitulo">Quién puede pagar</h3>
      <p className="cx-ayuda">Con dos o más personas que pueden pagar, la segunda aprobación la da otra de ellas, con su llave o su PIN. Cada una crea los suyos en «Tu llave y tu PIN».</p>
      {(quien.error ?? personas.error) && <div className="cx-error" role="alert">{quien.error ?? personas.error}</div>}
      <div data-prueba="quien-paga">
        {(personas.datos ?? []).map((p) => {
          const paga = !!quien.datos?.has(p.userId)
          return (
            <div key={p.userId} className="cxb-lista-fila">
              <span className="cxb-lista-texto"><strong>{p.nombre}</strong><span className="cx-ayuda">{paga ? 'puede pagar' : 'no paga'} · {p.rol === 'admin' ? 'administrador' : p.rol === 'manager' ? 'encargado' : 'equipo'}</span></span>
              <button type="button" className={paga ? 'cx-boton-sec cx-peligro' : 'cx-boton-sec'} disabled={haciendo !== null} onClick={() => void cambiar(p, !paga)}>{paga ? 'Quitar el permiso' : 'Dar el permiso'}</button>
            </div>
          )
        })}
      </div>
      <Mensaje a={aviso} />
      <div className="cx-pie"><button type="button" className="cx-boton" onClick={alCerrar}>Cerrar</button></div>
    </Dialogo>
  )
}

// ── Dejar de pagar ──────────────────────────────────────────────────────────

/** «Dejar de pagar» y «Quitar el permiso en Revolut»: lo mismo, la segunda vez Sumied ya no tiene nada que quitar. */
export function DejarDePagar({ soloRevolut, alCerrar, alAvisar }: { soloRevolut: boolean; alCerrar: () => void; alAvisar: (a: Aviso) => void }) {
  const { companyId } = useBancos()
  const [haciendo, setHaciendo] = useState(false)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const dejar = async () => {
    setHaciendo(true); setAviso(null)
    const r = await revolut<{ url?: string; frase?: string }>('dejar_de_pagar', { empresa: companyId })
    setHaciendo(false)
    if (!r.ok) { setAviso({ tipo: 'error', texto: r.texto }); return }
    if (!r.url) { alAvisar({ tipo: 'ok', texto: r.texto ?? 'Ya no se puede pagar con Revolut desde Sumied.' }); alCerrar(); return }
    // En Sumied ya está quitado: se dice antes de irse, por si la persona no vuelve.
    alAvisar({ tipo: 'ok', texto: `${r.frase ?? r.texto} Ahora, en Revolut, quita el permiso de pagar.` })
    recordarVuelta(window.location.pathname)
    window.location.assign(r.url)
  }
  return (
    <Dialogo titulo={soloRevolut ? '¿Quitar el permiso de pagar en Revolut?' : '¿Dejar de pagar con Revolut?'} alCerrar={alCerrar}>
      {soloRevolut
        ? <p>En Sumied ya no se paga. Revolut aún tiene el permiso de pagar que le diste: Sumied te lleva a Revolut para darle otra vez solo el de leer.</p>
        : <>
          <p><strong>Primero, en Sumied y al momento:</strong> nadie podrá pagar con Revolut desde aquí. Lo que espere la segunda aprobación o esté listo para salir se cancela, y se dice cuántos. Lo que ya salió al banco sigue su camino.</p>
          <p><strong>Después, en Revolut:</strong> Sumied te lleva a autorizar otra vez solo leer (READ y WRITE), para que el permiso deje de tener «Pagar». Si allí cancelas, en Sumied ya estará quitado.</p>
          <p className="cx-ayuda">Sumied sigue leyendo los movimientos como antes.</p>
        </>}
      <Mensaje a={aviso} />
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>No, dejarlo</button>
        <button type="button" className="cx-boton cx-peligro" disabled={haciendo} onClick={() => void dejar()}>{soloRevolut ? 'Quitar el permiso en Revolut' : 'Dejar de pagar'}</button>
      </div>
    </Dialogo>
  )
}
