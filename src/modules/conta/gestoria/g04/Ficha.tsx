// src/modules/conta/gestoria/g04/Ficha.tsx
//
// G04 · Tarea 4 · La ficha completa de un cliente, fiel a la maqueta aprobada
// por Julio el 08/11 (tablero Ficha): la cabecera con sus botones, cuatro
// cifras, el aviso de «Pendiente de revisar» con sus dos botones de decisión,
// las pestañas Este mes · Cobros · Contacto · Datos del CRM y, a la derecha,
// «Servicios que tiene» y «Trabajos sueltos sin cobrar». Solo pinta: recibe el
// modelo (modelo.ts · modeloFicha) y lo que hacer al pulsar. Cada acción
// confirma con su frase o dice por qué no (regla 8).

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ModeloFicha } from './modelo'
import { OtraVia } from './Clientes'
import { proponerServicio } from './propuestas'

export interface Persona { nombre: string; correos: string[]; telefonos: string[] }
export interface DatosDelCrm { situacion: string; formaPago: string | null; servicios: string | null; leido: string | null; referencias: string[]; direccion: string | null }

export interface AccionesFicha {
  cobradoPorOtraVia: (cargos: string[], via: 'transferencia' | 'efectivo', fecha: string) => Promise<string>
  altaTrabajador: (servicio: string, nombre: string, desde: string) => Promise<string>
  bajaTrabajador: (linea: string, mes: string) => Promise<string>
  lineaDesdeGc: (suscripcion: string, servicio: string, trabajador: string | null) => Promise<string>
  noContar: (suscripcion: string) => Promise<string>
  revisada: (diferencia: string) => Promise<string>
  anadir: (o: { servicio?: string | null; nivel?: string | null; paquete?: string | null }, desde: string, ensayo: boolean) => Promise<string>
  cambiarNivel: (linea: string, nivel: string, desde: string, ensayo: boolean) => Promise<string>
}

export interface PropsFicha {
  modelo: ModeloFicha
  crm: string
  datosCrm: DatosDelCrm
  personas: Persona[]
  rutaVolver: string
  rutaTarifa: string
  rutaCrm: string | null
  hoy: string
  /** Lo que se puede añadir o a qué nivel cambiar: servicios (con sus niveles) y paquetes de la empresa. */
  catalogo: { servicios: { id: string; nombre: string; clave: string; niveles: { id: string; nombre: string }[]; porTrabajador: boolean }[]; paquetes: { id: string; nombre: string }[] }
  acciones: AccionesFicha
  /** Abrir «+ Añadir» nada más entrar (desde «Ponerle la cuota»). */
  anadirAbierto?: boolean
}

