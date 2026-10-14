const CART_KEY = 'chefaleh_cart';
const TAX_RATE = 0.07;
const MIN_ORDER_SUBTOTAL = 250;
const DELIVERY_DATE_KEY = 'chefaleh_delivery_date';

// Fridays with no delivery (holidays). Add more 'YYYY-MM-DD' entries as needed.
const CLOSED_FRIDAYS = [];
// Fridays that still deliver as normal but get a special label (e.g. holiday eve).
const FRIDAY_LABELS = {
  '2026-09-25': 'Erev Sukkot',
  '2026-10-02': 'Erev Chag',
};

// Cart contents render as HTML in the drawer — escape anything that came
// from user input (item names are admin-controlled, but instructions and
// allergen notes are typed by the customer).
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  refreshCartUI();
}

function summarizeFlavorsList(flavors) {
  if (!flavors || !flavors.length) return '';
  const counts = {};
  flavors.forEach(f => { counts[f] = (counts[f] || 0) + 1; });
  return Object.entries(counts).map(([f, c]) => c > 1 ? `${f} ×${c}` : f).join(', ');
}

function addItem(name, price, badge, instructions, glutenFree, avoidAllergens, flavors) {
  const cart = getCart();
  const found = cart.find(i => i.name === name);
  if (found) {
    found.qty++;
    if (instructions !== undefined) found.instructions = instructions;
    if (glutenFree !== undefined) found.glutenFree = glutenFree;
    if (avoidAllergens !== undefined) found.avoidAllergens = avoidAllergens;
    if (flavors !== undefined) found.flavors = (found.flavors || []).concat(flavors);
  } else {
    cart.push({ name, price: parseFloat(price), badge, qty: 1, instructions: instructions || '', glutenFree: !!glutenFree, avoidAllergens: avoidAllergens || [], flavors: flavors || [] });
  }
  saveCart(cart);
  if (typeof window.chefalehTrack === 'function') window.chefalehTrack('add_to_cart', name, parseFloat(price));
  showAddedToast(name);
}

