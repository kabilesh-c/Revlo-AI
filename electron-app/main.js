const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } = require('electron');
const Fastify = require('fastify');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const screenshot = require('screenshot-desktop');
require('dotenv').config();
const { supabase } = require('./supabase');
console.log('[electron] GEMINI key present:', !!process.env.GEMINI_API_KEY);

let mainWindow;
let tray;
let db;
let server;

const INGEST_PORT = 4820;
let classifierPromise;
let modelStatus = 'loading'; // loading | ready | fallback | error
let mainWindowReady = false;
let multiModelPromise;
let langDetectorPromise;

async function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = import('@xenova/transformers').then(async ({ pipeline }) => {
      try {
        console.log('[electron] Using base remote model');
        const pipe = await pipeline('text-classification', 'Xenova/toxic-bert', { quantized: true });
        modelStatus = 'ready';
        notifyModelStatus();
        return pipe;
      } catch (err) {
        console.error('[electron] base model load failed, using fallback', err?.message);
        modelStatus = 'fallback';
        notifyModelStatus();
        throw err;
      }
    });
  }
  return classifierPromise;
}

async function getMultilingualClassifier() {
  if (!multiModelPromise) {
    multiModelPromise = import('@xenova/transformers').then(async ({ pipeline }) => {
      const localModelDir = path.join(__dirname, 'models', 'multilingual-tox');
      const tokenizer = path.join(localModelDir, 'tokenizer.json');
      const config = path.join(localModelDir, 'config.json');
      const onnx = fs.readdirSync(localModelDir).find((f) => f.endsWith('.onnx'));
      if (!onnx || !fs.existsSync(tokenizer) || !fs.existsSync(config)) {
        throw new Error('Multilingual model files missing');
      }
      const modelPath = path.join(localModelDir, onnx);
      console.log('[electron] Using multilingual model bundle');
      const pipe = await pipeline('text-classification', localModelDir, { quantized: true, model: modelPath, tokenizer, config });
      return pipe;
    });
  }
  return multiModelPromise;
}

async function getLangDetector() {
  if (!langDetectorPromise) {
    langDetectorPromise = import('@xenova/transformers').then(async ({ pipeline }) => {
      // Using a small langid model; adjust to your preferred detector
      const detector = await pipeline('text-classification', 'Xenova/fasttext-language-identification');
      return detector;
    });
  }
  return langDetectorPromise;
}

async function detectLanguage(text) {
  try {
    const detector = await getLangDetector();
    const res = await detector(text, { topk: 1, truncation: true });
    const top = res?.[0];
    return { lang: top?.label || 'unknown', langScore: top?.score || 0 };
  } catch (err) {
    console.error('[electron] lang detect failed', err?.message);
    return { lang: 'unknown', langScore: 0 };
  }
}

async function classifyMultilingual(text) {
  const sanitized = (text || '').replace(/\s+/g, ' ').trim();
  const classifier = await getMultilingualClassifier();
  const outputs = await classifier(sanitized, { topk: 3, truncation: true });
  const top = outputs[0];
  const score = top?.score ?? 0;
  let severity = 'low';
  if (score >= 0.35) severity = 'high';
  else if (score >= 0.18) severity = 'medium';
  const rationale = `Multi model: ${top?.label || 'unknown'} (${score.toFixed(2)})`;
  return { severity, rationale, score };
}

