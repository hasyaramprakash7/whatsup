document.addEventListener('DOMContentLoaded', () => {
  const API = '/api';
  const $ = (sel) => document.querySelector(sel);

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  let tenants = [];

  // --- PERSISTENT LOGGING SYSTEM (localStorage) ---
  const LOG_KEY = 'whatsapp_engine_logs';
  const MAX_LOGS = 200; // Keep last 200 logs to prevent storage bloat

  function getStoredLogs() {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveLogsToStorage(logs) {
    // Keep only the last 200 logs
    const trimmedLogs = logs.slice(-MAX_LOGS);
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmedLogs));
  }

  function renderLogLine(logObj) {
    const consoleEl = $('#log-console');
    if (!consoleEl) return;
    
    const div = document.createElement('div');
    div.className = `log-line log-${logObj.type}`;
    div.innerHTML = `<span class="log-time">[${logObj.time}]</span> ${escapeHtml(logObj.message)}`;
    consoleEl.appendChild(div);
  }

  function logToUI(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const logObj = { time, message, type };
    
    // 1. Save to local storage
    const logs = getStoredLogs();
    logs.push(logObj);
    saveLogsToStorage(logs);

    // 2. Render to screen
    renderLogLine(logObj);
    
    // 3. Auto-scroll
    const consoleEl = $('#log-console');
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function loadLogsFromStorage() {
    const consoleEl = $('#log-console');
    consoleEl.innerHTML = ''; // Clear current
    
    const logs = getStoredLogs();
    if (logs.length === 0) {
      logToUI('Dashboard initialized. Waiting for actions...', 'info');
    } else {
      logs.forEach(renderLogLine);
      // Scroll to bottom after loading
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  }

  // Clear Logs Button
  $('#clear-logs').addEventListener('click', () => {
    localStorage.removeItem(LOG_KEY);
    $('#log-console').innerHTML = '';
    logToUI('Logs cleared from browser storage.', 'info');
  });

  // Global Click Logger
  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
      const btn = e.target.tagName === 'BUTTON' ? e.target : e.target.closest('button');
      // Ignore the clear logs button to avoid spamming the log with itself
      if (btn.id !== 'clear-logs') {
        logToUI(`Clicked button: "${btn.textContent.trim()}"`, 'debug');
      }
    }
  });
  // ------------------------------------------------

  // --- AUTH ---
  // Key lives in sessionStorage: survives reloads, cleared when the tab closes.
  const KEY_STORAGE = 'whatsapp_engine_api_key';
  const getKey = () => { try { return sessionStorage.getItem(KEY_STORAGE); } catch { return null; } };
  const setKey = (k) => { try { k ? sessionStorage.setItem(KEY_STORAGE, k) : sessionStorage.removeItem(KEY_STORAGE); } catch {} };
  let auth = null; // { role: 'admin' } | { role: 'tenant', tenantId, businessName }

  function showLogin(message = '') {
    setKey(null);
    auth = null;
    $('#app').hidden = true;
    $('#logout').hidden = true;
    $('#whoami').textContent = '';
    $('#login-card').hidden = false;
    $('#login-msg').textContent = message;
    $('#login-msg').className = message ? 'msg error' : 'msg';
    $('#api-key').focus();
  }

  // Wraps fetch with the auth header; a 401 sends the user back to the login screen.
  async function authFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${getKey()}` } });
    if (res.status === 401) {
      showLogin('Session expired or key invalid. Please sign in again.');
      throw new Error('Not signed in');
    }
    return res;
  }

  async function jsonFetch(url, opts = {}) {
    const res = await authFetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function startSession() {
    try {
      ({ auth } = await jsonFetch(`${API}/tenants/me`));
    } catch {
      return; // authFetch already showed the login screen on 401
    }
    const isAdmin = auth.role === 'admin';
    document.querySelectorAll('.admin-only').forEach((el) => { el.hidden = !isAdmin; });
    $('#whoami').textContent = isAdmin ? 'Admin' : auth.businessName;
    $('#login-card').hidden = true;
    $('#logout').hidden = false;
    $('#app').hidden = false;
    logToUI(`Signed in as ${isAdmin ? 'admin' : auth.businessName}.`, 'success');
    loadTenants();
    if (!isAdmin) loadLeads(auth.tenantId);
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setKey($('#api-key').value.trim());
    $('#api-key').value = '';
    startSession();
  });

  $('#logout').addEventListener('click', () => {
    logToUI('Signed out.', 'info');
    showLogin();
  });
  // ------------------------------------------------

  async function checkHealth() {
    const badge = $('#health');
    try {
      const res = await fetch('/health');
      if (res.ok) {
        badge.textContent = 'System Online';
        badge.className = 'badge ok';
        logToUI('Backend health check passed. Connected to API.', 'success');
      } else throw new Error();
    } catch {
      badge.textContent = 'System Offline';
      badge.className = 'badge bad';
      logToUI('Backend health check failed. Server is unreachable.', 'error');
    }
  }

  async function loadTenants() {
    try {
      logToUI('Fetching active tenants from database...', 'info');
      const { data } = await jsonFetch(`${API}/tenants`);
      tenants = data;
      renderTenants();
      renderTenantSelect();
      logToUI(`Loaded ${tenants.length} tenant(s) successfully.`, 'success');
    } catch (err) {
      $('#tenants').innerHTML = `<em class="msg error">Error: ${err.message}</em>`;
      logToUI(`Failed to load tenants: ${err.message}`, 'error');
    }
  }

  function renderTenants() {
    const el = $('#tenants');
    if (!tenants.length) {
      el.innerHTML = '<em>No tenants yet. Create one above.</em>';
      return;
    }
    el.innerHTML = tenants.map((t) => `
      <div class="row">
        <div>
          <strong>${escapeHtml(t.businessName)}</strong>
          <small>
            Tier ${t.tier ?? 0} · ${escapeHtml(t.projectDetails?.projectName || '')} · PhoneID ${escapeHtml(t.phoneNumberId)}
            ${t.projectDetails?.brochurePdfUrl
              ? `· <a href="${escapeHtml(t.projectDetails.brochurePdfUrl)}" target="_blank" rel="noopener">View Brochure</a>`
              : '· <span style="color:#b45309">No brochure attached</span>'}
          </small>
        </div>
        <button data-tenant="${t._id}" class="btn-secondary view-leads">View Leads</button>
      </div>
    `).join('');

    el.querySelectorAll('.view-leads').forEach((b) =>
      b.addEventListener('click', () => loadLeads(b.dataset.tenant))
    );
  }

  function renderTenantSelect() {
    const sel = $('#tenant-select');
    sel.innerHTML = tenants.map((t) => 
      `<option value="${t._id}">${escapeHtml(t.businessName)} — ${escapeHtml(t.projectDetails?.projectName || '')}</option>`
    ).join('');
  }

  $('#tenant-form').addEventListener('submit', async (e) => {
    e.preventDefault(); 
    
    const msgEl = $('#tenant-msg');
    msgEl.textContent = '⏳ Creating tenant...';
    msgEl.className = 'msg';
    logToUI('Initiating tenant creation sequence...', 'warn');

    const f = new FormData(e.target);
    const brochureFile = $('#brochure-file').files[0];

    const payload = {
      businessName: f.get('businessName'),
      phoneNumberId: f.get('phoneNumberId'),
      wabaId: f.get('wabaId'),
      accessToken: f.get('accessToken'),
      adminNotificationPhone: f.get('adminNotificationPhone'),
      tier: Number(f.get('tier')) || 0,
      projectDetails: {
        projectName: f.get('projectName'),
        latitude: Number(f.get('latitude')),
        longitude: Number(f.get('longitude')),
        siteAddress: f.get('siteAddress'),
      },
    };

    try {
      logToUI('Sending tenant data to backend API...', 'info');
      const createRes = await jsonFetch(`${API}/tenants`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const tenant = createRes.tenant;
      const newApiKey = createRes.apiKey;
      logToUI(`Tenant '${tenant.businessName}' created in MongoDB.`, 'success');

      if (brochureFile) {
        msgEl.textContent = '⏳ Uploading brochure to Cloudflare R2...';
        logToUI('Brochure selected. Uploading to R2 bucket...', 'warn');
        
        const fd = new FormData();
        fd.append('file', brochureFile);
        const uploadRes = await authFetch(`${API}/uploads/brochure/${tenant._id}`, {
          method: 'POST',
          body: fd,
        });
        const uploadData = await uploadRes.json();
        
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Brochure upload failed');
        logToUI(`Brochure uploaded to R2. URL generated.`, 'success');
      }

      // Show the client's key once; it is never retrievable again (only its hash is stored).
      msgEl.innerHTML = `✅ Tenant successfully created! Give this API key to the client now. It will not be shown again:
        <code class="api-key-reveal">${escapeHtml(newApiKey)}</code>`;
      msgEl.className = 'msg success';
      logToUI('Tenant onboarding complete. API key issued.', 'success');

      e.target.reset();
      loadTenants();
    } catch (err) {
      msgEl.textContent = '❌ ' + err.message;
      msgEl.className = 'msg error';
      logToUI(`Error creating tenant: ${err.message}`, 'error');
    }
  });

  $('#upload-form').addEventListener('submit', async (e) => {
    e.preventDefault(); 
    
    const msgEl = $('#upload-msg');
    msgEl.textContent = '⏳ Uploading CSV...';
    msgEl.className = 'msg';

    const tenantId = $('#tenant-select').value;
    const file = $('#csv-file').files[0];
    if (!tenantId || !file) return;

    logToUI(`Starting CSV broadcast upload for tenant ${tenantId}...`, 'warn');
    const fd = new FormData();
    fd.append('file', file);

    try {
      const res = await authFetch(`${API}/leads/upload/${tenantId}`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      msgEl.innerHTML = `✅ ${data.message}<br><small>${JSON.stringify(data.summary)}</small>`;
      msgEl.className = 'msg success';
      
      logToUI(`CSV processed. ${data.summary.enqueued} jobs added to BullMQ queue.`, 'success');
      
      loadLeads(tenantId);
      loadQueueStats();
    } catch (err) {
      msgEl.textContent = '❌ ' + err.message;
      msgEl.className = 'msg error';
      logToUI(`Broadcast error: ${err.message}`, 'error');
    }
  });

  async function loadQueueStats() {
    const el = $('#queue-stats');
    el.innerHTML = '<em>Loading...</em>';
    logToUI('Requesting BullMQ queue metrics...', 'info');
    
    try {
      const { stats } = await jsonFetch(`${API}/leads/queue/stats`);
      el.innerHTML = `
        <div class="row"><span>Waiting</span><strong>${stats.waiting}</strong></div>
        <div class="row"><span>Active</span><strong>${stats.active}</strong></div>
        <div class="row"><span>Completed</span><strong>${stats.completed}</strong></div>
        <div class="row"><span>Failed</span><strong>${stats.failed}</strong></div>
        <div class="row"><span>Delayed</span><strong>${stats.delayed}</strong></div>
      `;
      logToUI(`Queue stats updated. Waiting: ${stats.waiting}, Active: ${stats.active}, Completed: ${stats.completed}`, 'info');
    } catch (err) {
      el.innerHTML = `<em class="msg error">Error: ${err.message}</em>`;
      logToUI(`Failed to load queue stats: ${err.message}`, 'error');
    }
  }

  async function loadLeads(tenantId) {
    const el = $('#leads');
    el.innerHTML = '<em>Loading leads...</em>';
    logToUI(`Fetching lead database for tenant ${tenantId}...`, 'info');
    
    try {
      const { data } = await jsonFetch(`${API}/leads/${tenantId}`);
      
      if (!data.length) {
        el.innerHTML = '<em>No leads found for this tenant.</em>';
        logToUI('Zero leads found for this tenant.', 'warn');
        return;
      }

      el.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Phone</th><th>Config</th><th>Budget</th><th>Visit Slot</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${data.map((l) => `
              <tr>
                <td>${escapeHtml(l.name)}</td>
                <td>+${escapeHtml(l.phone)}</td>
                <td>${escapeHtml(l.configuration)}</td>
                <td>${escapeHtml(l.budget)}</td>
                <td>${escapeHtml(l.visitSlot || '—')}</td>
                <td><span class="pill ${l.status.toLowerCase()}">${escapeHtml(l.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      logToUI(`Rendered ${data.length} leads in table.`, 'success');
    } catch (err) {
      el.innerHTML = `<em class="msg error">Error: ${err.message}</em>`;
      logToUI(`Failed to load leads: ${err.message}`, 'error');
    }
  }

  $('#refresh-tenants').addEventListener('click', loadTenants);
  $('#refresh-stats').addEventListener('click', loadQueueStats);

  // --- INITIALIZE ---
  loadLogsFromStorage(); // Load saved logs first
  checkHealth();
  if (getKey()) startSession(); else showLogin();
});