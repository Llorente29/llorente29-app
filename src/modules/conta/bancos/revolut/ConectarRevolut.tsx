// src/modules/conta/bancos/revolut/ConectarRevolut.tsx
//
// B01 Revolut · PR 1 · CONECTAR REVOLUT BUSINESS, en Bancos › Cuentas y
// extractos (maquetas v2, aprobadas el 31/10). Dos piezas:
//
//   · TarjetaRevolut: la tarjeta de Revolut con su estado («Al día · hace 5
//     min», «A medias: falta autorizar», «Desconectada desde Revolut») y su
//     botón (Conectar, Seguir, Desconectar). Al volver de Revolut (la página de
//     vuelta trae revolut_code y revolut_state), termina la conexión y abre el
//     asistente en «ligar».
//   · AsistenteRevolut: los tres pasos en la misma ventana, con su progreso:
//     1. «Copia este certificado» (y desde cuándo traer los movimientos);
//     2. «Pégalo en Revolut › Ajustes › API y pega aquí el Client ID»;
//     3. «Autoriza en Revolut» (leer y avisar; pagar, aparte);
//     y después, ligar cada cuenta en euros a su cuenta contable (la 572 que
//     crea bank_cuenta_nueva) y traer sus movimientos.
// Cada botón dice lo que ha pasado, con contenido (regla 8).

import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { altaBancoNuevo } from '@/modules/conta/services/bancosPantallas'
import {
  bancoLigado, comprobarClientId, NO_DISPONIBLE, desdePropuesto, leerConexion, lineaRevolut, nombreDeBanco, PARAM_CODIGO, PARAM_ERROR, PARAM_ESTADO,
  recordarVuelta, revolut, vueltaDeLaDireccion, type CuentaDeRevolut,
} from '@/modules/conta/bancos/revolut/revolut'

type Paso = 'copiar' | 'pegar' | 'autorizar' | 'ligar'
const PASOS: { id: Paso; texto: string }[] = [
  { id: 'copiar', texto: '1 · Copia el certificado' },
  { id: 'pegar', texto: '2 · Pégalo en Revolut' },
  { id: 'autorizar', texto: '3 · Autoriza' },
]

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true } catch { return false }
}