async function classifyWithGemini(text, langHint) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[electron] Gemini API key not set');
    throw new Error('Gemini API key not set');
  }
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const prompt = `Classify the following message for cyberbullying/toxicity.\nRespond strictly with JSON: {"severity":"low|medium|high","rationale":"..."}.\nLanguage hint: ${langHint || 'unknown'}\nMessage: ${text}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    safetySettings: [],
  };
  console.log('[electron] Calling Gemini', { model, langHint });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let severity = 'low';
  let rationale = rawText.slice(0, 200);
  try {
    const parsed = JSON.parse(rawText);
    severity = (parsed.severity || severity).toLowerCase();
    rationale = parsed.rationale || rationale;
  } catch {
    const sevMatch = rawText.match(/(low|medium|high)/i);
    if (sevMatch) severity = sevMatch[1].toLowerCase();
  }
  console.log('[electron] Gemini result', { severity, rationale: rationale.slice(0, 80) });
  return { severity, rationale: `Gemini: ${rationale}`, score: 0.5 };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function createTray() {
  // Minimal inline icon to avoid missing-asset issues.
  const base64Icon =
    'iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAK0lEQVQoka3PMQ0AMAgEsf//M9qG2kWMTMmizAxp8qeP6YEqKBJEAEpBJEAEjtcAytzfcM7AAAAAElFTkSuQmCC';
  const trayIcon = nativeImage.createFromDataURL(`data:image/png;base64,${base64Icon}`);

  tray = new Tray(trayIcon);

  const menu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setToolTip('Cyberbullying Watch');
  tray.setContextMenu(menu);
  tray.on('click', () => mainWindow?.show());
}

function showIncidentNotification(incident) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: `Alert: ${incident.severity || 'medium'} risk`,
    body: incident.snippet || 'Potential bullying detected.',
  });
  n.show();
}

function ensureDb() {
  const dbPath = path.join(app.getPath('userData'), 'cyberwatch.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      source TEXT,
      snippet TEXT,
      severity TEXT,
      timestamp TEXT,
      rationale TEXT,
      score REAL,
      scorer TEXT,
      lang TEXT,
      lang_score REAL,
      raw TEXT,
      synced INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS auth_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  
  // Migration: Add score column if it doesn't exist (for existing databases)
  try {
    database.exec(`ALTER TABLE incidents ADD COLUMN score REAL DEFAULT 0;`);
  } catch (err) {
    // Column already exists, ignore
  }
  try {
    database.exec(`ALTER TABLE incidents ADD COLUMN scorer TEXT DEFAULT 'rules';`);
  } catch (err) {
    // Column already exists, ignore
  }
  try {
    database.exec(`ALTER TABLE incidents ADD COLUMN lang TEXT;`);
  } catch (err) {
    // Column already exists, ignore
  }
  try {
    database.exec(`ALTER TABLE incidents ADD COLUMN lang_score REAL DEFAULT 0;`);
  } catch (err) {
    // Column already exists, ignore
  }
  try {
    database.exec(`ALTER TABLE incidents ADD COLUMN synced INTEGER DEFAULT 0;`);
  } catch (err) {
    // Column already exists, ignore
  }
  try {
    database.exec(`ALTER TABLE incidents ADD COLUMN screenshot_url TEXT;`);
  } catch (err) {
    // Column already exists, ignore
  }
  
  return database;
}

async function captureAndUploadScreenshot(incidentId) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[screenshot] No user logged in, skipping screenshot');
      return null;
    }

    // Take screenshot
    const screenshotBuffer = await screenshot({ format: 'png' });
    console.log('[screenshot] Screenshot captured, size:', screenshotBuffer.length, 'bytes');

    // Upload to Supabase Storage
    const fileName = `${user.id}/${incidentId}-${Date.now()}.png`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('incident-screenshots')
      .upload(fileName, screenshotBuffer, {
        contentType: 'image/png',
        upsert: false
      });

    if (uploadError) {
      console.error('[screenshot] Upload error:', uploadError);
      if (uploadError.message?.includes('Bucket not found')) {
        console.log('[screenshot] Bucket not found. Please create the "incident-screenshots" bucket in Supabase Dashboard.');
      } else if (uploadError.statusCode === '403' || uploadError.message?.includes('row-level security')) {
        console.error('[screenshot] RLS policy violation. Please run the storage policies migration:');
        console.error('[screenshot] Run backend/supabase/migrations/005_setup_screenshot_storage.sql in Supabase SQL Editor');
      }
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('incident-screenshots')
      .getPublicUrl(fileName);

    console.log('[screenshot] Screenshot uploaded successfully:', urlData.publicUrl);
    return urlData.publicUrl;
  } catch (err) {
    console.error('[screenshot] Error capturing/uploading screenshot:', err?.message);
    return null;
  }
}

function saveIncident(incident) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO incidents (id, source, snippet, severity, timestamp, rationale, score, scorer, lang, lang_score, raw, synced, screenshot_url)
    VALUES (@id, @source, @snippet, @severity, @timestamp, @rationale, @score, @scorer, @lang, @lang_score, @raw, 0, @screenshot_url);
  `);
  stmt.run({
    id: incident.id,
    source: incident.source,
    snippet: incident.snippet,
    severity: incident.severity,
    timestamp: incident.timestamp,
    rationale: incident.rationale || '',
    score: incident.score || 0,
    scorer: incident.scorer || 'rules',
    lang: incident.lang || 'unknown',
    lang_score: incident.langScore || 0,
    raw: JSON.stringify(incident),
    screenshot_url: incident.screenshot_url || null,
  });
  
  if (incident.screenshot_url) {
    console.log('[saveIncident] Saved incident with screenshot_url:', incident.screenshot_url);
  }
}

