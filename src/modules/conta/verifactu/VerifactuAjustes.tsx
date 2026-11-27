// src/modules/conta/verifactu/VerifactuAjustes.tsx
//
// V03 · Entrega 2 · Ajustes › Facturación › Verifactu (tablero 25): el alta en
// tres pasos.
//   1. Tus datos: la empresa, su NIF y desde cuándo le obliga.
//   2. Cómo se envían a Hacienda: por Sumied como colaborador social
//      (recomendado; preparada y todavía cerrada: lo dice) o con el certificado
//      de la empresa, autorizado una vez y solo para Verifactu (AUTORIZO,
//      retirable).
//   3. Prueba y pasa a real: pruebas primero; a real escribiendo EMPEZAR, con
//      su serie nueva. El candado de la base (una prueba de conexión correcta
//      con Hacienda) se dice antes de pulsar, no después.
// Y «¿Facturas también con otro programa?», con su aviso; a la derecha, lo que
// hace Sumied y «Ver la declaración responsable» (el texto lo pone Julio).
// E3: «Comprobar la cadena» y «Exportar los registros» (CadenaYExportar).
// Cada botón confirma o falla en pantalla, con contenido (regla 8).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaImpuestos } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Boton, Campo, Chip, Dialogo, Selector, Tarjeta, Texto } from '@/modules/conta/diseno'
import { leerCertificados } from '@/modules/conta/services/impuestosService'
import {
  autorizarCertificado, cambiarModo, enviarPruebas, guardarOtrosProgramas, leerVerifactu, pedirPruebas, probarConexion, resumenPruebas, retirarAutorizacion,
  type DatosVerifactu, type ResumenPruebas,
} from '@/modules/conta/services/verifactuService'
import { OBLIGA_VERIFACTU, OTROS_PROGRAMAS, avisoOtrosProgramas, obligaDesde, textoConexion, textoEnvioPruebas } from '@/modules/conta/lib/verifactu/estado'
import { modulosQr, urlQr } from '@/modules/conta/lib/verifactu/qr'
import { CadenaYExportar } from './CadenaYExportar'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const fecha = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')

type Aviso = { ok: boolean; texto: string } | null

