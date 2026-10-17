const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;
const DB_FILE = path.join(DIR, 'atendimento.sqlite');
const SESSAO_MS = 12 * 60 * 60 * 1000;

const hashSenha = (senha) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(senha, salt, 64).toString('hex');
};
const confere = (senha, hash) => {
  const [salt, h] = hash.split(':');
  const a = Buffer.from(h, 'hex');
  const b = crypto.scryptSync(senha, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    login TEXT PRIMARY KEY COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('recepcao', 'tecnico')),
    technician_id TEXT UNIQUE,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS availability (
    technician_id TEXT PRIMARY KEY REFERENCES users(technician_id),
    available INTEGER NOT NULL CHECK (available IN (0, 1)),
    updated_at TEXT NOT NULL
  );
`);

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (login, name, role, technician_id, password_hash)
  VALUES (?, ?, ?, ?, ?)
`);
if (fs.existsSync(path.join(DIR, 'usuarios.json'))) {
  const importedUsers = JSON.parse(fs.readFileSync(path.join(DIR, 'usuarios.json'), 'utf8'));
  for (const u of importedUsers) {
    const hash = u.hash || (u.senha ? hashSenha(u.senha) : null);
    if (u.login && u.papel && hash) insertUser.run(u.login, u.nome || u.login, u.papel, u.tecnicoId || null, hash);
  }
}
if (!db.prepare('SELECT 1 FROM users WHERE login = ?').get('recepcao')) {
  insertUser.run('recepcao', 'recepcao', 'recepcao', null, hashSenha('123'));
}

if (fs.existsSync(path.join(DIR, 'estado.json'))) {
  const importedState = JSON.parse(fs.readFileSync(path.join(DIR, 'estado.json'), 'utf8'));
  const insertAvailability = db.prepare(`
    INSERT OR IGNORE INTO availability (technician_id, available, updated_at)
    SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE technician_id = ?)
  `);
  for (const [id, item] of Object.entries(importedState)) {
    if (item && item.atualizado) insertAvailability.run(id, item.disponivel ? 1 : 0, item.atualizado, id);
  }
}

const findUser = (login) => db.prepare(`
  SELECT login, name AS nome, role AS papel, technician_id AS tecnicoId, password_hash AS hash
  FROM users WHERE login = ?
`).get(login);

const sessoes = new Map();
const tentativas = new Map();

const lista = () => db.prepare(`
  SELECT u.technician_id AS id, u.name AS nome,
         COALESCE(a.available, 0) AS disponivel, a.updated_at AS atualizado
  FROM users u
  LEFT JOIN availability a ON a.technician_id = u.technician_id
  WHERE u.role = 'tecnico'
  ORDER BY u.name COLLATE NOCASE
`).all().map(t => ({ ...t, disponivel: !!t.disponivel }));