// A quick, non-blocking confirmation instead of forcing the cart drawer open
// on every add — so browsing the menu and adding a few things isn't
// interrupted each time.
let addToastTimer = null;
function showAddedToast(name) {
  let el = document.getElementById('add-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'add-toast';
    const style = document.createElement('style');
    style.textContent = `
      #add-toast {
        position: fixed;
        top: 84px;
        left: 50%;
        z-index: 60;
        background: #1A1A1A;
        color: #D4AF37;
        padding: 12px 22px;
        border: 1px solid rgba(212,175,55,.4);
        font-family: 'Jost', sans-serif;
        font-size: 12px;
        letter-spacing: .08em;
        text-transform: uppercase;
        white-space: nowrap;
        max-width: calc(100vw - 32px);
        overflow: hidden;
        text-overflow: ellipsis;
        opacity: 0;
        pointer-events: none;
        transform: translate(-50%, -10px);
        transition: opacity .25s ease, transform .25s ease;
      }
      #add-toast.show { opacity: 1; transform: translate(-50%, 0); }
    `;
    document.head.appendChild(style);
    document.body.appendChild(el);
  }
  el.textContent = `✓ Added ${name} to cart`;
  el.classList.add('show');
  clearTimeout(addToastTimer);
  addToastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function setQty(name, qty) {
  let cart = getCart();
  qty = parseInt(qty);
  if (qty <= 0) cart = cart.filter(i => i.name !== name);
  else { const f = cart.find(i => i.name === name); if (f) f.qty = qty; }
  saveCart(cart);
}

function deck(name, delta, price, badge, instructions, glutenFree, avoidAllergens, flavor) {
  const cart = getCart();
  const found = cart.find(i => i.name === name);
  const newQty = found ? found.qty + delta : delta;
  if (newQty <= 0) {
    setQty(name, 0);
  } else if (found) {
    found.qty = newQty;
    if (instructions !== undefined) found.instructions = instructions;
    if (glutenFree !== undefined) found.glutenFree = glutenFree;
    if (avoidAllergens !== undefined) found.avoidAllergens = avoidAllergens;
    found.flavors = found.flavors || [];
    if (delta > 0 && flavor) found.flavors.push(flavor);
    else if (delta < 0) found.flavors = found.flavors.slice(0, newQty);
    saveCart(cart);
  } else {
    addItem(name, price, badge, instructions || '', glutenFree, avoidAllergens, flavor ? [flavor] : []);
  }
  if (typeof renderAll === 'function') renderAll();
}

function removeItem(name) {
  saveCart(getCart().filter(i => i.name !== name));
}

function getSubtotal() {
  return getCart().reduce((s, i) => s + i.price * i.qty, 0);
}

function getCount() {
  return getCart().reduce((s, i) => s + i.qty, 0);
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  refreshCartUI();
}

function fmt(n) { return '$' + n.toFixed(2); }

// ── DELIVERY DATE ──
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getUpcomingFridays() {
  const now = new Date();
  const miamiStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const miami = new Date(miamiStr);
  const day = miami.getDay(); // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat

  // Past deadline for THIS Friday? Orders close Wednesday at midnight Miami
  // time, so all of Thursday through Saturday is past deadline.
  const pastDeadline = day >= 4 && day <= 6;

  let firstFriday = new Date(miami);
  firstFriday.setHours(0, 0, 0, 0);
  if (pastDeadline) {
    const daysToNextFriday = (5 - day + 7) % 7 + (day >= 3 ? 7 : 0);
    firstFriday.setDate(miami.getDate() + daysToNextFriday);
  } else {
    const daysToFriday = (5 - day + 7) % 7;
    firstFriday.setDate(miami.getDate() + daysToFriday);
  }

  // Offer every Friday through the end of October (next year's once this
  // year's has passed), skipping any date listed in CLOSED_FRIDAYS.
  let rangeEnd = new Date(firstFriday.getFullYear(), 9, 31); // Oct 31, month index 9
  if (rangeEnd < firstFriday) rangeEnd = new Date(firstFriday.getFullYear() + 1, 9, 31);

  const fridays = [];
  const cursor = new Date(firstFriday);
  while (cursor <= rangeEnd) {
    if (!CLOSED_FRIDAYS.includes(toISODate(cursor))) fridays.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return fridays;
}

function formatFriday(d) {
  const base = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const label = FRIDAY_LABELS[toISODate(d)];
  return label ? `${base} (${label})` : base;
}

function getSelectedDeliveryDate() {
  const fridays = getUpcomingFridays();
  const iso = localStorage.getItem(DELIVERY_DATE_KEY);
  const match = iso && fridays.find(d => toISODate(d) === iso);
  return match || fridays[0];
}

function selectDrawerDate(iso) {
  localStorage.setItem(DELIVERY_DATE_KEY, iso);
  renderDrawerDateOptions();
}

function renderDrawerDateOptions() {
  const grid = document.getElementById('drawer-date-grid');
  const section = document.getElementById('drawer-date-section');
  if (!grid || !section) return;
  if (getCart().length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  const fridays = getUpcomingFridays();
  const selected = getSelectedDeliveryDate();
  localStorage.setItem(DELIVERY_DATE_KEY, toISODate(selected));

  grid.innerHTML = fridays.map(d => {
    const iso = toISODate(d);
    const active = iso === toISODate(selected);
    const short = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const label = FRIDAY_LABELS[iso];
    return `<div class="pick pick-date text-center${active ? ' active' : ''}" style="flex:0 0 60px" onclick="selectDrawerDate('${iso}')">
      <div class="pick-date-dow">Fri</div>
      <div class="pick-date-num">${short}</div>
      ${label ? `<div class="pick-date-tag">${label}</div>` : ''}
    </div>`;
  }).join('');
}

/* ── UI helpers ── */
function refreshCartUI() {
  // nav badge
  document.querySelectorAll('.cart-count-badge').forEach(el => {
    const c = getCount();
    el.textContent = c;
    el.style.display = c > 0 ? 'flex' : 'none';
  });
  // drawer if exists
  if (typeof renderDrawer === 'function') renderDrawer();
}

// ── DRAWER ──
function openDrawer() {
  const d = document.getElementById('drawer');
  const o = document.getElementById('drawer-overlay');
  if (d) d.classList.add('open');
  if (o) o.classList.remove('hidden');
  if (typeof window.chefalehTrack === 'function') window.chefalehTrack('cart_open');
  renderDrawer();
}

function closeDrawer() {
  const d = document.getElementById('drawer');
  const o = document.getElementById('drawer-overlay');
  if (d) d.classList.remove('open');
  if (o) o.classList.add('hidden');
}

function renderDrawer() {
  const cart = getCart();
  const sub = getSubtotal();
  const tax = sub * TAX_RATE;
  const tot = sub + tax;
  const el = document.getElementById('drawer-items');
  if (!el) return;
  
  if (cart.length === 0) {
    el.innerHTML = '<p class="text-charcoal/40 text-sm font-light text-center py-8">Your cart is empty.</p>';
  } else {
    el.innerHTML = cart.map(i => {
      const n = i.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const b = (i.badge || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `
      <div class="flex items-start gap-3 py-3 border-b border-charcoal/8">
        <div class="flex-1 min-w-0">
          <p class="text-sm text-charcoal font-light leading-snug">${escHtml(i.name)}</p>
          <p class="text-[11px] text-charcoal/40 font-light mt-0.5">${escHtml(i.badge)}</p>
          ${i.flavors && i.flavors.length ? `<p class="text-[10px] text-gold/70 font-light mt-0.5">Flavor: <strong class="font-medium">${escHtml(summarizeFlavorsList(i.flavors))}</strong></p>` : ''}
          ${i.instructions ? `<p class="text-[10px] text-gold/70 font-light mt-0.5 italic" style="white-space:pre-line">${escHtml(i.instructions)}</p>` : ''}
          ${i.glutenFree ? `<p class="text-[10px] font-medium mt-0.5" style="color:#6B8F5A">Gluten-free</p>` : ''}
          ${i.avoidAllergens && i.avoidAllergens.length ? `<p class="text-[10px] font-medium mt-0.5" style="color:#6B8F5A">Without: ${escHtml(i.avoidAllergens.join(', '))}</p>` : ''}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="deck('${n}',-1,${i.price},'${b}')" class="w-6 h-6 border border-charcoal/15 text-charcoal hover:bg-charcoal hover:text-cream transition-all text-xs leading-none">−</button>
          <span class="text-xs font-light w-4 text-center">${i.qty}</span>
          ${i.flavors && i.flavors.length
            ? `<a href="/menu" title="Add another on the Menu page to choose its flavor" class="w-6 h-6 border border-charcoal/15 text-charcoal/40 flex items-center justify-center text-xs leading-none">+</a>`
            : `<button onclick="deck('${n}',1,${i.price},'${b}')"  class="w-6 h-6 border border-charcoal/15 text-charcoal hover:bg-gold hover:text-charcoal transition-all text-xs leading-none">+</button>`}
        </div>
        <span class="text-sm font-light text-charcoal w-14 text-right shrink-0">$${(i.price*i.qty).toFixed(2)}</span>
      </div>`;
    }).join('');
  }
  
  const d = (id,v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  d('d-sub', '$'+sub.toFixed(2));
  d('d-tax', '$'+tax.toFixed(2));
  d('d-tot', '$'+tot.toFixed(2));

  const checkoutLink = document.querySelector('a[data-track="drawer_checkout"]');
  if (checkoutLink) {
    const remaining = MIN_ORDER_SUBTOTAL - sub;
    if (cart.length > 0 && remaining > 0.004) {
      checkoutLink.removeAttribute('href');
      checkoutLink.style.pointerEvents = 'none';
      checkoutLink.style.opacity = '0.4';
      checkoutLink.style.cursor = 'not-allowed';
      checkoutLink.textContent = `$${remaining.toFixed(2)} More to Reach $250 Minimum`;
    } else {
      checkoutLink.setAttribute('href', '/checkout');
      checkoutLink.style.pointerEvents = '';
      checkoutLink.style.opacity = '';
      checkoutLink.style.cursor = '';
      checkoutLink.textContent = 'Proceed to Checkout';
    }
  }

  renderDrawerDateOptions();
}

function toggleMenu() {
  const menu = document.getElementById('mobile-menu');
  const h1 = document.getElementById('ham1');
  const h2 = document.getElementById('ham2');
  const h3 = document.getElementById('ham3');
  if (!menu) return;
  const open = menu.classList.toggle('open');
  const hamBtn = document.getElementById('ham-btn');
  if (hamBtn) hamBtn.setAttribute('aria-expanded', open);
  if (open) {
    if(h1) h1.style.transform = 'translateY(6.5px) rotate(45deg)';
    if(h2) h2.style.opacity = '0';
    if(h3) h3.style.transform = 'translateY(-6.5px) rotate(-45deg)';
  } else {
    if(h1) h1.style.transform = '';
    if(h2) h2.style.opacity = '';
    if(h3) h3.style.transform = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refreshCartUI();
  renderDrawer();
  injectWhatsAppButton();
  injectStickyOrderBar();
});

// /index.html → "/", /menu.html → "/menu", /menu/ → "/menu"
function normalizedPath() {
  let p = location.pathname.replace(/\/index\.html$/i, '/').replace(/\.html$/i, '');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

// A persistent bottom bar on mobile so the next step is always one tap away,
// instead of relying on visitors scrolling back up to find a CTA. Hidden on
// checkout itself — you're already there.
function injectStickyOrderBar() {
  if (document.getElementById('order-bar')) return;
  const path = normalizedPath();
  if (path === '/checkout') return; // checkout is the destination already

  const onMenu = path === '/menu';
  const onPackage = path === '/package';
  const bar = document.createElement('a');
  bar.id = 'order-bar';
  bar.href = onPackage ? '#pkg-total' : (onMenu ? '/checkout' : '/menu');
  bar.dataset.track = onPackage ? 'sticky_bar_package' : (onMenu ? 'sticky_bar_checkout' : 'sticky_bar_menu');
  bar.innerHTML = (onPackage ? 'Build Your Table' : (onMenu ? 'Proceed to Checkout' : 'Order for Friday')) + ' <span aria-hidden="true">&rarr;</span>';

  const style = document.createElement('style');
  style.textContent = `
    #order-bar {
      display: none;
      position: fixed;
      left: 0; right: 0; bottom: 0;
      z-index: 40;
      background: #D4AF37;
      color: #1A1A1A;
      text-align: center;
      text-decoration: none;
      font-family: 'Jost', sans-serif;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      padding: 15px 16px calc(15px + env(safe-area-inset-bottom));
      box-shadow: 0 -6px 20px rgba(0,0,0,.18);
    }
    #order-bar:active { background: #B8941F; }
    @media (max-width: 768px) {
      #order-bar { display: block; }
      #whatsapp-btn { bottom: calc(76px + env(safe-area-inset-bottom)); }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(bar);

  // The homepage also shows a bottom cookie banner on first visit — keep the
  // order bar out of its way instead of the two stacking on top of each other.
  const cookieBanner = document.getElementById('cookie');
  if (cookieBanner) {
    const syncWithCookieBanner = () => {
      const visible = document.body.contains(cookieBanner) && !cookieBanner.classList.contains('translate-y-full');
      bar.style.display = visible ? 'none' : '';
    };
    syncWithCookieBanner();
    new MutationObserver(syncWithCookieBanner).observe(cookieBanner, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(syncWithCookieBanner).observe(document.body, { childList: true });
  }
}

function injectWhatsAppButton() {
  if (document.getElementById('whatsapp-btn')) return;
  const btn = document.createElement('a');
  btn.id = 'whatsapp-btn';
  btn.href = 'https://wa.me/13053076800';
  btn.target = '_blank';
  btn.rel = 'noopener noreferrer';
  btn.dataset.track = 'whatsapp';
  btn.innerHTML = `
    <div class="whatsapp-inner">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.438 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.41 0 .01 5.403.006 12.039a11.9 11.9 0 001.611 6.02L0 24l6.105-1.602a11.834 11.834 0 005.937 1.606h.005c6.637 0 12.038-5.402 12.042-12.039a11.82 11.82 0 00-3.48-8.512z" fill="currentColor"/>
      </svg>
      <span>Chat with Us</span>
    </div>
  `;
  
  const style = document.createElement('style');
  style.textContent = `
    #whatsapp-btn {
      position: fixed;
      bottom: 30px;
      right: 30px;
      z-index: 100;
      text-decoration: none;
      transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    #whatsapp-btn:hover {
      transform: scale(1.05) translateY(-5px);
    }
    .whatsapp-inner {
      background: #25D366;
      color: white;
      padding: 12px 20px;
      border-radius: 50px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 10px 25px rgba(37, 211, 102, 0.3);
      font-family: 'Jost', sans-serif;
      font-size: 14px;
      font-weight: 500;
      letter-spacing: 0.5px;
    }
    @media (max-width: 768px) {
      #whatsapp-btn {
        bottom: 20px;
        right: 20px;
      }
      .whatsapp-inner span {
        display: none;
      }
      .whatsapp-inner {
        padding: 15px;
        border-radius: 50%;
      }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(btn);
}