export function VerifactuAjustes() {
  const { accountId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(accountId && activa ? () => leerVerifactu(accountId, activa.id, activa.nif) : null, `${accountId}:${activa?.id}:verifactu:${vuelta}`)
  // Lo último leído: al volver a leer (después de guardar) la pantalla no se
  // desmonta, y cada paso conserva su aviso a la vista (regla 8).
  const [ultimo, setUltimo] = useState<DatosVerifactu | null>(null)
  if (datos.datos && datos.datos !== ultimo) setUltimo(datos.datos)
  if (!activa) return <p className="s-apoyo">Aún no hay ninguna empresa: da de alta tu empresa y aquí sale su Verifactu.</p>
  if (datos.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido leer Verifactu: {datos.error} <button type="button" className="s-boton s-boton-enlace" onClick={datos.recargar}>Reintentar</button></p>
  const d = datos.datos ?? ultimo
  if (!d) return <div className="s-lista" aria-busy="true" aria-label="Cargando Verifactu"><div className="s-lista-cargando" /></div>
  const recargar = () => setVuelta((x) => x + 1)
  return (
    <div className="cxvf-alta" data-prueba="verifactu-alta">
      <header className="cxvf-alta-cabeza">
        <h1 className="cxvf-alta-titulo">Verifactu: tus facturas, directas a Hacienda</h1>
        <p className="s-apoyo">Desde el {OBLIGA_VERIFACTU.texto} cada factura que emitas tiene que llegar a Hacienda en el momento ({OBLIGA_VERIFACTU.norma}). Sumied lo hace solo. Lo dejas listo en tres pasos.</p>
      </header>
      {d.empresa.modo === 'pruebas' && (
        // V05 · Mientras está en pruebas, la banda fija (como en el tablero 26).
        <div className="cxvf-banda" role="status" data-prueba="banda-pruebas-ajustes">
          <span className="cxvf-banda-chip">Pruebas</span>
          <span className="cxvf-banda-texto">Estás en pruebas: tus facturas llegan al entorno de pruebas de Hacienda, con la marca «PRUEBA». No cuentan.</span>
        </div>
      )}
      <ProbarConexion d={d} companyId={activa.id} alCambiar={recargar} />
      {d.fabricantePuesto === false && (
        <p className="s-aviso-lista" data-tono="falta" role="status" data-prueba="aviso-fabricante">
          Falta quién fabrica Sumied (el nombre y el NIF de la declaración responsable): hasta que esté puesto, Verifactu no se puede pasar a real. En pruebas sí se puede trabajar.
        </p>
      )}
      <div className="cxvf-alta-columnas">
        <div className="cxvf-pasos">
          <PasoDatos razon={activa.razonSocial ?? activa.nombre} nif={activa.nif} />
          <PasoVia d={d} companyId={activa.id} quien={userName ?? null} alCambiar={recargar} />
          <PasoPruebas d={d} companyId={activa.id} quien={userName ?? null} alCambiar={recargar} />
          <OtrosProgramas d={d} companyId={activa.id} quien={userName ?? null} alCambiar={recargar} />
          {accountId && <CadenaYExportar accountId={accountId} companyId={activa.id} nombre={activa.razonSocial ?? activa.nombre} nif={activa.nif} />}
        </div>
        <LoQueHaceSumied />
      </div>
    </div>
  )
}

/**
 * V05 · «Probar la conexión», a la vista y sin buscarlo: pide a Hacienda de
 * pruebas una consulta con el certificado autorizado y dice qué pasó y de quién
 * es la culpa. En pruebas, además, «Lanzar las facturas de prueba» y «Enviar a
 * Hacienda» (V05b: nadie tiene que llamar a nada a mano), con cuántas aceptó
 * Hacienda y el QR de una aceptada para escanearlo en el cotejo de pruebas.
 */
function ProbarConexion({ d, companyId, alCambiar }: { d: DatosVerifactu; companyId: string; alCambiar: () => void }) {
  const [ocupado, setOcupado] = useState<null | 'probar' | 'facturas' | 'enviar'>(null)
  const [vueltaResumen, setVueltaResumen] = useState(0)
  const enPruebas = d.empresa.modo === 'pruebas'
  const resumen = useLeer(enPruebas ? () => resumenPruebas(companyId) : null, `${companyId}:verifactu-resumen-pruebas:${vueltaResumen}`)
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'falta' | 'duda'; texto: string } | null>(null)
  if (d.empresa.modo === 'real') return null
  const probar = () => {
    setOcupado('probar'); setAviso(null)
    void probarConexion(companyId)
      .then((c) => { setAviso(textoConexion(c)); if (c?.ok) alCambiar() })
      .catch((e) => setAviso({ tono: 'falta', texto: msg(e) }))
      .finally(() => setOcupado(null))
  }
  const facturas = () => {
    setOcupado('facturas'); setAviso(null)
    void pedirPruebas(companyId, 'preparar_pruebas')
      .then(() => setAviso({ tono: 'ok', texto: 'Pedidas las 25 facturas de prueba (con una rectificativa y una a un cliente de fuera de la UE). Cuando estén preparadas, pulsa «Enviar a Hacienda»: aquí sale cuántas aceptó.' }))
      .catch((e) => setAviso({ tono: 'falta', texto: msg(e) }))
      .finally(() => { setOcupado(null); setVueltaResumen((x) => x + 1) })
  }
  const enviar = () => {
    setOcupado('enviar'); setAviso(null)
    void enviarPruebas(companyId)
      .then((r) => setAviso(textoEnvioPruebas(r)))
      .catch((e) => setAviso({ tono: 'falta', texto: msg(e) }))
      .finally(() => { setOcupado(null); setVueltaResumen((x) => x + 1) })
  }
  return (
    <section className="cxvf-probar" aria-label="Probar la conexión con Hacienda" data-prueba="probar-conexion">
      <p className="s-apoyo">{d.pruebasProbada ? 'La conexión con el entorno de pruebas de Hacienda ya salió bien una vez.' : 'Antes de las pruebas, comprueba que Sumied llega al entorno de pruebas de Hacienda con tu certificado. No se envía ninguna factura.'}</p>
      <span className="cxvf-botones">
        <Boton variante={d.pruebasProbada ? 'secundario' : 'principal'} disabled={ocupado !== null || !d.autorizacion}
          title={d.autorizacion ? undefined : 'Primero autoriza tu certificado para Verifactu (paso 2)'} onClick={probar}>
          {ocupado === 'probar' ? 'Probando… (hasta un minuto)' : 'Probar la conexión'}
        </Boton>
        {enPruebas && (
          <Boton variante="secundario" disabled={ocupado !== null} onClick={facturas}>{ocupado === 'facturas' ? 'Pidiendo…' : 'Lanzar las facturas de prueba'}</Boton>
        )}
        {enPruebas && (
          <Boton variante="secundario" disabled={ocupado !== null} onClick={enviar}>{ocupado === 'enviar' ? 'Enviando… (hasta minuto y medio)' : 'Enviar a Hacienda'}</Boton>
        )}
      </span>
      {enPruebas && resumen.datos && <ResumenDePruebas r={resumen.datos} />}
      {!d.autorizacion && <p className="s-tarjeta-apoyo">Para probar, autoriza antes tu certificado para Verifactu (paso 2).</p>}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.tono} role="status" data-prueba="resultado-conexion">{aviso.texto}</p>}
    </section>
  )
}

