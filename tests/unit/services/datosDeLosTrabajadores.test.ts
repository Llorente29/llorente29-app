import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// L00 · Respuesta 1 (27/10/2026): cerrar los datos de los trabajadores.
// Lo que se prueba aquí es el front; lo que ve cada uno en la base lo prueba
// supabase/staging/sql/20261027_l00_datos_de_los_trabajadores_prueba.sql,
// entrando como el trabajador, el encargado y el administrador.

const rpc = vi.fn()
const createSignedUrl = vi.fn()
vi.mock('../../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => createSignedUrl(...a) }) },
  },
}))

const { conPinDeKiosko, comprobarPinDeKiosko, esFuncionQueNoExiste } = await import('../../../src/services/kioskoPinService')
const { getDocumentUrl, MINUTOS_ENLACE_DOCUMENTO } = await import('../../../src/services/documentsService')

const NO_EXISTE = { code: 'PGRST202', message: 'Could not find the function public.kiosko_con_pin(p_employee_ids) in the schema cache' }

beforeEach(() => { rpc.mockReset(); createSignedUrl.mockReset() })

describe('el PIN del kiosko se comprueba en el servidor', () => {
  it('con la 1215: pregunta al servidor quién tiene PIN, sin mirar la ficha', async () => {
    rpc.mockResolvedValue({ data: ['a'], error: null })
    const s = await conPinDeKiosko([{ id: 'a', pin: undefined }, { id: 'b', pin: '1234' }])
    expect(rpc).toHaveBeenCalledWith('kiosko_con_pin', { p_employee_ids: ['a', 'b'] })
    expect([...s]).toEqual(['a'])
  })

  it('con la 1215: el servidor dice si el PIN es el bueno', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await comprobarPinDeKiosko({ id: 'a', pin: undefined }, '4321')).toBe(true)
    expect(rpc).toHaveBeenCalledWith('kiosko_comprobar_pin', { p_employee_id: 'a', p_pin: '4321' })
    rpc.mockResolvedValue({ data: false, error: null })
    expect(await comprobarPinDeKiosko({ id: 'a', pin: undefined }, '0000')).toBe(false)
  })

  it('si el servidor falla por otra cosa, lo dice (no da el PIN por bueno)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'NO_AUTORIZADO' } })
    await expect(comprobarPinDeKiosko({ id: 'a', pin: '4321' }, '4321')).rejects.toThrow(/No se ha podido comprobar el PIN/)
  })

  it('con la base de antes (la función no existe): lo de antes, con el PIN de la ficha', async () => {
    expect(esFuncionQueNoExiste(NO_EXISTE)).toBe(true)
    expect(esFuncionQueNoExiste({ code: '42501', message: 'NO_AUTORIZADO' })).toBe(false)
    rpc.mockResolvedValue({ data: null, error: NO_EXISTE })
    expect([...(await conPinDeKiosko([{ id: 'a', pin: '1234' }, { id: 'b', pin: undefined }]))]).toEqual(['a'])
    expect(await comprobarPinDeKiosko({ id: 'a', pin: '1234' }, '1234')).toBe(true)
    expect(await comprobarPinDeKiosko({ id: 'a', pin: '1234' }, '9999')).toBe(false)
  })
})

describe('los PDF se abren con un enlace firmado de pocos minutos', () => {
  it('pide un enlace firmado de 5 minutos', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/firmado' }, error: null })
    expect(await getDocumentUrl('e1/n.pdf')).toBe('https://x/firmado')
    expect(createSignedUrl).toHaveBeenCalledWith('e1/n.pdf', 300)
    expect(MINUTOS_ENLACE_DOCUMENTO).toBe(5)
  })

  it('si Storage lo rechaza (no es tuyo), lo dice', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } })
    await expect(getDocumentUrl('otro/n.pdf')).rejects.toThrow(/No se ha podido abrir el documento/)
  })
})

describe('el front ya no deja nada abierto', () => {
  const leer = (f: string) => readFileSync(f, 'utf8')
  const ficheros = (d: string): string[] => readdirSync(d).flatMap(n => {
    const r = join(d, n)
    return statSync(r).isDirectory() ? ficheros(r) : /\.(ts|tsx)$/.test(n) ? [r] : []
  })

  it('ningún enlace público al almacén de los documentos de personal', () => {
    // El almacén se nombra por la constante BUCKET de documentsService: si
    // alguien vuelve a pedir un getPublicUrl ahí, o en cualquier fichero que
    // nombre el almacén, para.
    const conElAlmacen = ficheros('src').filter(f => leer(f).includes('employee-documents'))
    expect(conElAlmacen.length).toBeGreaterThan(0)
    for (const f of conElAlmacen) expect(leer(f), f).not.toMatch(/getPublicUrl/)
  })

  it('los compañeros llegan por la función de servidor, no leyendo su ficha entera', () => {
    const t = leer('src/services/supabaseSync.ts')
    const cuerpo = t.slice(t.indexOf('export async function fetchColleagues'), t.indexOf('export async function upsertEmployee'))
    expect(cuerpo).toContain("'companeros_de_trabajo'")
    expect(cuerpo).not.toMatch(/select\('\*'\)/)
  })

  it('nadie compara ya el PIN en el navegador (salvo con la base de antes)', () => {
    expect(leer('src/services/fichajeKiosko.ts')).not.toMatch(/export function checkPin/)
    expect(leer('src/pages/KioskoFichajePage.tsx')).not.toMatch(/\.pin\b/)
  })

  it('el trabajador no sube ni borra documentos desde su portal', () => {
    const t = leer('src/pages/trabajador/MisDocumentos.tsx')
    expect(t).not.toMatch(/uploadDocument|deleteDocument/)
  })
})
