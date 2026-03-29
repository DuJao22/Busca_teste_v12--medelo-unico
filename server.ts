import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from './src/db.js';
import fs from 'fs';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Ensure 'dados' directory exists
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
const dadosDir = isVercel ? '/tmp/dados' : path.join(process.cwd(), 'dados');
if (!fs.existsSync(dadosDir)) {
  fs.mkdirSync(dadosDir, { recursive: true });
}

// Initialize default admin if not exists, or update if it does
const adminExists = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get('DuJao');
const hash = bcrypt.hashSync('3003', 10);
if (!adminExists) {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('DuJao', hash, 'admin');
} else {
  db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE LOWER(username) = LOWER(?)').run(hash, 'admin', 'DuJao');
}

// --- API Routes ---

// Auth Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    
    // Verify user still exists in DB
    const dbUser = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id);
    if (!dbUser) {
      return res.status(401).json({ error: 'Usuário não encontrado ou sessão expirada. Por favor, faça login novamente.' });
    }
    
    req.user = user;
    next();
  });
};

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username) as any;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, api_key: user.api_key } });
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req: any, res) => {
  const user = db.prepare('SELECT id, username, role, api_key FROM users WHERE id = ?').get(req.user.id) as any;
  res.json(user);
});

// Get settings
app.get('/api/settings', authenticateToken, (req: any, res) => {
  const settings = db.prepare('SELECT key, value FROM settings').all() as any[];
  const settingsMap = settings.reduce((acc, curr) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});
  res.json(settingsMap);
});

// Users Management
app.get('/api/users', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const users = db.prepare('SELECT id, username, role, api_key FROM users').all();
  res.json(users);
});