/** Cómo van las de pruebas, y el QR de una aceptada para escanearlo con el móvil. */
function ResumenDePruebas({ r }: { r: ResumenPruebas }) {
  if (r.total === 0) return <p className="s-tarjeta-apoyo" data-prueba="resumen-pruebas">Aún no hay ninguna factura de prueba.</p>
  let url: string | null = null
  if (r.para_qr) {
    try { url = urlQr({ nif: r.para_qr.nif, numSerie: r.para_qr.num_serie, fecha: r.para_qr.fecha, importe: r.para_qr.importe }, 'pruebas') } catch { url = null }
  }
  return (
    <div className="cxvf-resumen-pruebas" data-prueba="resumen-pruebas">
      <p className="s-tarjeta-apoyo">
        En pruebas: {r.correctas} aceptadas, {r.con_errores} con errores, {r.rechazadas} rechazadas y {r.pendientes} sin enviar.
        {r.ultimo_rechazo && <> La última rechazada, {r.ultimo_rechazo.num_serie}: {r.ultimo_rechazo.codigo ?? 'sin código'} · {r.ultimo_rechazo.texto ?? 'sin texto'}.</>}
      </p>
      {url && r.para_qr && (
        <div className="cxvf-qr-prueba">
          <QrSvg url={url} />
          <span className="s-tarjeta-apoyo">QR de {r.para_qr.num_serie}: escanéalo o <a href={url} target="_blank" rel="noreferrer">ábrelo en el cotejo de pruebas de Hacienda</a>.</span>
        </div>
      )}
    </div>
  )
}

function QrSvg({ url }: { url: string }) {
  const m = modulosQr(url)
  const n = m.length + 8
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={128} height={128} role="img" aria-label="QR tributario de la factura de prueba" shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      {m.flatMap((fila, i) => fila.map((negro, j) => (negro ? <rect key={`${i}-${j}`} x={j + 4} y={i + 4} width={1} height={1} fill="#000" /> : null)))}
    </svg>
  )
}

function Paso({ n, estado, titulo, children }: { n: number; estado: 'hecho' | 'ahora' | 'luego'; titulo: string; children?: React.ReactNode }) {
  return (
    <section className="cxvf-paso" data-estado={estado} aria-label={`Paso ${n}: ${titulo}`}>
      <span className="cxvf-paso-numero" aria-hidden="true">{estado === 'hecho' ? '✓' : n}</span>
      <div className="cxvf-paso-cuerpo">
        <h2 className="cxvf-paso-titulo">{titulo}</h2>
        {children}
      </div>
    </section>
  )
}

function PasoDatos({ razon, nif }: { razon: string; nif: string | null }) {
  const o = obligaDesde(nif)
  return (
    <Paso n={1} estado={nif ? 'hecho' : 'ahora'} titulo="Tus datos">
      {nif
        ? <p className="s-apoyo">{razon} · {nif} · {o.quien === 'sociedad' ? 'sociedad' : 'autónomo'}: te obliga desde el <strong>{o.texto}</strong> ({OBLIGA_VERIFACTU.norma})</p>
        : <p className="s-aviso-lista" data-tono="falta">Tu empresa no tiene NIF: ponlo en Ajustes › Tu empresa. Sin él, Hacienda no recibe nada.</p>}
    </Paso>
  )
}