function loadRecentIncidents(limit = 50) {
  try {
    const rows = db
      .prepare(
        `SELECT id, source, snippet, severity, timestamp, rationale, 
         COALESCE(score, 0) as score, 
         COALESCE(scorer, 'rules') as scorer, 
         lang, 
         COALESCE(lang_score, 0) as lang_score 
         FROM incidents ORDER BY timestamp DESC LIMIT ?;`
      )
      .all(limit);
    return rows;
  } catch (err) {
    console.error('[electron] Error loading incidents:', err);
    // Fallback query without optional columns
    try {
      const rows = db
        .prepare(
          `SELECT id, source, snippet, severity, timestamp, rationale FROM incidents ORDER BY timestamp DESC LIMIT ?;`
        )
        .all(limit);
      // Add default values for missing columns
      return rows.map(row => ({
        ...row,
        score: 0,
        scorer: 'rules',
        lang: 'unknown',
        lang_score: 0
      }));
    } catch (fallbackErr) {
      console.error('[electron] Fallback query also failed:', fallbackErr);
      return [];
    }
  }
}

function getUnsyncedIncidents() {
  // Only high and medium severity incidents are synced
  try {
    const rows = db
      .prepare(
        `SELECT id, source, snippet, severity, timestamp, rationale, 
         COALESCE(score, 0) as score, 
         COALESCE(scorer, 'rules') as scorer, 
         lang, 
         COALESCE(lang_score, 0) as lang_score,
         screenshot_url,
         raw 
         FROM incidents WHERE synced = 0 AND severity IN ('high', 'medium') ORDER BY timestamp ASC;`
      )
      .all();
    return rows;
  } catch (err) {
    console.error('[electron] Error loading unsynced incidents:', err);
    return [];
  }
}

function markIncidentSynced(id) {
  const stmt = db.prepare(`UPDATE incidents SET synced = 1 WHERE id = ?;`);
  stmt.run(id);
}