const json = (res, code, data, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
};
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };
const pagina = (res, file) => {
  fs.readFile(path.join(DIR, 'public', file), (err, buf) => {
    if (err) { res.writeHead(500); return res.end('Erro'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
};

const tokenDe = (req) => {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sessao=([a-f0-9]+)/);
  return m && m[1];
};
const usuarioDe = (req) => {
  const t = tokenDe(req);
  const s = t && sessoes.get(t);
  if (!s) return null;
  if (s.expira < Date.now()) { sessoes.delete(t); return null; }
  return s.user;
};
const novaSessao = (res, u, extra) => {
  const token = crypto.randomBytes(32).toString('hex');
  sessoes.set(token, { user: { login: u.login, papel: u.papel, tecnicoId: u.tecnicoId }, expira: Date.now() + SESSAO_MS });
  json(res, 200, { destino: home(u), ...extra }, {
    'Set-Cookie': `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_MS / 1000}`,
  });
};
const home = (u) => u.papel === 'recepcao' ? '/recepcao' : '/tecnico/' + u.tecnicoId;

const lerCorpo = (req, cb) => {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2048) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(body)); } catch { cb(null); } });
};

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const user = usuarioDe(req);

  if (p === '/cadastro' && req.method === 'GET') return user ? redirect(res, home(user)) : pagina(res, 'cadastro.html');
  if (p === '/login' && req.method === 'GET') return user ? redirect(res, home(user)) : pagina(res, 'login.html');

  if (p === '/api/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress;
    const t = tentativas.get(ip) || { n: 0, ate: 0 };
    if (t.ate > Date.now()) return json(res, 429, { erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    return lerCorpo(req, (d) => {
      const u = d && typeof d.login === 'string' && typeof d.senha === 'string'
        ? findUser(d.login.trim()) : null;
      if (!u || !confere(d.senha, u.hash)) {
        t.n++;
        if (t.n >= 5) { t.n = 0; t.ate = Date.now() + 5 * 60 * 1000; }
        tentativas.set(ip, t);
        return json(res, 401, { erro: 'Login ou senha inválidos' });
      }
      tentativas.delete(ip);
      novaSessao(res, u);
    });
  }

  if (p === '/api/cadastro' && req.method === 'POST') {
    return lerCorpo(req, (d) => {
      const nome = d && typeof d.nome === 'string' ? d.nome.trim().replace(/\s+/g, ' ') : '';
      if (nome.length < 2 || nome.length > 40) return json(res, 400, { erro: 'Informe um nome entre 2 e 40 caracteres' });
      if (!d || typeof d.senha !== 'string' || d.senha.length < 4) return json(res, 400, { erro: 'A senha deve ter ao menos 4 caracteres' });
      if (findUser(nome)) return json(res, 409, { erro: 'Esse nome já está em uso' });
      const u = { login: nome, nome, papel: 'tecnico', tecnicoId: 't' + crypto.randomBytes(6).toString('hex'), hash: hashSenha(d.senha) };
      try {
        db.prepare(`
          INSERT INTO users (login, name, role, technician_id, password_hash)
          VALUES (?, ?, ?, ?, ?)
        `).run(u.login, u.nome, u.papel, u.tecnicoId, u.hash);
      } catch {
        return json(res, 409, { erro: 'Esse nome já está em uso' });
      }
      novaSessao(res, u);
    });
  }

  if (p === '/api/logout' && req.method === 'POST') {
    sessoes.delete(tokenDe(req));
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (p.startsWith('/api/')) {
    if (!user) return json(res, 401, { erro: 'Não autenticado' });

    if (p === '/api/tecnicos' && req.method === 'GET') {
      const l = lista();
      return json(res, 200, user.papel === 'recepcao' ? l : l.filter(t => t.id === user.tecnicoId));
    }

    const m = p.match(/^\/api\/tecnicos\/([\w-]+)\/status$/);
    if (m && req.method === 'POST') {
      if (user.papel !== 'tecnico' || user.tecnicoId !== m[1]) return json(res, 403, { erro: 'Acesso negado' });
      return lerCorpo(req, (d) => {
        if (!d) return json(res, 400, { erro: 'JSON inválido' });
        db.prepare(`
          INSERT INTO availability (technician_id, available, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(technician_id) DO UPDATE SET
            available = excluded.available,
            updated_at = excluded.updated_at
        `).run(m[1], d.disponivel ? 1 : 0, new Date().toISOString());
        json(res, 200, lista().find(t => t.id === m[1]));
      });
    }
    return json(res, 404, { erro: 'Não encontrado' });
  }

  if (req.method === 'GET') {
    if (!user) return redirect(res, '/login');
    if (p === '/') return redirect(res, home(user));
    if (p === '/recepcao') return user.papel === 'recepcao' ? pagina(res, 'recepcao.html') : redirect(res, home(user));
    if (/^\/tecnico(\/[\w-]+)?$/.test(p)) {
      return user.papel === 'tecnico' && p === '/tecnico/' + user.tecnicoId ? pagina(res, 'tecnico.html') : redirect(res, home(user));
    }
  }

  res.writeHead(404); res.end('Não encontrado');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor em http://localhost:${PORT}`);
});