const PESTANAS = ['Este mes', 'Cobros', 'Contacto', 'Datos del CRM'] as const
const iniciales = (nombre: string) => { const p = nombre.replace(/[,.]/g, '').split(/\s+/).filter(Boolean); return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() }
const mesSiguiente = (hoy: string) => { const a = Number(hoy.slice(0, 4)); const m = Number(hoy.slice(5, 7)); return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01` }

/** Un botón que hace algo y dice lo que ha pasado (regla 8). */
function useHacer() {
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [haciendo, setHaciendo] = useState(false)
  const hacer = async (f: () => Promise<string>) => {
    setHaciendo(true); setAviso(null)
    try { setAviso({ ok: true, texto: await f() }) } catch (e) { setAviso({ ok: false, texto: e instanceof Error ? e.message : String(e) }) } finally { setHaciendo(false) }
  }
  const texto: ReactNode = aviso ? <p className="g4-hecho" data-ok={aviso.ok ? '' : undefined} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p> : null
  return { hacer, haciendo, texto, limpiar: () => setAviso(null) }
}

export function Ficha(p: PropsFicha) {
  const { modelo: m } = p
  const f = m.fila
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>('Este mes')
  const [abiertos, setAbiertos] = useState<Record<number, boolean>>({})
  const [verTodos, setVerTodos] = useState<Record<number, boolean>>({})
  const [buscar, setBuscar] = useState<Record<number, string>>({})
  const [panel, setPanel] = useState<null | 'trabajador' | 'anadir' | { nivel: string }>(p.anadirAbierto ? 'anadir' : null)
  const [otraVia, setOtraVia] = useState(false)
  const [comoLinea, setComoLinea] = useState(false)
  const h = useHacer()
  const pendiente = m.pendientes[0] ?? null
  const desde = mesSiguiente(p.hoy)
  const nombresCrm = p.crm

  return (
    <div className="g4" data-pantalla="ficha-g04">
      <Link to={p.rutaVolver} className="g4-volver">← Clientes</Link>

      <header className="g4-cabecera" style={{ alignItems: 'center' }}>
        <div className="g4-cliente" style={{ gap: 16 }}>
          <div aria-hidden="true" className="g4-iniciales g4-iniciales-grande" data-c="0">{iniciales(f.nombre)}</div>
          <div className="g4-cliente-textos" style={{ gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 className="g4-titulo" style={{ fontSize: 30 }}>{f.nombre}</h1>
              <span className="g4-etiqueta" data-tono={f.situacionTono}>{f.situacionTexto}</span>
            </div>
            <div className="g4-panel-linea">
              {[f.nif ?? 'Sin NIF', f.figura].join(' · ')} · {f.empresa ? <>Le factura <b>{f.empresa}</b></> : 'Sin empresa que le facture'}{m.clienteDesde ? ` · ${m.clienteDesde}` : ''}
            </div>
          </div>
        </div>
        <div className="g4-cabecera-acciones">
          {p.rutaCrm && <a className="g4-boton" href={p.rutaCrm} target="_blank" rel="noreferrer">Ver en {nombresCrm} ↗</a>}
          <Link className="g4-boton" to={p.rutaTarifa}>Cambiar tarifa</Link>
          <button type="button" className="g4-boton" data-tipo="primario" onClick={() => { h.limpiar(); setPanel(panel === 'trabajador' ? null : 'trabajador') }}>Alta o baja de trabajador</button>
        </div>
      </header>

      {panel === 'trabajador' && <AltaTrabajador servicios={p.catalogo.servicios.filter((s) => s.porTrabajador)} desde={desde} alCerrar={() => setPanel(null)} h={h} alta={p.acciones.altaTrabajador} />}
      {h.texto}

      <section aria-label="El cliente en cifras" className="g4-cifras g4-cifras-ficha">
        <div className="g4-cifra"><div className="g4-cifra-titulo">Se le cobra al mes</div><div className="g4-cifra-valor">{f.esteMes.principalCent === null ? '—' : euros(f.esteMes.principalCent)}</div>
          {f.esteMes.alLado && <div className="g4-cifra-linea">En GoCardless · {f.esteMes.alLado}</div>}</div>
        <div className="g4-cifra"><div className="g4-cifra-titulo">Debe</div><div className="g4-cifra-valor" style={f.debeCent ? { color: '#A11B12' } : undefined}>{f.debeCent ? euros(f.debeCent) : '0 €'}</div></div>
        <div className="g4-cifra"><div className="g4-cifra-titulo">Último cobro</div><div className="g4-cifra-valor" data-sin-dato="" data-tono={f.ultimoCargo?.tono}>{f.ultimoCargo ? `${f.ultimoCargo.estado} · ${Number(f.ultimoCargo.fecha.slice(8, 10))}/${f.ultimoCargo.fecha.slice(5, 7)}` : 'Ninguno en GoCardless'}</div></div>
        <div className="g4-cifra" data-tono="aviso"><div className="g4-cifra-titulo">Precio revisado</div><div className="g4-cifra-valor" data-sin-dato="">Aún sin dato</div>
          <div className="g4-cifra-linea">Sumied guarda los cambios de precio desde el 07/11/2026</div></div>
      </section>

      {f.aviso?.accion === 'otra_via' ? (
        <div role="note" className="g4-nota">
          <div className="g4-nota-textos"><div className="g4-aviso-titulo">{f.aviso.titulo}</div><div className="g4-aviso-texto">{f.aviso.texto}</div></div>
          {otraVia ? <OtraVia cargos={f.devueltos} hoy={p.hoy} alGuardar={p.acciones.cobradoPorOtraVia} alCancelar={() => setOtraVia(false)} />
            : <div className="g4-aviso-botones"><button type="button" className="g4-aviso-boton" onClick={() => setOtraVia(true)}>Cobrado por otra vía</button></div>}
        </div>
      ) : pendiente ? (
        <div role="note" className="g4-nota">
          <div className="g4-nota-textos"><div className="g4-aviso-titulo">Por revisar</div><div className="g4-aviso-texto">{pendiente.porque}</div></div>
          <div className="g4-aviso-botones">
            {m.sinLinea[0] && (pendiente.tipo === 'totales_distintos' || pendiente.tipo === 'suscripcion_sin_convertir') ? <>
              {comoLinea
                ? <ComoLinea suscripciones={m.sinLinea} servicios={p.catalogo.servicios} h={h} alCerrar={() => setComoLinea(false)} anadir={p.acciones.lineaDesdeGc} />
                : <>
                  <button type="button" className="g4-aviso-boton" onClick={() => { h.limpiar(); setComoLinea(true) }}>Añadirla como línea</button>
                  <button type="button" className="g4-aviso-boton" data-tipo="sec" disabled={h.haciendo} onClick={() => void h.hacer(() => p.acciones.noContar(m.sinLinea[0].id))}>Es una baja: no la cuentes</button>
                </>}
            </> : <>
              <button type="button" className="g4-aviso-boton" disabled={h.haciendo} onClick={() => void h.hacer(() => p.acciones.revisada(pendiente.id))}>Ya lo he revisado</button>
              {p.rutaCrm && <a className="g4-aviso-boton" data-tipo="sec" href={p.rutaCrm} target="_blank" rel="noreferrer">Corregirlo en {nombresCrm} ↗</a>}
            </>}
          </div>
        </div>
      ) : null}

      <div role="tablist" aria-label="Partes de la ficha" className="g4-pestanas-ficha">
        {PESTANAS.map((t) => <button key={t} type="button" role="tab" aria-selected={pestana === t} onClick={() => setPestana(t)}>{t === 'Datos del CRM' ? `Datos de ${nombresCrm}` : t}</button>)}
      </div>

      <div className="g4-ficha-cuerpo">
        <div className="g4-ficha-principal">
          {pestana === 'Este mes' && (
            <section aria-labelledby="g4-recibo" className="g4-bloque g4-sin-relleno">
              <div className="g4-recibo-cabeza">
                <div><div className="g4-antetitulo">Así le llegará el recibo de {m.mesRecibo.replace(/ de \d+$/, '')}</div><h2 id="g4-recibo" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Recibo de {m.mesRecibo}</h2></div>
                <div className="g4-pequeno" style={{ fontSize: 13 }}>Lo calcula Sumied con su tarifa · hasta el G05, cobra GoCardless</div>
              </div>
              <div className="g4-recibo">
                {m.recibo.length === 0 && <div className="g4-recibo-linea"><span>Nada en Sumied el mes que viene.</span><b>—</b></div>}
                {m.recibo.map((l, i) => {
                  const visibles = l.trabajadores.filter((t) => !buscar[i] || t.nombre.toLowerCase().includes(buscar[i].toLowerCase()))
                  const enLista = verTodos[i] ? visibles : visibles.slice(0, 6)
                  return (
                    <div key={l.texto} className="g4-recibo-linea" data-trabajadores={l.trabajadores.length ? '' : undefined}>
                      <div className="g4-recibo-fila">
                        <div className="g4-cliente-textos"><div className="g4-recibo-texto">{l.texto}</div><div className="g4-pequeno" style={{ fontSize: 13 }}>{l.detalle}</div></div>
                        <div className="g4-recibo-derecha">
                          <div className="g4-recibo-importe">{l.importe}</div>
                          {l.trabajadores.length > 0 && <button type="button" className="g4-boton g4-boton-pequeno" aria-expanded={!!abiertos[i]} onClick={() => setAbiertos({ ...abiertos, [i]: !abiertos[i] })}>{abiertos[i] ? 'Ocultar trabajadores' : 'Ver trabajadores'}</button>}
                        </div>
                      </div>
                      {l.etiquetas.length > 0 && <div className="g4-etiquetas">{l.etiquetas.map((e) => <span key={e} className="g4-etiqueta" data-tono={e.startsWith('Alta') ? 'bien' : 'mal'}>{e}</span>)}</div>}
                      {abiertos[i] && (
                        <div className="g4-trabajadores">
                          {l.trabajadores.length > 12 && <label className="g4-buscador" style={{ minWidth: 0 }}><input aria-label="Buscar trabajador" placeholder="Buscar trabajador" value={buscar[i] ?? ''} onChange={(e) => setBuscar({ ...buscar, [i]: e.target.value })} /></label>}
                          {enLista.map((t) => (
                            <div key={t.nombre} className="g4-trabajador">
                              <div className="g4-cliente-textos"><div style={{ fontSize: 14, fontWeight: 500 }}>{t.nombre}</div><div className="g4-pequeno">{t.desde}</div></div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                {t.importe && <div style={{ fontSize: 14 }}>{t.importe}</div>}
                                {t.lineaId && <button type="button" className="g4-enlace" disabled={h.haciendo} onClick={() => void h.hacer(() => p.acciones.bajaTrabajador(t.lineaId!, p.hoy.slice(0, 7) + '-01'))}>Dar de baja</button>}
                              </div>
                            </div>
                          ))}
                          <div className="g4-pie" style={{ padding: '8px 0 0' }}>
                            <span>Se ven {enLista.length} de {l.trabajadores.length}</span>
                            {visibles.length > 6 && <button type="button" className="g4-enlace" onClick={() => setVerTodos({ ...verTodos, [i]: !verTodos[i] })}>{verTodos[i] ? 'Ver menos' : `Ver los ${visibles.length} →`}</button>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                <div className="g4-recibo-total"><div style={{ fontSize: 15, fontWeight: 600 }}>Total</div><div className="g4-banda-cifra" style={{ color: 'inherit' }}>{m.totalRecibo}</div></div>
                <div className="g4-pequeno" style={{ paddingBottom: 18 }}>Cuando Sumied facture (G05), en la factura saldrá cada trabajador con su nombre, en una hoja aparte.</div>
              </div>
            </section>
          )}

          {pestana === 'Cobros' && (
            <section aria-labelledby="g4-cobros" className="g4-bloque">
              <div className="g4-bloque-cabecera">
                <h2 id="g4-cobros" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Cobros de los últimos 12 meses</h2>
                <div className="g4-pequeno" style={{ fontSize: 13 }}>
                  {m.mandato ? <>Domiciliación · mandato SEPA <b style={{ color: m.mandato.tono === 'bien' ? '#0B6B4F' : '#8A4B08' }}>{m.mandato.texto}</b></> : 'Sin mandato en GoCardless'} · {m.devoluciones12} {m.devoluciones12 === 1 ? 'devolución' : 'devoluciones'} en 12 meses
                </div>
              </div>
              <div className="g4-pequeno">Lo leído de GoCardless (desde mayo de 2026). Sumied aún no factura: la factura llega con el recibo (G05).</div>
              <div className="g4-tabla-cobros" role="table" aria-label="Cobros de los últimos 12 meses">
                <div className="g4-cobro-fila g4-cobro-titulos" role="row"><div role="columnheader">Recibo</div><div role="columnheader" className="g4-derecha">Importe</div><div role="columnheader">Estado</div><div role="columnheader">Factura</div></div>
                {m.cobros.length === 0 && <div className="g4-cobro-fila" role="row"><div role="cell">Ningún cobro en GoCardless en 12 meses.</div></div>}
                {m.cobros.map((c, i) => (
                  <div key={`${c.fecha}-${i}`} className="g4-cobro-fila" role="row"><div role="cell">{c.fecha}</div><div role="cell" className="g4-derecha" style={{ fontWeight: 600 }}>{c.importe}</div>
                    <div role="cell"><span className="g4-etiqueta" data-tono={c.tono}>{c.estado}</span></div><div role="cell" className="g4-pequeno">Sin factura en Sumied</div></div>
                ))}
              </div>
            </section>
          )}

          {pestana === 'Contacto' && (
            <section aria-labelledby="g4-contacto" className="g4-bloque">
              <h2 id="g4-contacto" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Contacto</h2>
              <div className="g4-datos">
                <div><div className="g4-dato-titulo">Teléfono</div><div className="g4-dato">{f.telefono ?? '—'}</div></div>
                <div><div className="g4-dato-titulo">Email</div><div className="g4-dato">{f.correo ?? '—'}</div></div>
                <div><div className="g4-dato-titulo">Dirección fiscal</div><div className="g4-dato">{p.datosCrm.direccion ?? '—'}</div></div>
              </div>
              <h3 className="g4-seccion-titulo">Personas de contacto</h3>
              {p.personas.length === 0 && <div className="g4-pequeno" style={{ fontSize: 14 }}>Ninguna en {nombresCrm}.</div>}
              {p.personas.map((x) => <div key={x.nombre} className="g4-renglon"><b>{x.nombre}</b><span className="g4-pequeno" style={{ fontSize: 14 }}>{[...x.telefonos, ...x.correos].join(' · ') || '—'}</span></div>)}
            </section>
          )}

          {pestana === 'Datos del CRM' && (
            <section aria-labelledby="g4-crm" className="g4-bloque">
              <h2 id="g4-crm" className="g4-bloque-titulo" style={{ fontSize: 20 }}>Datos de {nombresCrm}</h2>
              <div className="g4-datos">
                <div><div className="g4-dato-titulo">Situación</div><div className="g4-dato">{p.datosCrm.situacion}</div></div>
                <div><div className="g4-dato-titulo">Forma de pago</div><div className="g4-dato">{p.datosCrm.formaPago ?? '—'}</div></div>
                <div><div className="g4-dato-titulo">Servicios</div><div className="g4-dato">{p.datosCrm.servicios ?? '—'}</div></div>
                <div><div className="g4-dato-titulo">Leído</div><div className="g4-dato">{p.datosCrm.leido ?? '—'}</div></div>
              </div>
              {p.datosCrm.referencias.length > 0 && <>
                <h3 className="g4-seccion-titulo">Importes de referencia en {nombresCrm}</h3>
                {p.datosCrm.referencias.map((r) => <div key={r} className="g4-renglon"><span>{r}</span></div>)}
                <div className="g4-pequeno">Solo de referencia: Sumied no los suma ni cobra con ellos.</div>
              </>}
              <div className="g4-pequeno" style={{ fontSize: 13 }}>Sumied solo lee esta ficha. Para cambiarla, cámbiala en {nombresCrm} y se verá aquí en la próxima lectura.</div>
            </section>
          )}
        </div>

        <aside className="g4-ficha-lado">
          <section aria-labelledby="g4-tiene" className="g4-bloque g4-bloque-lado">
            <div className="g4-bloque-cabecera"><h2 id="g4-tiene" className="g4-bloque-titulo" style={{ fontSize: 16 }}>Servicios que tiene</h2>
              <button type="button" className="g4-enlace" onClick={() => { h.limpiar(); setPanel(panel === 'anadir' ? null : 'anadir') }}>+ Añadir</button></div>
            {panel === 'anadir' && <Anadir catalogo={p.catalogo} desde={desde} h={h} alCerrar={() => setPanel(null)} anadir={p.acciones.anadir} />}
            {m.servicios.length === 0 && <div className="g4-pequeno" style={{ fontSize: 14 }}>Ninguno en Sumied.</div>}
            {m.servicios.map((s) => (
              <div key={`${s.texto}-${s.lineaId}`} className="g4-renglon">
                <span className="g4-cliente-textos"><b>{s.texto}</b>
                  <span className="g4-pequeno" style={s.especial ? { color: '#1747AE', fontWeight: 600 } : undefined}>{s.detalle}
                    {s.tieneNiveles && s.lineaId && <> · <button type="button" className="g4-enlace g4-enlace-linea" onClick={() => { h.limpiar(); setPanel({ nivel: s.lineaId! }) }}>Cambiar de nivel</button></>}</span>
                  {typeof panel === 'object' && panel?.nivel === s.lineaId && (
                    <CambiarNivel niveles={p.catalogo.servicios.find((x) => x.id === s.servicioId)?.niveles ?? []} desde={desde} h={h} alCerrar={() => setPanel(null)}
                      cambiar={(nivel, d, ensayo) => p.acciones.cambiarNivel(s.lineaId!, nivel, d, ensayo)} />
                  )}
                </span>
                <b>{s.importe}</b>
              </div>
            ))}
          </section>
          <section className="g4-bloque g4-bloque-lado">
            <h2 className="g4-bloque-titulo" style={{ fontSize: 16 }}>Trabajos sueltos sin cobrar</h2>
            {m.sueltos.length === 0 ? <div className="g4-pequeno" style={{ fontSize: 14 }}>Ninguno.</div>
              : m.sueltos.map((x) => <div key={x.texto} className="g4-renglon"><span>{x.texto}</span><b>{x.importe}</b></div>)}
          </section>
        </aside>
      </div>
    </div>
  )
}

function euros(cent: number): string {
  // eslint-disable-next-line no-restricted-syntax -- «cent» es siempre un entero (céntimos)
  const s = (Math.abs(cent) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cent < 0 ? '−' : ''}${s} €`
}