async function syncIncidentsToSupabase() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[sync] No user logged in, skipping sync');
      return;
    }

    const unsynced = getUnsyncedIncidents();
    if (unsynced.length === 0) {
      return;
    }

    console.log(`[sync] Syncing ${unsynced.length} incidents to Supabase`);

    const incidentsToInsert = unsynced.map((inc) => ({
      kid_id: user.id,
      source: inc.source,
      snippet: inc.snippet,
      severity: inc.severity,
      score: inc.score || 0,
      scorer: inc.scorer || 'rules',
      lang: inc.lang || 'unknown',
      lang_score: inc.lang_score || 0,
      rationale: inc.rationale || '',
      timestamp: inc.timestamp,
      screenshot_url: inc.screenshot_url || null,
    }));

    // Log screenshot URLs being synced
    const withScreenshots = incidentsToInsert.filter(inc => inc.screenshot_url);
    if (withScreenshots.length > 0) {
      console.log(`[sync] Syncing ${withScreenshots.length} incidents with screenshots`);
      withScreenshots.forEach(inc => {
        console.log(`[sync] Incident ${inc.id} screenshot_url: ${inc.screenshot_url}`);
      });
    }

    const { data, error } = await supabase.from('incidents').insert(incidentsToInsert).select();

    if (error) {
      console.error('[sync] Failed to sync incidents:', error);
      if (error.message?.includes('screenshot_url') || error.message?.includes('column')) {
        console.error('[sync] ERROR: screenshot_url column might not exist in Supabase incidents table!');
        console.error('[sync] Please run migration: backend/supabase/migrations/004_add_screenshot_url.sql');
      }
      return;
    }
    
    // Verify screenshot_url was synced
    if (data && data.length > 0) {
      const syncedWithScreenshots = data.filter(inc => inc.screenshot_url);
      if (syncedWithScreenshots.length > 0) {
        console.log(`[sync] Successfully synced ${syncedWithScreenshots.length} incidents with screenshots`);
      } else if (withScreenshots.length > 0) {
        console.warn(`[sync] WARNING: ${withScreenshots.length} incidents had screenshots locally but none were synced!`);
        console.warn('[sync] This might mean the screenshot_url column is missing in Supabase');
      }
    }

    // Mark as synced
    unsynced.forEach((inc) => markIncidentSynced(inc.id));
    console.log(`[sync] Successfully synced ${data.length} incidents`);
  } catch (err) {
    console.error('[sync] Sync error:', err?.message);
  }
}

async function classifyText(text) {
  const sanitized = (text || '').replace(/\s+/g, ' ').trim();
  const lowered = sanitized.toLowerCase();
  const fallbackHigh = [
    'fuck',
    'fucking',
    'kill you',
    'kill yourself',
    'go die',
    'suicide',
    'hate you',
    'stupid',
    'idiot',
    'loser',
    'shut up',
    'fat ass',
    'you are fat',
    'youre fat',
    'fatty',
    'slut',
    'whore',
    'bitch',
    'retard',
    'asshole',
    'gay',
  ];
  const fallbackMedium = ['annoying', 'dumb', 'ugly', 'fat', 'trash', 'lame', 'ass'];

  // Detect language
  let langInfo = await detectLanguage(sanitized);

  const matchedHigh = fallbackHigh.find((k) => lowered.includes(k));
  const matchedMed = fallbackMedium.find((k) => lowered.includes(k));

  // Try Gemini first if key present
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (hasGemini) {
    try {
      console.log('[electron] Calling Gemini with lang', langInfo.lang);
      const gemResult = await classifyWithGemini(sanitized, langInfo.lang);
      gemResult.lang = langInfo.lang;
      gemResult.langScore = langInfo.langScore;
      gemResult.scorer = 'gemini';
      return gemResult;
    } catch (err) {
      console.error('[electron] Gemini classify failed, falling back', err?.message);
    }
  } else {
    console.warn('[electron] Skipping Gemini (no API key)');
  }

  // Multilingual local
  try {
    const localResult = await classifyMultilingual(sanitized);
    localResult.lang = langInfo.lang;
    localResult.langScore = langInfo.langScore;
    localResult.scorer = 'multilingual';
    return localResult;
  } catch (err) {
    console.error('[electron] multilingual classify failed, fallback to base', err?.message);
    try {
      const classifier = await getClassifier();
      const outputs = await classifier(sanitized, { topk: 3, truncation: true });
      const top = outputs[0];
      const score = top?.score ?? 0;
      let severity = 'low';
      if (score >= 0.35) severity = 'high';
      else if (score >= 0.18) severity = 'medium';
      const rationale = `Model: ${top?.label || 'unknown'} (${score.toFixed(2)})`;
      return { severity, rationale, score, lang: langInfo.lang, langScore: langInfo.langScore, scorer: 'base' };
    } catch (err2) {
      console.error('[electron] base model classify failed, using fallback', err2?.message);
    }
  }

  // Fallback rules
  if (matchedHigh) {
    return { severity: 'high', rationale: `Matched high-risk keyword: ${matchedHigh}`, score: 0.9, lang: langInfo.lang, langScore: langInfo.langScore, scorer: 'rules' };
  }
  if (matchedMed) {
    return { severity: 'medium', rationale: `Matched medium-risk keyword: ${matchedMed}`, score: 0.5, lang: langInfo.lang, langScore: langInfo.langScore, scorer: 'rules' };
  }
  return { severity: 'low', rationale: 'No risk keywords found', score: 0.1, lang: langInfo.lang, langScore: langInfo.langScore, scorer: 'rules' };
}

