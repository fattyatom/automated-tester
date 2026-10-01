/**
 * ShopLite — a tiny demo shop used to prove the QA tool end-to-end.
 * It contains INTENTIONAL BUGS (marked "BUG:") so the exploratory charters have something to find.
 * Do not copy patterns from here into real code.
 */
import http from 'node:http';
import crypto from 'node:crypto';

type Session = {
  email: string;
  shipping?: Record<string, string>;
  payment?: Record<string, string>;
  profile: { displayName: string; phone: string; bio: string };
};

const USERS: Record<string, { password: string; role: string; name: string }> = {
  'user@example.com': { password: 'Passw0rd!', role: 'customer', name: 'Casey Customer' },
  'admin@example.com': { password: 'Admin123!', role: 'admin', name: 'Ada Admin' },
};
const sessions = new Map<string, Session>();
const orders = new Map<number, { email: string; shipping: Record<string, string> }>();
let nextOrder = 1000;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, s?: Session): string {
  const nav = s
    ? `<a href="/dashboard">Dashboard</a> <a href="/checkout/shipping">Checkout</a> <a href="/profile">Profile</a> <a href="/orders">Orders</a> <a href="/logout">Sign out</a>`
    : `<a href="/">Home</a> <a href="/login">Sign in</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · ShopLite</title>
<style>body{font-family:system-ui;max-width:640px;margin:2rem auto;padding:0 1rem}label{display:block;margin-top:.8rem}
input,select,textarea{display:block;width:100%;padding:.4rem}.error{color:#b00020}[role=alert]{color:#b00020;border:1px solid;padding:.5rem}
.ok{color:#05631d}nav a{margin-right:.6rem}button{margin-top:1rem;padding:.5rem 1rem}</style></head>
<body><nav>${nav}</nav><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

function field(label: string, name: string, attrs: string, value = '', error?: string, kind = 'input'): string {
  const id = name;
  const invalid = error ? ` aria-invalid="true" aria-describedby="${id}-err"` : '';
  const err = error ? `<span class="error" id="${id}-err">${esc(error)}</span>` : '';
  const control =
    kind === 'textarea'
      ? `<textarea id="${id}" name="${name}" ${attrs}${invalid}>${esc(value)}</textarea>`
      : `<input id="${id}" name="${name}" ${attrs} value="${esc(value)}"${invalid}>`;
  return `<label for="${id}">${label}</label>${control}${err}`;
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname.replace(/\/$/, '') || '/';
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const s = sid ? sessions.get(sid) : undefined;

  const send = (status: number, html: string, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(html);
  };
  const redirect = (to: string, headers: Record<string, string> = {}) => {
    res.writeHead(303, { location: to, ...headers });
    res.end();
  };
  const requireAuth = () => {
    if (!s) redirect('/login?next=' + encodeURIComponent(p));
    return s;
  };

  try {
    if (p === '/health') return send(200, 'ok');

    if (p === '/') {
      return send(200, page('Welcome to ShopLite', `<p>Shop the essentials.</p><p><a href="/login">Sign in to start shopping</a></p>`, s));
    }

    if (p === '/login' && req.method === 'GET') {
      return send(200, page('Sign in', `<form method="post" action="/login">
${field('Email', 'email', 'type="email" required autocomplete="username"')}
${field('Password', 'password', 'type="password" required autocomplete="current-password"')}
<button type="submit">Sign in</button></form>`));
    }
    if (p === '/login' && req.method === 'POST') {
      const b = await readBody(req);
      const user = USERS[(b.email ?? '').trim().toLowerCase()];
      if (!user || user.password !== b.password) {
        return send(401, page('Sign in', `<div role="alert">Invalid email or password</div><form method="post" action="/login">
${field('Email', 'email', 'type="email" required', b.email)}
${field('Password', 'password', 'type="password" required')}
<button type="submit">Sign in</button></form>`));
      }
      const id = crypto.randomUUID();
      sessions.set(id, { email: b.email.trim().toLowerCase(), profile: { displayName: user.name, phone: '', bio: '' } });
      return redirect('/dashboard', { 'set-cookie': `sid=${id}; HttpOnly; Path=/; SameSite=Lax` });
    }
    if (p === '/logout') {
      if (sid) sessions.delete(sid);
      return redirect('/login', { 'set-cookie': 'sid=; Path=/; Max-Age=0' });
    }

    if (p === '/dashboard') {
      if (!requireAuth()) return;
      return send(200, page('Dashboard', `<p>Welcome back, ${esc(s!.profile.displayName)}!</p>
<ul><li><a href="/checkout/shipping">Start checkout</a></li><li><a href="/profile">Edit profile</a></li><li><a href="/orders">Your orders</a></li><li><a href="/help">Help</a></li></ul>`, s));
    }

    if (p === '/admin') {
      if (!requireAuth()) return;
      // BUG: role is never checked — any signed-in customer can see the admin panel.
      return send(200, page('Admin Panel', `<p>${sessions.size} active sessions, ${orders.size} orders.</p>`, s));
    }

    if (p === '/profile') {
      if (!requireAuth()) return;
      const prof = s!.profile;
      const errors: Record<string, string> = {};
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (!b.displayName?.trim()) errors.displayName = 'Display name is required';
        // BUG: maxlength 30 is only enforced by the browser — the server never checks it.
        if (b.phone && !/^\d{8,15}$/.test(b.phone)) errors.phone = 'Phone must be 8-15 digits';
        if ((b.bio ?? '').length > 200) errors.bio = 'Bio must be at most 200 characters';
        if (!Object.keys(errors).length) {
          Object.assign(prof, { displayName: b.displayName, phone: b.phone ?? '', bio: b.bio ?? '' });
          return redirect('/profile?saved=1');
        }
      }
      const saved = url.searchParams.get('saved') ? `<p class="ok">Profile saved</p>` : '';
      const summary = Object.keys(errors).length ? `<div role="alert">Please fix the errors below</div>` : '';
      return send(Object.keys(errors).length ? 422 : 200, page('Your profile', `${saved}${summary}<form method="post" action="/profile">
${field('Display name', 'displayName', 'required maxlength="30"', prof.displayName, errors.displayName)}
${field('Phone', 'phone', 'type="tel" pattern="[0-9]{8,15}"', prof.phone, errors.phone)}
${field('Bio', 'bio', 'maxlength="200"', prof.bio, errors.bio, 'textarea')}
<button type="submit">Save profile</button></form>
<section><h2>Preview</h2><p><strong>${esc(prof.displayName)}</strong></p><div class="bio">${prof.bio /* BUG: unescaped → stored XSS */}</div></section>`, s));
    }

    if (p === '/checkout/shipping') {
      if (!requireAuth()) return;
      const errors: Record<string, string> = {};
      let b: Record<string, string> = s!.shipping ?? {};
      if (req.method === 'POST') {
        b = await readBody(req);
        if (!b.fullName?.trim()) errors.fullName = 'Full name is required';
        if ((b.fullName ?? '').length > 60) errors.fullName = 'Full name must be at most 60 characters';
        if (!b.address?.trim()) errors.address = 'Address is required';
        if (!/^\d{4}$/.test(b.postcode ?? '')) errors.postcode = 'Postcode must be 4 digits';
        if (!['Australia', 'New Zealand'].includes(b.country)) errors.country = 'Please choose a supported country';
        if (!Object.keys(errors).length) {
          s!.shipping = b;
          return redirect('/checkout/payment');
        }
      }
      const opt = (v: string) => `<option${b.country === v ? ' selected' : ''}>${v}</option>`;
      return send(Object.keys(errors).length ? 422 : 200, page('Shipping details', `${Object.keys(errors).length ? '<div role="alert">Please fix the errors below</div>' : ''}
<form method="post">
${field('Full name', 'fullName', 'required maxlength="60"', b.fullName, errors.fullName)}
${field('Address', 'address', 'required', b.address, errors.address)}
${field('Postcode', 'postcode', 'required pattern="[0-9]{4}" inputmode="numeric"', b.postcode, errors.postcode)}
<label for="country">Country</label><select id="country" name="country" required><option value="">Choose…</option>${opt('Australia')}${opt('New Zealand')}</select>${errors.country ? `<span class="error">${errors.country}</span>` : ''}
<button type="submit">Continue to payment</button></form>`, s));
    }

    if (p === '/checkout/payment') {
      if (!requireAuth()) return;
      if (!s!.shipping) return redirect('/checkout/shipping'); // correct guard
      const errors: Record<string, string> = {};
      let b: Record<string, string> = {};
      if (req.method === 'POST') {
        b = await readBody(req);
        if (!/^\d{16}$/.test(b.cardNumber ?? '')) errors.cardNumber = 'Card number must be 16 digits';
        if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(b.expiry ?? '')) errors.expiry = 'Expiry must be MM/YY';
        if (!/^\d{3}$/.test(b.cvc ?? '')) errors.cvc = 'CVC must be 3 digits';
        if (!Object.keys(errors).length) {
          s!.payment = { last4: b.cardNumber.slice(-4) };
          return redirect('/checkout/review');
        }
      }
      return send(Object.keys(errors).length ? 422 : 200, page('Payment', `${Object.keys(errors).length ? '<div role="alert">Please fix the errors below</div>' : ''}
<form method="post">
${field('Card number', 'cardNumber', 'required pattern="[0-9]{16}" inputmode="numeric"', b.cardNumber, errors.cardNumber)}
${field('Expiry', 'expiry', 'required pattern="(0[1-9]|1[0-2])/[0-9]{2}" placeholder="MM/YY"', b.expiry, errors.expiry)}
${field('CVC', 'cvc', 'required pattern="[0-9]{3}"', b.cvc, errors.cvc)}
<button type="submit">Continue to review</button></form>`, s));
    }

    if (p === '/checkout/review') {
      if (!requireAuth()) return;
      // BUG: no check that shipping AND payment were completed — the step can be deep-linked.
      const sh = s!.shipping ?? {};
      return send(200, page('Review your order', `<dl><dt>Ship to</dt><dd>${esc(sh.fullName)}, ${esc(sh.address)} ${esc(sh.postcode)} ${esc(sh.country)}</dd>
<dt>Card</dt><dd>•••• ${esc(s!.payment?.last4)}</dd></dl>
<form method="post" action="/checkout/apply-promo"><input name="promo" placeholder="Promo code"> <button type="button">Apply</button></form>
<form method="post" action="/checkout/confirm"><button type="submit">Place order</button></form>`, s));
    }

    if (p === '/checkout/confirm' && req.method === 'POST') {
      if (!requireAuth()) return;
      if (!s!.shipping || !s!.payment) return redirect('/checkout/shipping');
      await sleep(400); // slow payment provider
      const id = nextOrder++;
      // BUG: not idempotent and checkout state is never cleared → double-submit / back+resubmit create duplicates.
      orders.set(id, { email: s!.email, shipping: s!.shipping });
      return redirect(`/orders/${id}`);
    }

    if (p === '/orders') {
      if (!requireAuth()) return;
      const mine = [...orders].filter(([, o]) => o.email === s!.email);
      return send(200, page('Your orders', mine.length ? `<ul>${mine.map(([id]) => `<li><a href="/orders/${id}">Order #${id}</a></li>`).join('')}</ul>` : '<p>No orders yet.</p>', s));
    }

    const orderMatch = p.match(/^\/orders\/([^/]+)$/);
    if (orderMatch) {
      if (!requireAuth()) return;
      const id = Number(orderMatch[1]);
      // BUG: non-numeric ids blow up and the stack trace is rendered to the user.
      if (Number.isNaN(id)) throw new TypeError(`Cannot read properties of undefined (reading 'shipping') for order "${decodeURIComponent(orderMatch[1])}"`);
      const order = orders.get(id);
      if (!order) return send(404, page('Order not found', '<p>We could not find that order.</p>', s));
      if (order.email !== s!.email) return send(403, page('Access denied', '<p>This order belongs to someone else.</p>', s));
      return send(200, page(`Order #${id} confirmed`, `<p class="ok">Thanks! Your order #${id} is confirmed and will ship to ${esc(order.shipping.fullName)}.</p>`, s));
    }

    return send(404, page('Page not found', '<p>That page does not exist.</p>', s));
  } catch (e) {
    return send(500, `<h1>Internal Server Error</h1><pre>${esc((e as Error).stack)}</pre>`);
  }
});

const port = Number(process.env.PORT ?? 4321);
server.listen(port, () => console.log(`ShopLite demo on http://localhost:${port}`));