function PasoVia({ d, companyId, quien, alCambiar }: { d: DatosVerifactu; companyId: string; quien: string | null; alCambiar: () => void }) {
  const [via, setVia] = useState<'colaborador' | 'certificado'>(d.autorizacion ? 'certificado' : d.empresa.via)
  const [aviso, setAviso] = useState<Aviso>(null)
  const [retirar, setRetirar] = useState(false)
  return (
    <Paso n={2} estado={d.autorizacion ? 'hecho' : 'ahora'} titulo="Cómo se envían a Hacienda">
      <div role="radiogroup" aria-label="Cómo se envían a Hacienda" className="cxv-opciones">
        <label className="cxv-opcion" data-elegida={via === 'colaborador' ? '' : undefined}>
          <input type="radio" name="via-verifactu" checked={via === 'colaborador'} onChange={() => setVia('colaborador')} />
          <span>
            <strong>Que Sumied las envíe por ti <Chip tono="seguro">Recomendado</Chip></strong>
            <span className="s-tarjeta-apoyo">Sumied es colaborador social de Hacienda. Tú solo firmas una vez la autorización.</span>
            <span className="cxvf-pros">✓ No tienes que subir ni renovar ningún certificado</span>
            <span className="cxvf-pros">✓ Sirve también si no tienes certificado de empresa: firma tu DNI</span>
            <span className="cxvf-pros">✓ Lo puedes retirar cuando quieras</span>
          </span>
        </label>
        <label className="cxv-opcion" data-elegida={via === 'certificado' ? '' : undefined}>
          <input type="radio" name="via-verifactu" checked={via === 'certificado'} onChange={() => setVia('certificado')} />
          <span>
            <strong>Con tu certificado de empresa</strong>
            <span className="s-tarjeta-apoyo">Subes el certificado (.pfx o .p12) y Sumied envía con él.</span>
            <span className="cxvf-pros">✓ Si ya lo tienes, es inmediato</span>
            <span className="cxvf-contras">— Caduca: te avisamos 30 días antes y hay que volver a subirlo</span>
          </span>
        </label>
      </div>
      {via === 'colaborador' && <FirmaColaborador />}
      {via === 'certificado' && (d.autorizacion
        ? (
          <div className="s-aviso-lista" data-tono="ok" data-prueba="autorizacion-viva">
            <p>Autorizado el certificado para Verifactu por {d.autorizacion.por} el {fecha(d.autorizacion.el)}. Solo sirve para enviar facturas: presentar impuestos sigue pidiendo tu confirmación cada vez.</p>
            <Boton variante="enlace" onClick={() => setRetirar(true)}>Retirar la autorización</Boton>
          </div>
        )
        : <AutorizarCertificado companyId={companyId} quien={quien} alHecho={(t) => { setAviso({ ok: true, texto: t }); alCambiar() }} />)}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'} role="status">{aviso.texto}</p>}
      {retirar && (
        <DialogoRetirar alCerrar={() => setRetirar(false)} alRetirar={async (motivo) => {
          try {
            await retirarAutorizacion(companyId, motivo, quien)
            setRetirar(false); setAviso({ ok: true, texto: 'Retirada la autorización: Sumied ya no envía con tu certificado. Vuelve a la vía de colaborador social.' }); alCambiar()
            return null
          } catch (e) { return msg(e) }
        }} />
      )}
    </Paso>
  )
}

/** La firma del modelo de Hacienda (colaborador social): preparada y aún cerrada. Se dice, no se calla (regla 8). */
function FirmaColaborador() {
  return (
    <Tarjeta titulo="Firma la autorización" apoyo="Es el modelo oficial de Hacienda. Ya está rellenado con tus datos: no tienes que escribir nada." nivel={3}>
      <div className="cxvf-firma">
        <div>
          <strong>Con certificado digital</strong>
          <p className="s-tarjeta-apoyo">El tuyo personal o el de la empresa. Un clic y se firma con AutoFirma.</p>
          <Boton variante="principal" disabled title="Se abre cuando Sumied sea colaborador social de Hacienda">Firmar ahora</Boton>
        </div>
        <div>
          <strong>A mano</strong>
          <p className="s-tarjeta-apoyo">Descárgalo, fírmalo, ponle el sello y sube una foto junto con tu DNI.</p>
          <span className="cxvf-botones">
            <Boton variante="secundario" disabled title="Se abre cuando Sumied sea colaborador social de Hacienda">Descargar</Boton>
            <Boton variante="secundario" disabled title="Se abre cuando Sumied sea colaborador social de Hacienda">Subir firmado</Boton>
          </span>
        </div>
      </div>
      <p className="s-aviso-lista" data-tono="duda" data-prueba="colaborador-cerrado">Esta vía todavía no está abierta: Sumied está terminando su alta como colaborador social de Hacienda. Mientras, puedes enviar con tu certificado de empresa.</p>
      <p className="s-tarjeta-apoyo">Hacienda no admite «acepto las condiciones»: por eso hace falta tu firma. Lo revisamos y en 1 día laborable queda activo.</p>
    </Tarjeta>
  )
}