function broadcastIncident(incident) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('incident', incident);
  }
  showIncidentNotification(incident);
}

function notifyModelStatus() {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('model:status', modelStatus);
  }
}

function startIngestServer() {
  server = Fastify({ logger: false });

  server.get('/health', async () => ({ status: 'ok' }));

  server.post('/ingest', async (request, reply) => {
    const { text, source, timestamp } = request.body || {};
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed || trimmed.length < 6) {
      reply.code(200).send({ status: 'ignored', reason: 'too_short' });
      return;
    }
    let severity = 'low';
    let rationale = 'No risk keywords found';
    let score = 0;
    let scorer = 'rules';
    let lang = 'unknown';
    let langScore = 0;
    try {
      const result = await classifyText(trimmed);
      severity = result.severity;
      rationale = result.rationale;
      score = result.score ?? 0;
      scorer = result.scorer || 'rules';
      lang = result.lang || 'unknown';
      langScore = result.langScore || 0;
    } catch (err) {
      console.error('[electron] classify failed', err?.message);
    }
    const incidentId = uuidv4();
    const incident = {
      id: incidentId,
      source: source || 'Unknown app',
      snippet: trimmed.slice(0, 280),
      severity,
      timestamp: timestamp || new Date().toISOString(),
      rationale,
      score,
      scorer,
      lang,
      langScore,
      screenshot_url: null,
    };

    // Capture screenshot for high or medium severity incidents
    if (severity === 'high' || severity === 'medium') {
      console.log(`[screenshot] Capturing screenshot for ${severity} severity incident`);
      const screenshotUrl = await captureAndUploadScreenshot(incidentId);
      if (screenshotUrl) {
        incident.screenshot_url = screenshotUrl;
        console.log(`[screenshot] Screenshot URL assigned to incident: ${screenshotUrl}`);
      } else {
        console.log(`[screenshot] No screenshot URL returned for incident ${incidentId}`);
      }
    }

    // Save incident with screenshot_url
    console.log(`[ingest] Saving incident ${incidentId} with screenshot_url: ${incident.screenshot_url || 'null'}`);
    saveIncident(incident);
    
    // Verify it was saved
    const verifyStmt = db.prepare('SELECT screenshot_url FROM incidents WHERE id = ?');
    const saved = verifyStmt.get(incidentId);
    console.log(`[ingest] Verified saved screenshot_url in DB: ${saved?.screenshot_url || 'null'}`);
    
    broadcastIncident(incident);
    reply.send({ status: 'ok', id: incident.id, severity, score, screenshot_url: incident.screenshot_url });
  });

  server
    .listen({ port: INGEST_PORT, host: '127.0.0.1' })
    .then(() => {
      console.log(`[electron] Ingest server listening on 127.0.0.1:${INGEST_PORT}`);
    })
    .catch((err) => {
      console.error('[electron] Failed to start ingest server', err);
    });
}