app.post('/api/users', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  
  const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
  if (existingUser) {
    return res.status(400).json({ error: 'Usuário já existe' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const apiKey = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO users (username, password_hash, role, api_key) VALUES (?, ?, ?, ?)').run(username, hash, role, apiKey);
    res.json({ success: true });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

app.delete('/api/users/:id', authenticateToken, (req: any, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Não é possível excluir o próprio usuário' });
  }
  
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Erro ao excluir usuário' });
  }
});

// Save settings
app.post('/api/settings', authenticateToken, (req: any, res) => {
  const { gemini_api_key } = req.body;
  
  try {
    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    
    db.transaction(() => {
      if (gemini_api_key !== undefined) {
        stmt.run('gemini_api_key', gemini_api_key);
      }
    })();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

// Dashboard Stats
app.get('/api/stats', authenticateToken, (req: any, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM sites').get() as any;
    const today = db.prepare("SELECT COUNT(*) as count FROM sites WHERE date(created_at) = date('now')").get() as any;
    
    res.json({
      total: total.count,
      today: today.count
    });
  } catch (error) {
    console.error('Error in /api/stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save Analyzed Data
app.post('/api/analyze/save', authenticateToken, (req: any, res) => {
  const data = req.body;
  
  // Generate filename
  const safeName = data.name ? data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)+/g, '') : 'empresa';
  const timestamp = Date.now();
  const filename = `${safeName}_${timestamp}.json`;
  const filepath = path.join(dadosDir, filename);

  // Save JSON to 'dados' folder
  try {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving JSON file:', err);
    return res.status(500).json({ error: 'Erro ao salvar arquivo JSON' });
  }

  // Save to DB for history (reusing sites table)
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

    const servicesStr = Array.isArray(data.services) ? data.services.join(', ') : (data.services || '');
    const nameStr = String(data.name || 'Desconhecido');
    const phoneStr = String(data.phone || '');
    const addressStr = String(data.address || '');
    const cityStr = String(data.city || '');
    const descriptionStr = String(data.description || '');
    const mapLinkStr = String(data.map_link || '');
    const imageUrlStr = String(data.image_url || '');

    const result = db.prepare(`
      INSERT INTO sites (slug, name, phone, address, city, description, services, map_link, image_url, expires_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(filename, nameStr, phoneStr, addressStr, cityStr, descriptionStr, servicesStr, mapLinkStr, imageUrlStr, expiresAt.toISOString(), req.user.id);

    res.json({ id: result.lastInsertRowid, filename });
  } catch (dbErr: any) {
    console.error('Database error when saving site:', dbErr);
    return res.status(500).json({ error: 'Erro no banco de dados ao salvar: ' + dbErr.message });
  }
});

// List Analyzed Links
app.get('/api/sites', authenticateToken, (req: any, res) => {
  try {
    const sites = db.prepare('SELECT * FROM sites ORDER BY created_at DESC').all();
    res.json(sites);
  } catch (error) {
    console.error('Error in /api/sites:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download JSON
app.get('/api/analyze/download/:filename', authenticateToken, (req: any, res) => {
  const filename = req.params.filename;
  const filepath = path.join(dadosDir, filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  }

  res.download(filepath);
});

// Expand URL
app.post('/api/expand-url', authenticateToken, async (req: any, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    const response = await fetch(url, { 
      method: 'GET', 
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    res.json({ url: response.url });
  } catch (error: any) {
    console.error('Error expanding URL:', error);
    res.status(500).json({ error: 'Failed to expand URL' });
  }
});

// Proxy Endpoint for Webhooks
app.post('/api/proxy-webhook', authenticateToken, async (req: any, res) => {
  try {
    const { url: rawUrl, payload, method = 'POST', authToken } = req.body;
    if (!rawUrl) return res.status(400).json({ error: 'URL is required' });
    if (!payload) return res.status(400).json({ error: 'Payload is required' });
    
    // Clean URL: trim and remove trailing slashes which can cause 404s on some servers
    const url = rawUrl.trim().replace(/\/+$/, '');
    console.log(`[Proxy] ${method} to: ${url}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (authToken) {
      // Support both Bearer and simple token formats
      headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
      headers['x-api-key'] = authToken; // Some systems use this instead
    }

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers
    };

    if (fetchOptions.method !== 'GET' && fetchOptions.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(url, fetchOptions);

    if (response.ok) {
      res.json({ success: true, status: response.status });
    } else {
      let errorBody = '';
      try {
        errorBody = await response.text();
        // Try to parse if it's JSON to get a cleaner message
        const json = JSON.parse(errorBody);
        if (json.error || json.message) {
          errorBody = json.error || json.message;
        }
      } catch (e) {
        // use raw text if not JSON
      }
      
      res.status(response.status).json({ 
        error: errorBody || `HTTP Error: ${response.status}`, 
        status: response.status 
      });
    }
  } catch (error: any) {
    console.error('Error proxying webhook:', error);
    res.status(500).json({ error: error.message || 'Failed to send webhook' });
  }
});

// Analyze Link Endpoint
app.post('/api/analyze-link', async (req: any, res: any) => {
  // Check for authorization (either JWT or a simple API key passed in headers)
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-api-key'];
  
  let isAuthenticated = false;
  
  if (apiKeyHeader) {
     // Check if it matches a user's API key
     const user = db.prepare('SELECT id FROM users WHERE api_key = ?').get(apiKeyHeader) as any;
     if (user) {
       isAuthenticated = true;
     }
  } else if (authHeader) {
     const token = authHeader.split(' ')[1];
     try {
       jwt.verify(token, JWT_SECRET);
       isAuthenticated = true;
     } catch (e) {
       // ignore
     }
  }

  if (!isAuthenticated) {
    return res.status(401).json({ error: 'Não autorizado. Forneça um token JWT válido ou um x-api-key configurado.' });
  }

  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'A URL é obrigatória no corpo da requisição ({"url": "..."}).' });
  }

  try {
    // Get Gemini API Key
    let geminiApiKey = '';
    const settings = db.prepare('SELECT key, value FROM settings').all() as any[];
    const settingsMap = settings.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {} as any);

    if (settingsMap.gemini_api_key) {
      geminiApiKey = settingsMap.gemini_api_key;
      console.log("Using API key from database settings");
    }

    if (!geminiApiKey) {
      geminiApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
      if (geminiApiKey) {
        console.log("Using API key from environment variables");
      }
    }

    if (!geminiApiKey) {
      return res.status(500).json({ error: 'Chave da API do Gemini não configurada no servidor.' });
    }

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    
    // Extract place name hint if possible
    let placeNameHint = '';
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const placePart = pathParts.find(part => part.includes('+') || part.includes('-'));
      if (placePart) {
        placeNameHint = decodeURIComponent(placePart.replace(/\+/g, ' '));
      }
    } catch (e) {
      // ignore
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Você é um especialista em extração de dados.
Você recebeu o seguinte link do Google Maps: ${url}
${placeNameHint ? `\nDica: O nome do estabelecimento extraído da URL parece ser "${placeNameHint}".` : ''}

Sua missão é OBRIGATÓRIA:
1. Analise cuidadosamente a URL fornecida e a dica de nome (se houver) para identificar o estabelecimento.
2. Descubra EXATAMENTE qual é o estabelecimento real (nome, nicho, endereço, telefone).
3. Se o link for genérico, quebrado, ou se você NÃO TIVER 100% DE CERTEZA de qual é o estabelecimento exato, você DEVE definir "success" como false e preencher o "errorMessage" explicando que não foi possível identificar o local e pedindo para o usuário verificar o link.
4. Se você encontrou o estabelecimento com sucesso, defina "success" as true e extraia os dados reais: Nome da empresa, telefone (apenas números com DDD), endereço completo e cidade.
5. Identifique o NICHO exato (ex: barbearia, lanchonete, clínica, restaurante).
6. Crie uma DESCRIÇÃO detalhada do negócio.
7. Liste os principais serviços oferecidos (ou que fazem sentido para o nicho), separados por vírgula.

RETORNE APENAS UM JSON VÁLIDO com a seguinte estrutura exata (sem formatação markdown como \`\`\`json):
{
  "success": true/false,
  "errorMessage": "mensagem de erro se success for false",
  "name": "Nome da Empresa",
  "phone": "Telefone",
  "address": "Endereço Completo",
  "city": "Cidade",
  "description": "Descrição",
  "services": "Serviços"
}

NÃO INVENTE DADOS. Se não souber ou não encontrar o local exato, retorne success: false.`,
      config: {
        // Removido o uso de tools (googleMaps/googleSearch) pois causa erro 429 em contas gratuitas.
        // A IA consegue extrair os dados diretamente da URL expandida.
      }
    });

    if (!response.text) {
      throw new Error('A IA não retornou uma resposta válida.');
    }

    let result;
    try {
      const cleanText = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleanText);
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError, "Raw text:", response.text);
      throw new Error("A resposta da IA não estava em um formato válido. Tente novamente.");
    }
    
    return res.json(result);

  } catch (error: any) {
    console.error('Error analyzing link:', error);
    
    let friendlyError = error.message || 'Erro interno ao analisar o link';
    if (friendlyError.includes('429') || friendlyError.includes('RESOURCE_EXHAUSTED') || friendlyError.includes('quota')) {
      friendlyError = 'Limite de cota atingido (Erro 429). A ferramenta do Google Maps no Gemini tem limites diários. IMPORTANTE: Se você trocou a chave no Render, lembre-se de atualizá-la também no menu "Configurações" deste painel, pois a chave salva lá tem prioridade.';
    } else if (friendlyError.includes('503') || friendlyError.includes('UNAVAILABLE') || friendlyError.includes('high demand')) {
      friendlyError = 'Os servidores da Inteligência Artificial estão sobrecarregados no momento (Erro 503). Isso é temporário. Por favor, aguarde alguns instantes e tente novamente.';
    } else if (friendlyError.includes('API_KEY_INVALID') || friendlyError.includes('invalid API key')) {
      friendlyError = 'Chave de API inválida. Por favor, verifique a chave configurada nas Configurações.';
    }

    return res.status(500).json({ error: friendlyError, details: error.message });
  }
});

// Delete Analyzed Data
app.delete('/api/sites/:id', authenticateToken, (req: any, res) => {
  const site = db.prepare('SELECT slug FROM sites WHERE id = ?').get(req.params.id) as any;
  if (site) {
    const filepath = path.join(dadosDir, site.slug);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
    db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
  }
  res.json({ success: true });
});

// --- Vercel Serverless Export ---
export default app;

// --- Local Development & Production Server ---
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  // Start Vite dev server
  createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  }).then((vite) => {
    app.use(vite.middlewares);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
} else if (!process.env.VERCEL) {
  // Serve static files in production (Render, Railway, VPS, etc.)
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}