function AutorizarCertificado({ companyId, quien, alHecho }: { companyId: string; quien: string | null; alHecho: (texto: string) => void }) {
  const certs = useLeer(() => leerCertificados(companyId), `${companyId}:certificados-verifactu`)
  const [elegido, setElegido] = useState('')
  const [palabra, setPalabra] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  if (certs.error) return <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer tus certificados: {certs.error}</p>
  if (!certs.datos) return <p className="s-apoyo">Leyendo tus certificados…</p>
  const vivos = certs.datos.certificados.filter((c) => c.estado === 'active')
  if (vivos.length === 0) {
    return <p className="s-aviso-lista" data-tono="duda">No hay ningún certificado de la empresa en vigor. Súbelo en <Link to={rutaImpuestos('certificados')}>Impuestos › Certificados y accesos</Link> y vuelve aquí para autorizarlo.</p>
  }
  const cert = elegido || vivos[0].id
  return (
    <div className="cxvf-autorizar" data-prueba="autorizar-certificado">
      <Campo etiqueta="El certificado">{(p) => <Selector {...p} valor={cert} alCambiar={setElegido}
        opciones={vivos.map((c) => ({ valor: c.id, texto: `${c.titular} · caduca el ${fecha(c.caduca)}` }))} />}</Campo>
      <p className="s-apoyo">Autorizas a Sumied a usar este certificado <strong>solo para enviar Verifactu</strong>: cada envío queda apuntado y lo puedes retirar cuando quieras. Para presentar impuestos seguirá pidiéndote confirmación.</p>
      <Campo etiqueta="Escribe AUTORIZO">{(p) => <Texto {...p} valor={palabra} alCambiar={setPalabra} maxLength={10} />}</Campo>
      <Boton variante="principal" disabled={palabra.trim() !== 'AUTORIZO' || ocupado} onClick={() => {
        setOcupado(true); setFallo(null)
        void autorizarCertificado(companyId, cert, palabra.trim(), quien)
          .then(() => alHecho(`Autorizado el certificado de ${vivos.find((c) => c.id === cert)?.titular ?? 'la empresa'} solo para Verifactu.`))
          .catch((e) => setFallo(msg(e)))
          .finally(() => setOcupado(false))
      }}>{ocupado ? 'Autorizando…' : 'Autorizar'}</Boton>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
    </div>
  )
}

function DialogoRetirar({ alCerrar, alRetirar }: { alCerrar: () => void; alRetirar: (motivo: string) => Promise<string | null> }) {
  const [motivo, setMotivo] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  return (
    <Dialogo titulo="Retirar la autorización" alCerrar={alCerrar} explicacion="Sumied deja de enviar con tu certificado. Queda apuntado quién la retira, cuándo y por qué."
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={!motivo.trim() || ocupado} onClick={() => { setOcupado(true); void alRetirar(motivo.trim()).then((e) => { setFallo(e); setOcupado(false) }) }}>{ocupado ? 'Retirando…' : 'Retirar'}</Boton>
      </>}>
      <Campo etiqueta="Por qué">{(p) => <Texto {...p} valor={motivo} alCambiar={setMotivo} maxLength={200} />}</Campo>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
    </Dialogo>
  )
}