app.whenReady().then(async () => {
  db = ensureDb();
  startIngestServer();
  createWindow();
  createTray();

  // Check auth state on startup
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    console.log('[auth] User logged in:', user.email);
    // Start sync job
    setInterval(syncIncidentsToSupabase, 5 * 60 * 1000); // Every 5 minutes
    syncIncidentsToSupabase(); // Initial sync
  } else {
    console.log('[auth] No user logged in');
  }

  ipcMain.on('renderer-ready', () => {
    mainWindowReady = true;
    const recent = loadRecentIncidents(100);
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('incidents:init', recent);
      notifyModelStatus();
    }
  });

  ipcMain.handle('incident:notify', (_event, incident) => {
    showIncidentNotification(incident);
  });

  ipcMain.handle('incidents:fetch', () => {
    return loadRecentIncidents(100);
  });

  // Auth handlers
  ipcMain.handle('auth:signup', async (_event, { email, password }) => {
    try {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { success: false, error: 'Supabase not configured. Please add SUPABASE_URL and SUPABASE_ANON_KEY to .env' };
      }
      const { data, error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: {
          emailRedirectTo: undefined, // No redirect needed for desktop app
        }
      });
      if (error) {
        console.error('[auth] Signup error:', error);
        // Handle specific errors
        if (error.message.includes('already registered') || error.message.includes('User already registered')) {
          return { success: false, error: 'This email is already registered. Please sign in instead.' };
        }
        if (error.message.includes('Email rate limit')) {
          return { success: false, error: 'Too many signup attempts. Please wait a moment.' };
        }
        if (error.message.includes('Anonymous sign-ins')) {
          return { success: false, error: 'Email/password signup is disabled. Please contact support or check Supabase settings.' };
        }
        return { success: false, error: error.message || 'Sign up failed' };
      }
      // Create or update profile role to 'kid' if user was created
      if (data.user) {
        try {
          // Use upsert to create if doesn't exist, update if exists
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
              id: data.user.id,
              email: data.user.email,
              role: 'kid',
            }, {
              onConflict: 'id'
            });
          if (profileError) {
            console.error('[auth] Profile upsert error:', profileError);
          } else {
            console.log('[auth] Profile created/updated for kid:', data.user.email);
          }
        } catch (profileError) {
          console.error('[auth] Profile upsert exception:', profileError);
        }
      }
      return { success: true, user: data.user, needsVerification: !data.session };
    } catch (err) {
      console.error('[auth] Signup exception:', err);
      return { success: false, error: err.message || 'Sign up failed' };
    }
  });

  ipcMain.handle('auth:signin', async (_event, { email, password }) => {
    try {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        return { success: false, error: 'Supabase not configured. Please add SUPABASE_URL and SUPABASE_ANON_KEY to .env' };
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      
      // Ensure profile exists (create if missing)
      if (data.user) {
        try {
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
              id: data.user.id,
              email: data.user.email,
              role: 'kid',
            }, {
              onConflict: 'id'
            });
          if (profileError) {
            console.error('[auth] Profile upsert error on signin:', profileError);
          }
        } catch (profileError) {
          console.error('[auth] Profile upsert exception on signin:', profileError);
        }
      }
      
      // Start sync job
      setInterval(syncIncidentsToSupabase, 5 * 60 * 1000);
      syncIncidentsToSupabase();
      return { success: true, user: data.user };
    } catch (err) {
      console.error('[auth] Signin error:', err);
      return { success: false, error: err.message || 'Sign in failed' };
    }
  });

  ipcMain.handle('auth:signout', async () => {
    try {
      await supabase.auth.signOut();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:getUser', async () => {
    try {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        console.warn('[auth] Supabase not configured, returning null user');
        return null;
      }
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) {
        console.error('[auth] Get user error:', error.message);
        return null;
      }
      if (user) {
        console.log('[auth] User found:', user.email);
      } else {
        console.log('[auth] No user logged in');
      }
      return user;
    } catch (err) {
      console.error('[auth] Get user exception:', err?.message);
      return null;
    }
  });

  ipcMain.handle('sync:trigger', async () => {
    await syncIncidentsToSupabase();
    return { success: true };
  });

  // Parent-Kid Linking handlers
  ipcMain.handle('links:getPending', async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[links] No user, returning empty');
        return { success: false, links: [] };
      }

      console.log('[links] Getting pending links for kid:', user.id);
      const { data, error } = await supabase
        .from('parent_kid_links')
        .select('id, parent_id, status, created_at, profiles!parent_kid_links_parent_id_fkey(email, display_name)')
        .eq('kid_id', user.id)
        .eq('status', 'pending');

      if (error) {
        console.error('[links] Query error:', error);
        throw error;
      }
      
      console.log('[links] Found pending links:', data?.length || 0, data);
      return { success: true, links: data || [] };
    } catch (err) {
      console.error('[links] Get pending error:', err);
      return { success: false, links: [], error: err.message };
    }
  });

  ipcMain.handle('links:accept', async (_event, linkId) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[links] Accept: No user logged in');
        return { success: false, error: 'Not logged in' };
      }

      console.log('[links] Accepting link:', linkId, 'for kid:', user.id);
      
      // First check if link exists
      const { data: existingLink, error: checkError } = await supabase
        .from('parent_kid_links')
        .select('id, status, kid_id')
        .eq('id', linkId)
        .eq('kid_id', user.id)
        .single();
      
      console.log('[links] Existing link check:', { existingLink, checkError });
      
      if (checkError || !existingLink) {
        return { success: false, error: 'Link not found' };
      }
      
      if (existingLink.status !== 'pending') {
        return { success: false, error: `Link is already ${existingLink.status}` };
      }
      
      // Now update it - don't filter by status in the update, RLS will handle it
      const { data, error } = await supabase
        .from('parent_kid_links')
        .update({ 
          status: 'active',
          linked_at: new Date().toISOString()
        })
        .eq('id', linkId)
        .select();

      if (error) {
        console.error('[links] Accept update error:', error);
        return { success: false, error: error.message || 'Failed to update link. Please run FIX_ACCEPT_LINK.sql in Supabase.' };
      }
      
      if (!data || data.length === 0) {
        console.log('[links] No rows updated - RLS may be blocking the update');
        return { success: false, error: 'Update failed. Please run FIX_ACCEPT_LINK.sql in Supabase SQL Editor to fix RLS policies.' };
      }
      
      console.log('[links] Link accepted successfully:', data[0]);
      return { success: true };
    } catch (err) {
      console.error('[links] Accept exception:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('links:reject', async (_event, linkId) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { success: false, error: 'Not logged in' };

      // First check if link exists
      const { data: existingLink, error: checkError } = await supabase
        .from('parent_kid_links')
        .select('id, status, kid_id')
        .eq('id', linkId)
        .single();
      
      if (checkError || !existingLink || existingLink.kid_id !== user.id) {
        return { success: false, error: 'Link not found or unauthorized' };
      }
      
      if (existingLink.status !== 'pending') {
        return { success: false, error: `Link is already ${existingLink.status}` };
      }
      
      // Now delete it
      const { data, error } = await supabase
        .from('parent_kid_links')
        .delete()
        .eq('id', linkId)
        .select();

      if (error) {
        console.error('[links] Reject delete error:', error);
        return { success: false, error: error.message || 'Failed to delete link. Please run FIX_ACCEPT_LINK.sql in Supabase.' };
      }
      
      if (!data || data.length === 0) {
        return { success: false, error: 'Delete failed. Please run FIX_ACCEPT_LINK.sql in Supabase SQL Editor.' };
      }
      
      return { success: true };
    } catch (err) {
      console.error('[links] Reject error:', err);
      return { success: false, error: err.message };
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows.
  if (process.platform !== 'darwin') {
    // Do not quit; keep background service alive.
  }
});