type Hacer = ReturnType<typeof useHacer>

function AltaTrabajador({ servicios, desde, alCerrar, h, alta }: { servicios: { id: string; nombre: string }[]; desde: string; alCerrar: () => void; h: Hacer
  alta: (servicio: string, nombre: string, desde: string) => Promise<string> }) {
  const [servicio, setServicio] = useState(servicios[0]?.id ?? '')
  const [nombre, setNombre] = useState('')
  const [mes, setMes] = useState(desde.slice(0, 7))
  if (!servicios.length) return <p className="g4-hecho" role="status">Este cliente no tiene ningún servicio que se cobre por trabajador. Las bajas, en «Ver trabajadores» de cada línea.</p>
  return (
    <form className="g4-formulario" onSubmit={(e) => { e.preventDefault(); void h.hacer(() => alta(servicio, nombre.trim(), `${mes}-01`)) }}>
      <div className="g4-aviso-titulo" style={{ color: 'inherit' }}>Alta de un trabajador</div>
      <div className="g4-otra-via-fila">
        <label className="g4-campo g4-campo-azul">Servicio<select value={servicio} onChange={(e) => setServicio(e.target.value)}>{servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
        <label className="g4-campo g4-campo-azul">Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></label>
        <label className="g4-campo g4-campo-azul">Desde<input type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></label>
      </div>
      <div className="g4-pequeno">Las bajas, en «Ver trabajadores» de cada línea, con «Dar de baja».</div>
      <div className="g4-aviso-botones"><button type="submit" className="g4-boton" data-tipo="primario" disabled={h.haciendo || !nombre.trim()}>Dar de alta</button><button type="button" className="g4-boton" onClick={alCerrar}>Cerrar</button></div>
    </form>
  )
}

function Anadir({ catalogo, desde, h, alCerrar, anadir }: { catalogo: PropsFicha['catalogo']; desde: string; h: Hacer; alCerrar: () => void
  anadir: (o: { servicio?: string | null; nivel?: string | null; paquete?: string | null }, desde: string, ensayo: boolean) => Promise<string> }) {
  const opciones = [
    ...catalogo.servicios.flatMap((s) => (s.niveles.length ? s.niveles.map((n) => ({ id: `n:${n.id}`, texto: `${s.nombre} · ${n.nombre}`, o: { servicio: s.id, nivel: n.id } })) : [{ id: `s:${s.id}`, texto: s.nombre, o: { servicio: s.id } }])),
    ...catalogo.paquetes.map((x) => ({ id: `p:${x.id}`, texto: `Paquete · ${x.nombre}`, o: { paquete: x.id } })),
  ]
  const [elegido, setElegido] = useState(opciones[0]?.id ?? '')
  const [mes, setMes] = useState(desde.slice(0, 7))
  const [ensayado, setEnsayado] = useState(false)
  const o = opciones.find((x) => x.id === elegido)?.o ?? {}
  return (
    <form className="g4-formulario" onSubmit={(e) => { e.preventDefault(); void h.hacer(() => anadir(o, `${mes}-01`, !ensayado)).then(() => setEnsayado(true)) }}>
      <label className="g4-campo g4-campo-azul">Qué<select value={elegido} onChange={(e) => { setElegido(e.target.value); setEnsayado(false) }}>{opciones.map((x) => <option key={x.id} value={x.id}>{x.texto}</option>)}</select></label>
      <label className="g4-campo g4-campo-azul">Desde<input type="month" value={mes} onChange={(e) => { setMes(e.target.value); setEnsayado(false) }} /></label>
      <div className="g4-pequeno">A precio de tarifa. Un precio especial se pone en «Tarifa y paquetes».</div>
      <div className="g4-aviso-botones">
        <button type="submit" className="g4-boton" data-tipo="primario" disabled={h.haciendo || !elegido}>{ensayado ? 'Añadirlo' : 'Ver qué hará'}</button>
        <button type="button" className="g4-boton" onClick={alCerrar}>Cerrar</button>
      </div>
    </form>
  )
}

function CambiarNivel({ niveles, desde, h, alCerrar, cambiar }: { niveles: { id: string; nombre: string }[]; desde: string; h: Hacer; alCerrar: () => void
  cambiar: (nivel: string, desde: string, ensayo: boolean) => Promise<string> }) {
  const [nivel, setNivel] = useState(niveles[0]?.id ?? '')
  const [mes, setMes] = useState(desde.slice(0, 7))
  const [ensayado, setEnsayado] = useState(false)
  return (
    <form className="g4-formulario" onSubmit={(e) => { e.preventDefault(); void h.hacer(() => cambiar(nivel, `${mes}-01`, !ensayado)).then(() => setEnsayado(true)) }}>
      <label className="g4-campo g4-campo-azul">Nivel<select value={nivel} onChange={(e) => { setNivel(e.target.value); setEnsayado(false) }}>{niveles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}</select></label>
      <label className="g4-campo g4-campo-azul">Desde<input type="month" value={mes} onChange={(e) => { setMes(e.target.value); setEnsayado(false) }} /></label>
      <div className="g4-aviso-botones">
        <button type="submit" className="g4-boton" data-tipo="primario" disabled={h.haciendo || !nivel}>{ensayado ? 'Cambiarlo' : 'Ver qué hará'}</button>
        <button type="button" className="g4-boton" onClick={alCerrar}>Cerrar</button>
      </div>
    </form>
  )
}

/** «Añadirla como línea»: la suscripción, el servicio propuesto (se puede elegir otro) y su trabajador; confirma una persona. */
function ComoLinea({ suscripciones, servicios, h, alCerrar, anadir }: {
  suscripciones: { id: string; nombre: string; alMes: string }[]; servicios: PropsFicha['catalogo']['servicios']; h: Hacer; alCerrar: () => void
  anadir: (suscripcion: string, servicio: string, trabajador: string | null) => Promise<string>
}) {
  const [sus, setSus] = useState(suscripciones[0]?.id ?? '')
  const propuesta = (id: string) => proponerServicio(suscripciones.find((x) => x.id === id)?.nombre ?? '', servicios)
  const [servicio, setServicio] = useState(propuesta(sus).servicioId ?? '')
  const [trabajador, setTrabajador] = useState(propuesta(sus).trabajador ?? '')
  const elegido = servicios.find((x) => x.id === servicio)
  const cambiarSus = (id: string) => { setSus(id); const pr = propuesta(id); setServicio(pr.servicioId ?? ''); setTrabajador(pr.trabajador ?? '') }
  return (
    <form className="g4-otra-via" onSubmit={(e) => { e.preventDefault(); void h.hacer(() => anadir(sus, servicio, elegido?.porTrabajador ? trabajador.trim() : null)) }}>
      {suscripciones.length > 1 && <label className="g4-campo">Suscripción de GoCardless<select value={sus} onChange={(e) => cambiarSus(e.target.value)}>
        {suscripciones.map((x) => <option key={x.id} value={x.id}>{`${x.nombre} · ${x.alMes}`}</option>)}</select></label>}
      {suscripciones.length === 1 && <div className="g4-aviso-texto">{`${suscripciones[0].nombre} · ${suscripciones[0].alMes} al mes`}</div>}
      <div className="g4-otra-via-fila">
        <label className="g4-campo">Servicio{propuesta(sus).servicioId === servicio && servicio ? ' (propuesto)' : ''}
          <select value={servicio} onChange={(e) => setServicio(e.target.value)}>
            <option value="">Elige un servicio</option>
            {servicios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select></label>
        {elegido?.porTrabajador && <label className="g4-campo">Trabajador<input value={trabajador} onChange={(e) => setTrabajador(e.target.value)} required /></label>}
      </div>
      <div className="g4-aviso-botones">
        <button type="submit" className="g4-aviso-boton" disabled={h.haciendo || !servicio || (!!elegido?.porTrabajador && !trabajador.trim())}>Añadirla como línea</button>
        <button type="button" className="g4-aviso-boton" data-tipo="sec" onClick={alCerrar}>Cancelar</button>
      </div>
    </form>
  )
}