function PasoPruebas({ d, companyId, quien, alCambiar }: { d: DatosVerifactu; companyId: string; quien: string | null; alCambiar: () => void }) {
  const [aviso, setAviso] = useState<Aviso>(null)
  const [ocupado, setOcupado] = useState(false)
  const [real, setReal] = useState(false)
  const modo = d.empresa.modo
  const empezar = () => {
    setOcupado(true); setAviso(null)
    void cambiarModo(companyId, 'pruebas', null, null, quien)
      .then(() => { setAviso({ ok: true, texto: 'En pruebas: tus próximas facturas llegan al entorno de pruebas de Hacienda, con la marca «PRUEBA». No cuentan.' }); alCambiar() })
      .catch((e) => setAviso({ ok: false, texto: msg(e) }))
      .finally(() => setOcupado(false))
  }
  return (
    <Paso n={3} estado={modo === 'real' ? 'hecho' : modo === 'pruebas' ? 'ahora' : 'luego'} titulo="Prueba y pasa a real">
      {modo === 'real'
        ? <p className="s-aviso-lista" data-tono="ok" data-prueba="en-real">En real desde el {fecha(d.empresa.realDesde)}, con la serie {d.empresa.realSerie}. Como manda la ley, sigue así hasta el {fecha(d.empresa.realObligaHasta)}.</p>
        : <p className="s-apoyo">Emite una factura de prueba: verás exactamente cómo llega. Cuando quieras, pasas a real escribiendo <strong>EMPEZAR</strong>. Desde ese momento no se puede volver a pruebas, como manda la ley.</p>}
      {modo === 'apagado' && (
        <>
          {!d.pruebasProbada && <p className="s-aviso-lista" data-tono="duda" data-prueba="candado-pruebas">Todavía no se ha probado la conexión con el entorno de pruebas de Hacienda: hasta que salga bien, Verifactu no se puede poner en pruebas.</p>}
          <Boton variante="principal" disabled={!d.pruebasProbada || ocupado} onClick={empezar}>{ocupado ? 'Empezando…' : 'Empezar las pruebas'}</Boton>
        </>
      )}
      {modo === 'pruebas' && (
        <>
          {!d.realProbada && <p className="s-aviso-lista" data-tono="duda" data-prueba="candado-real">Todavía no se ha probado la conexión con Hacienda con el certificado de esta empresa: hasta que salga bien, Verifactu no se puede pasar a real.</p>}
          <Boton variante="principal" disabled={!d.realProbada} onClick={() => setReal(true)}>Pasar a real</Boton>
        </>
      )}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'} role="status">{aviso.texto}</p>}
      {real && (
        <DialogoReal alCerrar={() => setReal(false)} alPasar={async (serie, palabra) => {
          try {
            const r = await cambiarModo(companyId, 'real', serie, palabra, quien)
            setReal(false)
            setAviso({ ok: true, texto: `En real: desde ahora cada factura llega a Hacienda y cuenta. Las nuevas van en la serie ${r.real_serie ?? serie}.` })
            alCambiar()
            return null
          } catch (e) { return msg(e) }
        }} />
      )}
    </Paso>
  )
}

function DialogoReal({ alCerrar, alPasar }: { alCerrar: () => void; alPasar: (serie: string, palabra: string) => Promise<string | null> }) {
  const anio = new Date().getFullYear()
  const [serie, setSerie] = useState(`F${anio}`)
  const [palabra, setPalabra] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  return (
    <Dialogo titulo="Pasar a real" alCerrar={alCerrar}
      explicacion={`Desde ahora cada factura llega a Hacienda y cuenta. No se puede volver a pruebas hasta el 31/12/${anio}: lo manda la ley. Las facturas nuevas van en una serie nueva.`}
      acciones={<>
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="principal" disabled={palabra.trim() !== 'EMPEZAR' || !serie.trim() || ocupado}
          onClick={() => { setOcupado(true); void alPasar(serie.trim().toUpperCase(), palabra.trim()).then((e) => { setFallo(e); setOcupado(false) }) }}>{ocupado ? 'Pasando…' : 'Pasar a real'}</Boton>
      </>}>
      <Campo etiqueta="La serie nueva" ayuda="En mayúsculas y cifras: se crea si no existe.">{(p) => <Texto {...p} valor={serie} alCambiar={(v) => setSerie(v.toUpperCase())} maxLength={10} />}</Campo>
      <Campo etiqueta="Escribe EMPEZAR">{(p) => <Texto {...p} valor={palabra} alCambiar={setPalabra} maxLength={10} />}</Campo>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
    </Dialogo>
  )
}

