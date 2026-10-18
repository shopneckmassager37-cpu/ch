const SUPABASE_URL = 'https://gubckjmffliwukroluxm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1YmNram1mZmxpd3Vrcm9sdXhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NDA4NDYsImV4cCI6MjA5MzExNjg0Nn0.qDuyWCltbNlIPsDdX8tUzZMF1VJgPXipH9wageTqTQw';

// ── Public reads go straight to Supabase with the anon key (read-only, RLS-protected). ──
async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || '',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Writes go through authenticated server endpoints (service-role key, never exposed to the browser). ──
async function adminFetch(path, options = {}) {
  const token = sessionStorage.getItem('admin_token') || '';
  const res = await fetch(`/api/admin/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

async function getCategories() {
  return sbFetch('categories?select=*&order=order.asc');
}

async function getProducts() {
  return sbFetch('products?select=*&order=order.asc');
}

async function getAllergens() {
  return sbFetch('allergens?select=*&order=sort_order.asc');
}

async function getDeliveryZones() {
  return sbFetch('delivery_zones?select=*&order=zone_num.asc');
}

async function updateDeliveryZone(zoneNum, data) {
  return adminFetch('delivery-zones', { method: 'PATCH', body: JSON.stringify({ zone_num: zoneNum, ...data }) });
}

async function updateProduct(id, data) {
  return adminFetch('products', { method: 'PATCH', body: JSON.stringify({ id, ...data }) });
}

async function createProduct(data) {
  return adminFetch('products', { method: 'POST', body: JSON.stringify(data) });
}

async function deleteProduct(id) {
  return adminFetch('products', { method: 'DELETE', body: JSON.stringify({ id }) });
}

async function updateCategory(id, data) {
  return adminFetch('categories', { method: 'PATCH', body: JSON.stringify({ id, ...data }) });
}

async function createCategory(data) {
  return adminFetch('categories', { method: 'POST', body: JSON.stringify(data) });
}

async function updateAllergen(id, data) {
  return adminFetch('allergens', { method: 'PATCH', body: JSON.stringify({ id, ...data }) });
}

async function createAllergen(data) {
  return adminFetch('allergens', { method: 'POST', body: JSON.stringify(data) });
}

async function deleteAllergen(id) {
  return adminFetch('allergens', { method: 'DELETE', body: JSON.stringify({ id }) });
}

async function getOrders() {
  return adminFetch('orders');
}

async function updateOrder(id, data) {
  return adminFetch('orders', { method: 'PATCH', body: JSON.stringify({ id, ...data }) });
}

async function deleteOrder(id) {
  return adminFetch('orders', { method: 'DELETE', body: JSON.stringify({ id }) });
}

async function getAnalytics(days) {
  return adminFetch(`analytics?days=${encodeURIComponent(days)}`);
}

async function uploadImage(file) {
  const dataBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const { url } = await adminFetch('upload', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, contentType: file.type, dataBase64 })
  });
  return url;
}
