const API_BASE = 'https://app.tspoonlab.com/recipes/api'

export interface TSpoonCenter { id: string; description: string; address?: string }
export interface TSpoonStore { id: string; name: string; products: TSpoonProduct[]; totalValue?: number }
export interface TSpoonProduct { id: string; name: string; category?: string; unit?: string; currentStock?: number; minStock?: number; idStore?: string; store?: string; price?: number }
export interface TSpoonDish { id: string; name: string; category?: string; allergens?: string[] }
export interface TSpoonData { products: TSpoonProduct[]; dishes: TSpoonDish[]; stores: TSpoonStore[]; lastSync: string; syncLog: { item: string; status: string; count: string }[] }

export async function login(email: string, password: string): Promise<{ token: string; centers: TSpoonCenter[] }> {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
  })
  if (!res.ok) throw new Error('Credenciales incorrectas')
  const token = (await res.text()).trim()
  if (!token || token.length < 5) throw new Error('Token inválido')
  const raw = await fetch(`${API_BASE}/listOrderCenters`, { headers: { rememberme: token } }).then(r => r.json()).catch(() => [])
  const centers = Array.isArray(raw) ? raw : raw?.results || []
  return { token, centers }
}

export async function syncData(token: string, centerId: string, onLog: (msg: string) => void): Promise<TSpoonData> {
  const log: TSpoonData['syncLog'] = []
  const headers = { rememberme: token, order: centerId }

  onLog('Descargando productos...')
  let products: TSpoonProduct[] = []
  try {
    const raw = await fetch(`${API_BASE}/ingredients`, { headers }).then(r => r.json()).catch(() => [])
    products = (Array.isArray(raw) ? raw : raw?.results || []).slice(0, 300)
    log.push({ item: 'Productos', status: 'ok', count: String(products.length) })
    onLog(`✓ ${products.length} productos`)
  } catch (e: unknown) { log.push({ item: 'Productos', status: 'error', count: String(e) }) }

  onLog('Descargando platos...')
  let dishes: TSpoonDish[] = []
  try {
    const raw = await fetch(`${API_BASE}/dishes`, { headers }).then(r => r.json()).catch(() => [])
    dishes = (Array.isArray(raw) ? raw : raw?.results || []).slice(0, 300)
    log.push({ item: 'Platos', status: 'ok', count: String(dishes.length) })
    onLog(`✓ ${dishes.length} platos`)
  } catch (e: unknown) { log.push({ item: 'Platos', status: 'error', count: String(e) }) }

  onLog('Descargando almacenes...')
  const storesMap: Record<string, TSpoonStore> = {}
  try {
    const sample = products.slice(0, 60)
    const details = await Promise.all(
      sample.map(p => fetch(`${API_BASE}/ingredient/${p.id}`, { headers: { rememberme: token } }).then(r => r.json()).catch(() => null))
    )
    details.filter(Boolean).forEach((d: TSpoonProduct) => {
      if (d.idStore && d.store) {
        if (!storesMap[d.idStore]) storesMap[d.idStore] = { id: d.idStore, name: d.store, products: [] }
        storesMap[d.idStore].products.push(d)
      }
    })
    log.push({ item: 'Almacenes', status: 'ok', count: String(Object.keys(storesMap).length) })
    onLog(`✓ ${Object.keys(storesMap).length} almacenes`)
  } catch (e: unknown) { log.push({ item: 'Almacenes', status: 'error', count: String(e) }) }

  return { products, dishes, stores: Object.values(storesMap), lastSync: new Date().toISOString(), syncLog: log }
}