function OtrosProgramas({ d, companyId, quien, alCambiar }: { d: DatosVerifactu; companyId: string; quien: string | null; alCambiar: () => void }) {
  const guardados = d.empresa.otrosProgramas
  const [con, setCon] = useState<'solo' | 'otros' | null>(guardados === null ? null : guardados.length ? 'otros' : 'solo')
  const [elegidos, setElegidos] = useState<string[]>(guardados ?? [])
  const [aviso, setAviso] = useState<Aviso>(null)
  const [ocupado, setOcupado] = useState(false)
  const lista = con === 'otros' ? elegidos : []
  const avisoPrograma = avisoOtrosProgramas(lista)
  const cambiado = guardados === null ? con !== null : (con === 'solo' ? guardados.length > 0 : [...lista].sort().join() !== [...guardados].sort().join())
  return (
    <section className="cxvf-otros" aria-label="¿Facturas también con otro programa?" data-prueba="otros-programas">
      <h2 className="cxvf-paso-titulo">¿Facturas también con otro programa?</h2>
      <p className="s-apoyo">Un TPV, una tienda online, Excel… Desde el {OBLIGA_VERIFACTU.texto} cada factura de tu empresa sale de un programa que cumpla, no solo las de Sumied.</p>
      <div role="radiogroup" aria-label="¿Facturas también con otro programa?" className="cxvf-otros-opciones">
        <label><input type="radio" name="otros-programas" checked={con === 'solo'} onChange={() => setCon('solo')} /> No, solo con Sumied</label>
        <label><input type="radio" name="otros-programas" checked={con === 'otros'} onChange={() => setCon('otros')} /> Sí, también con…</label>
      </div>
      {con === 'otros' && (
        <div className="cxvf-otros-lista">
          {OTROS_PROGRAMAS.map((o) => (
            <label key={o.id}>
              <input type="checkbox" checked={elegidos.includes(o.id)} onChange={(e) => setElegidos((xs) => (e.target.checked ? [...xs, o.id] : xs.filter((x) => x !== o.id)))} /> {o.nombre}
            </label>
          ))}
        </div>
      )}
      {avisoPrograma && <p className="s-aviso-lista" data-tono={avisoPrograma.tono} data-prueba="aviso-otros-programas">{avisoPrograma.texto}</p>}
      <Boton variante="secundario" disabled={!cambiado || con === null || (con === 'otros' && lista.length === 0) || ocupado} onClick={() => {
        setOcupado(true); setAviso(null)
        void guardarOtrosProgramas(companyId, lista, quien)
          .then(() => { setAviso({ ok: true, texto: lista.length ? `Guardado: también facturas con ${lista.map((x) => OTROS_PROGRAMAS.find((o) => o.id === x)?.nombre.toLowerCase()).join(', ')}.` : 'Guardado: solo facturas con Sumied.' }); alCambiar() })
          .catch((e) => setAviso({ ok: false, texto: msg(e) }))
          .finally(() => setOcupado(false))
      }}>{ocupado ? 'Guardando…' : 'Guardar'}</Boton>
      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'} role="status">{aviso.texto}</p>}
    </section>
  )
}

function LoQueHaceSumied() {
  const [declaracion, setDeclaracion] = useState(false)
  return (
    <aside className="cxvf-lado">
      <Tarjeta titulo="Lo que hace Sumied por ti">
        <ul className="cxvf-hace">
          <li>Comprueba cada factura antes de emitirla, con las mismas reglas que Hacienda</li>
          <li>La envía en el momento y te dice si ha llegado</li>
          <li>Si no hay conexión, la guarda y la reenvía sola</li>
          <li>Pone el código QR y «VERI*FACTU» en el PDF</li>
          <li>Si te equivocas, te lleva por el camino correcto: rectificar, anular o corregir</li>
        </ul>
        <p className="s-tarjeta-apoyo">Sumied cumple el reglamento de sistemas de facturación. <Boton variante="enlace" onClick={() => setDeclaracion(true)}>Ver la declaración responsable</Boton></p>
      </Tarjeta>
      {declaracion && (
        <Dialogo titulo="Declaración responsable" alCerrar={() => setDeclaracion(false)}
          acciones={<Boton variante="principal" onClick={() => setDeclaracion(false)}>Cerrar</Boton>}>
          {/* El texto lo pone Julio (encargo V03 E2): este es su sitio. */}
          <p className="s-apoyo" data-prueba="declaracion-pendiente">El texto de la declaración responsable del sistema (art. 13 del RD 1007/2023) lo publica el productor de Sumied antes de pasar a real. Aún no está.</p>
        </Dialogo>
      )}
    </aside>
  )
}