export function TarjetaRevolut() {
  const { companyId } = useBancos()
  const location = useLocation()
  const navigate = useNavigate()
  const lectura = useLeer(() => leerConexion(companyId).then((c) => ({ c })), `revolut:${companyId}`)
  const noDisponible = lectura.datos?.c === NO_DISPONIBLE
  const conexion = lectura.datos && lectura.datos.c !== NO_DISPONIBLE ? lectura.datos.c : null
  const cargar = lectura.recargar
  // La vuelta de Revolut: se toma una vez, al llegar, y se quita de la dirección.
  const [vuelta] = useState(() => vueltaDeLaDireccion(location.search))
  const terminada = useLeer(vuelta && 'code' in vuelta ? () => revolut<{ cuentas: CuentaDeRevolut[] }>('vuelta', { code: vuelta.code, state: vuelta.state }) : null, `revolut-vuelta:${companyId}`)
  useEffect(() => {
    if (!vuelta) return
    const q = new URLSearchParams(location.search)
    q.delete(PARAM_CODIGO); q.delete(PARAM_ESTADO); q.delete(PARAM_ERROR)
    navigate({ pathname: location.pathname, search: q.toString() }, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez, al llegar de Revolut
  }, [])
  const [elegido, setElegido] = useState<{ paso: Paso; cuentas?: CuentaDeRevolut[] } | null>(null)
  const [cerradaLaVuelta, setCerradaLaVuelta] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const [confirmar, setConfirmar] = useState(false)

  // Lo que dice la vuelta, si no se ha cerrado: el asistente en «ligar», o en «autorizar» con su porqué.
  const deLaVuelta: { paso: Paso; cuentas?: CuentaDeRevolut[]; aviso: { tipo: 'ok' | 'error'; texto: string } } | null = cerradaLaVuelta || !vuelta ? null
    : 'error' in vuelta ? { paso: 'autorizar', aviso: { tipo: 'error', texto: vuelta.error === 'access_denied' ? 'No has autorizado en Revolut. Vuelve a pulsar «Autorizar en Revolut».' : 'Revolut ha vuelto sin el permiso. Vuelve a pulsar «Autorizar en Revolut».' } }
    : !terminada.datos ? null
    : terminada.datos.ok ? { paso: 'ligar', cuentas: terminada.datos.cuentas, aviso: { tipo: 'ok', texto: terminada.datos.texto ?? 'Conectado con Revolut Business.' } }
    : { paso: 'autorizar', aviso: { tipo: 'error', texto: terminada.datos.texto } }
  const abierto = elegido ?? deLaVuelta
  const avisoVisible = aviso ?? deLaVuelta?.aviso ?? null
  const setAbierto = (a: { paso: Paso; cuentas?: CuentaDeRevolut[] } | null) => { setCerradaLaVuelta(true); setElegido(a) }
  const terminandoLaVuelta = !!vuelta && 'code' in vuelta && !terminada.datos && !terminada.error

  const desconectar = async () => {
    setHaciendo(true); setAviso(null)
    const r = await revolut('desconectar', { empresa: companyId })
    setHaciendo(false); setConfirmar(false)
    setCerradaLaVuelta(true)
    setAviso(r.ok ? { tipo: 'ok', texto: r.texto ?? 'Desconectado.' } : { tipo: 'error', texto: r.texto })
    cargar()
  }

  const abrirLigar = async () => {
    setHaciendo(true)
    const r = await revolut<{ cuentas: CuentaDeRevolut[] }>('cuentas', { empresa: companyId })
    setHaciendo(false)
    if (!r.ok) { setAviso({ tipo: 'error', texto: r.texto }); return }
    setAbierto({ paso: 'ligar', cuentas: r.cuentas })
  }

  if (!lectura.datos && !lectura.error) return null
  if (noDisponible) {
    return (
      <div className="cx-tarjeta cxb-revolut" aria-label="Revolut Business" data-prueba="revolut">
        <div className="cxb-revolut-cabeza"><span className="cxb-revolut-logo" aria-hidden="true">R</span>
          <span className="cxb-lista-texto"><strong>Revolut Business</strong><span className="cx-ayuda">Revolut aún no está en este entorno: llega con la próxima actualización.</span></span></div>
      </div>
    )
  }
  const l = lineaRevolut(conexion, new Date())
  return (
    <div className="cx-tarjeta cxb-revolut" aria-label="Revolut Business" data-prueba="revolut">
      <div className="cxb-revolut-cabeza">
        <span className="cxb-revolut-logo" aria-hidden="true">R</span>
        <span className="cxb-lista-texto"><strong>Revolut Business</strong>
          <span className={l.nivel === 'error' ? 'cx-error' : l.nivel === 'aviso' ? 'cx-aviso' : 'cx-ayuda'} role={l.nivel === 'error' ? 'alert' : 'status'}>{l.texto}</span></span>
        <span className="cxb-revolut-botones">
          {l.boton === 'conectar' && <button type="button" className="cx-boton" onClick={() => setAbierto({ paso: 'copiar' })}>Conectar Revolut</button>}
          {l.boton === 'reconectar' && <button type="button" className="cx-boton" onClick={() => setAbierto({ paso: 'copiar' })}>Volver a conectar</button>}
          {l.boton === 'seguir' && <button type="button" className="cx-boton" onClick={() => setAbierto({ paso: conexion?.estado === 'autorizar' ? 'autorizar' : 'copiar' })}>Seguir</button>}
          {l.boton === 'desconectar' && <>
            <button type="button" className="cx-boton-sec" onClick={() => void abrirLigar()} disabled={haciendo}>Cuentas</button>
            <button type="button" className="cx-boton-sec cx-peligro" onClick={() => setConfirmar(true)} disabled={haciendo}>Desconectar</button>
          </>}
        </span>
      </div>
      {(haciendo || terminandoLaVuelta) && <p className="cx-ayuda" role="status">Hablando con Revolut…</p>}
      {lectura.error && <div className="cx-error" role="alert">{lectura.error}</div>}
      {terminada.error && <div className="cx-error" role="alert">{terminada.error}</div>}
      {avisoVisible && <div className={avisoVisible.tipo === 'ok' ? 'cx-guardado' : 'cx-error'} role={avisoVisible.tipo === 'ok' ? 'status' : 'alert'}>{avisoVisible.texto}</div>}
      {confirmar && (
        <Dialogo titulo="¿Desconectar Revolut?" alCerrar={() => setConfirmar(false)}>
          <p>Sumied deja de leer las cuentas de Revolut. Lo que ya entró se queda. Borra su llave y su permiso al momento.</p>
          <div className="cx-aviso">Quita también el certificado en Revolut › Ajustes › API: desde aquí Sumied no puede borrarlo allí.</div>
          <div className="cx-pie">
            <button type="button" className="cx-boton-sec" onClick={() => setConfirmar(false)}>No, dejarla</button>
            <button type="button" className="cx-boton cx-peligro" onClick={() => void desconectar()} disabled={haciendo}>Desconectar</button>
          </div>
        </Dialogo>
      )}
      {abierto && <AsistenteRevolut key={`${abierto.paso}:${abierto.cuentas?.length ?? ''}`} inicio={abierto.paso} cuentas={abierto.cuentas ?? null} alCerrar={() => { setAbierto(null); cargar() }}
        alAvisar={(t) => setAviso({ tipo: 'ok', texto: t })} />}
    </div>
  )
}

function AsistenteRevolut({ inicio, cuentas: cuentasIniciales, alCerrar, alAvisar }: {
  inicio: Paso; cuentas: CuentaDeRevolut[] | null; alCerrar: () => void; alAvisar: (texto: string) => void
}) {
  const { companyId, quien, datos, recargar } = useBancos()
  const [paso, setPaso] = useState<Paso>(inicio)
  const [desde, setDesde] = useState(desdePropuesto(new Date()))
  const [clientId, setClientId] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const cuentas = cuentasIniciales
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [haciendo, setHaciendo] = useState(false)

  // El certificado (el mismo si ya había uno a medias) y la dirección de vuelta de la marca por la que se entra.
  const empezado = useLeer(paso === 'copiar' || paso === 'pegar'
    ? () => revolut<{ certificado: string; vuelta: string }>('empezar', { empresa: companyId, origen: window.location.origin, desde: desdePropuesto(new Date()) })
    : null, `revolut-empezar:${companyId}:${paso === 'copiar' || paso === 'pegar'}`)
  const cert = empezado.datos?.ok ? { certificado: empezado.datos.certificado, vuelta: empezado.datos.vuelta } : null
  const errorAlEmpezar = empezado.error ?? (empezado.datos && !empezado.datos.ok ? empezado.datos.texto : null)

  const copiarYDecir = async (texto: string, que: string) => setHecho(await copiar(texto) ? `${que} copiado.` : `No se ha podido copiar solo: selecciónalo y cópialo a mano.`)

  const seguirDeCopiar = async () => {
    setError(null); setHaciendo(true)
    const r = await revolut<{ certificado: string; vuelta: string }>('empezar', { empresa: companyId, origen: window.location.origin, desde })
    setHaciendo(false)
    if (!r.ok) { setError(r.texto); return }
    setHecho(null); setPaso('pegar')
  }

  const mandarClientId = async () => {
    const motivo = comprobarClientId(clientId)
    if (motivo) { setError(motivo); return }
    setError(null); setHaciendo(true)
    const r = await revolut<{ url: string }>('client_id', { empresa: companyId, clientId: clientId.trim() })
    setHaciendo(false)
    if (!r.ok) { setError(r.texto); return }
    setUrl(r.url); setPaso('autorizar')
  }

  const autorizar = async () => {
    if (!url) {
      // Volviendo a un «a medias»: se pide otra autorización con el Client ID ya guardado.
      if (!clientId.trim()) { setPaso('pegar'); setError('Pega otra vez el Client ID de Revolut para autorizar.'); return }
      await mandarClientId(); return
    }
    recordarVuelta(window.location.pathname)
    window.location.assign(url)
  }

  const ligar = async (c: CuentaDeRevolut) => {
    setError(null); setHaciendo(true)
    try {
      const h = await altaBancoNuevo(companyId, { tipo: 'bank', nombre: nombreDeBanco(c), iban: c.iban, localId: null, comun: true }, quien)
      setHecho(`Ligada: ${nombreDeBanco(c)} ···${c.iban4}${h.cuenta ? `, con su cuenta contable ${h.cuenta}` : ''}.`)
      recargar()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setHaciendo(false)
  }

  const traer = async () => {
    setError(null); setHaciendo(true)
    const r = await revolut('leer', { empresa: companyId })
    setHaciendo(false)
    if (!r.ok) { setError(r.texto); return }
    alAvisar(r.texto ?? 'Movimientos traídos de Revolut.')
    recargar(); alCerrar()
  }

  const indice = PASOS.findIndex((p) => p.id === paso)
  return (
    <Dialogo titulo={paso === 'ligar' ? 'Revolut conectado: liga sus cuentas' : 'Conectar Revolut Business'} alCerrar={alCerrar}>
      {paso !== 'ligar' && (
        <ol className="cxb-revolut-pasos" aria-label="Progreso">
          {PASOS.map((p, i) => <li key={p.id} data-estado={i < indice ? 'hecho' : i === indice ? 'ahora' : 'falta'} aria-current={i === indice ? 'step' : undefined}>{p.texto}{i < indice ? ' ✓' : ''}</li>)}
        </ol>
      )}

      {paso === 'copiar' && (
        <div className="cx-formulario">
          <h3 className="cxl-subtitulo">Copia este certificado</h3>
          <p className="cx-ayuda">Sumied lo ha hecho para tu empresa. Es la parte pública de una llave: la otra mitad se queda guardada en Sumied y no la ve nadie, tampoco tú.</p>
          {cert ? <pre className="cxb-revolut-cert" data-prueba="certificado">{cert.certificado}</pre> : <p className="cx-ayuda">Preparando el certificado…</p>}
          <button type="button" className="cx-boton" disabled={!cert} onClick={() => cert && void copiarYDecir(cert.certificado, 'Certificado')}>Copiar el certificado</button>
          <label className="cx-campo"><span>Trae los movimientos desde</span>
            <input className="cx-input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <p className="cx-ayuda">El paso 2 se hace en Revolut Business desde un ordenador: la sección de API no está en la app del móvil.</p>
        </div>
      )}

      {paso === 'pegar' && (
        <div className="cx-formulario">
          <h3 className="cxl-subtitulo">Pega el certificado en Revolut y trae el código que te da</h3>
          <ol className="cx-ayuda cxb-revolut-instrucciones">
            <li>Abre Revolut Business en el ordenador y entra en <strong>Ajustes › API</strong>.</li>
            <li>Pulsa <strong>Añadir certificado</strong>. En «Dirección de vuelta» (OAuth redirect URI) pega{' '}
              <code data-prueba="vuelta">{cert?.vuelta ?? '…'}</code>{' '}
              <button type="button" className="cx-boton-sec" disabled={!cert} onClick={() => cert && void copiarYDecir(cert.vuelta, 'Dirección')}>Copiar</button>
              {' '}y en «Certificado», el que copiaste.</li>
            <li>Revolut te enseña un <strong>Client ID</strong>. Cópialo y pégalo aquí.</li>
          </ol>
          <div className="cxb-revolut-esquema" aria-label="Esquema de dónde está en Revolut">
            <span>Ajustes › <strong>API</strong></span><span>Business API · Certificados · <strong>+ Añadir certificado</strong></span><span>Client ID · <code>AbC…xYz</code></span>
            <small>Esquema, no captura</small>
          </div>
          <label className="cx-campo"><span>Client ID de Revolut</span>
            <input className="cx-input cx-cifra" value={clientId} onChange={(e) => { setClientId(e.target.value); setError(null) }} autoComplete="off" spellCheck={false} data-prueba="client-id" />
          </label>
        </div>
      )}

      {paso === 'autorizar' && (
        <div className="cx-formulario">
          <h3 className="cxl-subtitulo">Autoriza en Revolut</h3>
          <p className="cx-ayuda">Se abre Revolut. Pulsa «Activar acceso» y vuelves solo a Sumied. Sumied pide permiso para <strong>leer tus movimientos</strong> y para que Revolut le <strong>avise</strong> de cada uno, así entran al momento. <strong>No puede pagar</strong>: para eso pedirá un permiso aparte cuando actives los pagos.</p>
          {!url && <label className="cx-campo"><span>Client ID de Revolut (para volver a autorizar)</span>
            <input className="cx-input cx-cifra" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>}
        </div>
      )}

      {paso === 'ligar' && (
        <div className="cx-formulario" data-prueba="ligar">
          <p className="cx-ayuda">Cada cuenta de Revolut en euros, con su cuenta contable. Sumied le crea la subcuenta 572 siguiente.</p>
          {(cuentas ?? []).map((c) => {
            const ligada = bancoLigado(c, datos.bancos)
            return (
              <div key={c.id} className="cxb-lista-fila">
                <span className="cxb-lista-texto"><strong>{c.nombre} · {c.divisa}{c.iban4 ? ` ···${c.iban4}` : ''}</strong>
                  <span className="cx-ayuda">{c.divisa !== 'EUR' ? `En ${c.divisa}: se ve, pero no se trae todavía.` : ligada ? `Ligada a ${ligada.nombre}.` : 'Sin ligar.'}</span></span>
                {c.divisa === 'EUR' && c.iban && !ligada && <button type="button" className="cx-boton-sec" disabled={haciendo} onClick={() => void ligar(c)}>Ligar</button>}
              </div>
            )
          })}
          {(cuentas ?? []).length === 0 && <p className="cx-ayuda">Revolut no ha dado ninguna cuenta activa.</p>}
        </div>
      )}

      {hecho && <div className="cx-guardado" role="status">{hecho}</div>}
      {(error ?? errorAlEmpezar) && <div className="cx-error" role="alert">{error ?? errorAlEmpezar}</div>}
      <div className="cx-pie">
        {paso === 'pegar' && <button type="button" className="cx-boton-sec" onClick={() => { setError(null); setPaso('copiar') }}>← Volver al certificado</button>}
        {paso === 'copiar' && <button type="button" className="cx-boton" disabled={!cert || haciendo} onClick={() => void seguirDeCopiar()}>Seguir</button>}
        {paso === 'pegar' && <button type="button" className="cx-boton" disabled={!clientId.trim() || haciendo} onClick={() => void mandarClientId()}>Seguir</button>}
        {paso === 'autorizar' && <button type="button" className="cx-boton" disabled={haciendo} onClick={() => void autorizar()}>Autorizar en Revolut</button>}
        {paso === 'ligar' && <>
          <button type="button" className="cx-boton-sec" onClick={alCerrar}>Más tarde</button>
          <button type="button" className="cx-boton" disabled={haciendo || !(cuentas ?? []).some((c) => bancoLigado(c, datos.bancos))} onClick={() => void traer()}>Traer los movimientos</button>
        </>}
      </div>
    </Dialogo>
  )
}
