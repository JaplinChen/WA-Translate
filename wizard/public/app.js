const els = {
  gemini: document.getElementById('gemini'),
  waAdmin: document.getElementById('waAdmin'),
  waGroup: document.getElementById('waGroup'),
  waStatus: document.getElementById('waStatus'),
  waQr: document.getElementById('waQr'),
  groupList: document.getElementById('groupList'),
  groupSearch: document.getElementById('groupSearch'),
  selectedGroupStatus: document.getElementById('selectedGroupStatus'),
  pairSrc: document.getElementById('pairSrc'),
  pairDst: document.getElementById('pairDst'),
  pairList: document.getElementById('pairList'),
  pairValidation: document.getElementById('pairValidation'),
  includeFromMe: document.getElementById('includeFromMe'),
  saveMsg: document.getElementById('saveMsg'),
  applyConfig: document.getElementById('applyConfig'),
  applySummary: document.getElementById('applySummary'),
  applyDoneActions: document.getElementById('applyDoneActions'),
  editAgain: document.getElementById('editAgain'),
  geminiHint: document.getElementById('geminiHint'),
  sessionId: document.getElementById('sessionId'),
  addPairBtn: document.getElementById('addPair'),
  advancedPairs: document.getElementById('advancedPairs'),
  advancedApply: document.getElementById('advancedApply'),
  quickStatus: document.getElementById('quickStatus'),
  quickConnect: document.getElementById('quickConnect'),
  quickGroups: document.getElementById('quickGroups'),
  quickEnable: document.getElementById('quickEnable')
};

let detectedAdminId = '';
let waReady = false;
let groupLoading = false;
let waStarting = false;
let lastAppliedSignature = '';
let forceEditApply = false;
let allGroups = [];

const pairManager = window.PairManager.createPairManager(els);
const refreshGroupsBtn = document.getElementById('refreshGroups');
const startWaBtn = document.getElementById('startWa');

function setStatus(message, isError = false) {
  els.waStatus.textContent = message;
  els.waStatus.classList.toggle('error', isError);
}

function setQuickStatus(message, isError = false) {
  els.quickStatus.textContent = message;
  els.quickStatus.classList.toggle('error', isError);
}

function pairPayloadOrNull() {
  const payload = pairManager.getPayload();
  return payload.ok ? payload : null;
}

function buildDraftPayload() {
  const pairPayload = pairPayloadOrNull();
  return {
    GEMINI_API_KEYS: els.gemini.value.trim(),
    WHATSAPP_ADMIN_ID: els.waAdmin.value.trim(),
    WHATSAPP_TRANSLATE_GROUP_ID: els.waGroup.value.trim(),
    TRANSLATE_PAIRS: pairPayload ? pairPayload.translatePairs : '',
    DEFAULT_PAIR: pairPayload ? pairPayload.defaultPair : '',
    WHATSAPP_TRANSLATE_INCLUDE_FROM_ME: els.includeFromMe.checked ? 'true' : 'false',
    WHATSAPP_SESSION_CLIENT_ID: els.sessionId.value.trim() || 'wa-translate'
  };
}

function payloadSignature(payload) {
  return JSON.stringify(payload);
}

function isAppliedState() {
  const currentSignature = payloadSignature(buildDraftPayload());
  return currentSignature === lastAppliedSignature && Boolean(lastAppliedSignature);
}

function updateSelectedGroupStatus() {
  const groupId = els.waGroup.value.trim();
  if (!groupId) {
    els.selectedGroupStatus.textContent = '尚未選擇群組';
    return;
  }
  els.selectedGroupStatus.textContent = `已選群組：${groupId}`;
}

function refreshQuickActions() {
  const hasGroup = Boolean(els.waGroup.value.trim());
  const hasPairs = Boolean(pairPayloadOrNull());
  const readyToApply = hasGroup && hasPairs;

  els.quickConnect.disabled = waStarting;
  els.quickGroups.disabled = !waReady || groupLoading;
  els.quickEnable.disabled = !readyToApply;

  if (waStarting) {
    els.quickConnect.textContent = '連線中...';
  } else if (waReady) {
    els.quickConnect.textContent = '1. WhatsApp 已連線';
  } else {
    els.quickConnect.textContent = '1. 連線 WhatsApp';
  }

  els.quickGroups.textContent = hasGroup ? '2. 群組已選擇' : '2. 選擇群組';
  els.quickEnable.textContent = isAppliedState() ? '3. 已啟用完成' : '3. 啟用翻譯';
}

function scrollToSection(id) {
  const section = document.getElementById(id);
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderGroups(groups) {
  els.groupList.innerHTML = '';
  allGroups = Array.isArray(groups) ? groups : [];

  const keyword = String(els.groupSearch ? els.groupSearch.value : '').trim().toLowerCase();
  const visibleGroups = !keyword
    ? allGroups
    : allGroups.filter((group) => {
      const name = String(group.name || '').toLowerCase();
      const id = String(group.id || '').toLowerCase();
      return name.includes(keyword) || id.includes(keyword);
    });
  if (allGroups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'note';
    empty.textContent = '尚無群組，請先完成 WhatsApp 登入。';
    els.groupList.appendChild(empty);
    return;
  }

  if (visibleGroups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'note';
    empty.textContent = '找不到符合條件的群組。';
    els.groupList.appendChild(empty);
    return;
  }

  for (const group of visibleGroups) {
    const row = document.createElement('div');
    row.className = 'group';

    const info = document.createElement('div');
    const name = document.createElement('div');
    const id = document.createElement('div');
    name.textContent = group.name;
    id.className = 'mono';
    id.textContent = group.id;
    info.appendChild(name);
    info.appendChild(id);

    const button = document.createElement('button');
    button.className = 'ghost';
    button.type = 'button';
    button.textContent = '使用';
    button.addEventListener('click', () => {
      els.waGroup.value = group.id;
      updateSelectedGroupStatus();
      refreshQuickActions();
      setQuickStatus(`已選擇群組：${group.name}`);
    });

    row.appendChild(info);
    row.appendChild(button);
    els.groupList.appendChild(row);
  }
}

function refreshGroupFilter() {
  renderGroups(allGroups);
}

async function fetchGroupsAndRender() {
  if (!waReady || groupLoading) return false;
  groupLoading = true;
  refreshQuickActions();
  try {
    const res = await fetch('/api/wa/groups');
    const data = await res.json();
    if (!data.ok) {
      setStatus(data.error || '群組刷新失敗', true);
      setQuickStatus('群組刷新失敗，請稍後重試。', true);
      return false;
    }
    const groups = Array.isArray(data.groups) ? data.groups : [];
    renderGroups(groups);
    setStatus(`WhatsApp 已就緒（已載入 ${groups.length} 個群組）`);
    setQuickStatus('群組清單已更新，請按「使用」選一個群組。');
    return true;
  } catch (err) {
    setStatus(`群組刷新失敗：${err.message}`, true);
    setQuickStatus(`群組刷新失敗：${err.message}`, true);
    return false;
  } finally {
    groupLoading = false;
    refreshQuickActions();
  }
}

async function bootstrapWaReadiness() {
  try {
    const res = await fetch('/api/wa/groups');
    const data = await res.json();
    if (!data.ok) return false;
    waReady = true;
    waStarting = false;
    const groups = Array.isArray(data.groups) ? data.groups : [];
    renderGroups(groups);
    setStatus(`WhatsApp 已就緒（已載入 ${groups.length} 個群組）`);
    setQuickStatus('WhatsApp 已連線，請選擇群組。');
    refreshQuickActions();
    return true;
  } catch (_) {
    return false;
  }
}

async function startWaConnection() {
  if (waStarting) return;
  waStarting = true;
  refreshQuickActions();
  setQuickStatus('正在建立連線，請用手機掃描 QR Code。');
  try {
    const res = await fetch('/api/wa/start', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      setStatus(data.error || '啟動失敗', true);
      setQuickStatus('連線失敗，請重試。', true);
      return;
    }
    if (data.alreadyStarted) {
      if (data.status === 'ready') setStatus('WhatsApp 已就緒');
      else if (data.status === 'waiting_qr') setStatus('已在等待 QR，請掃碼。');
      else setStatus('WhatsApp 已在連線中，請稍候。');
    } else {
      setStatus('已送出連線請求（已自動暫停 bot），請等待或掃描 QR Code。');
    }
  } catch (err) {
    setStatus(`啟動失敗：${err.message}`, true);
    setQuickStatus(`啟動失敗：${err.message}`, true);
  } finally {
    waStarting = false;
    refreshQuickActions();
  }
}

function renderApplyPanel() {
  if (!els.applyConfig || !els.applySummary || !els.applyDoneActions) return;
  const applied = isAppliedState();
  const completeView = applied && !forceEditApply;
  const pairPayload = pairPayloadOrNull();
  const groupId = els.waGroup.value.trim();

  if (completeView) {
    const pairText = pairPayload ? pairPayload.translatePairs : '-';
    els.applyConfig.style.display = 'none';
    els.saveMsg.style.display = 'none';
    els.applySummary.style.display = 'block';
    els.applySummary.textContent = `設定已完成並正在執行中。目標群組：${groupId || '-'}；翻譯方向：${pairText}`;
    els.applyDoneActions.style.display = 'flex';
    return;
  }

  els.applyConfig.style.display = 'block';
  els.applySummary.style.display = 'none';
  els.applyDoneActions.style.display = 'none';
}

async function saveConfig() {
  const pairPayload = pairManager.getPayload();
  if (!pairPayload.ok) {
    els.pairValidation.style.display = 'block';
    els.pairValidation.textContent = pairPayload.error;
    setQuickStatus('翻譯設定不完整，請先修正。', true);
    return false;
  }

  if (!els.waGroup.value.trim()) {
    setQuickStatus('請先選擇群組。', true);
    return false;
  }

  const payload = buildDraftPayload();
  const res = await fetch('/api/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();

  els.saveMsg.style.display = 'block';
  if (!data.ok) {
    els.saveMsg.classList.add('error');
    els.saveMsg.textContent = data.error || '儲存失敗';
    setQuickStatus('套用失敗，請重試。', true);
    return false;
  }

  els.saveMsg.classList.remove('error');
  try {
    await fetch('/api/wa/stop', { method: 'POST' });
  } catch (_) {
    // ignore
  }

  if (data.reload && data.reload.ok) {
    const groupId = data.reload.data && data.reload.data.groupId ? data.reload.data.groupId : '';
    if (data.resume && data.resume.ok) setStatus('設定已套用到 bot，並已自動恢復 bot 連線。');
    else setStatus('設定已套用到 bot，但恢復連線失敗。', true);
    els.saveMsg.textContent = groupId
      ? `已更新並套用成功，目標群組：${groupId}`
      : '已更新並套用成功。';
    lastAppliedSignature = payloadSignature(payload);
    forceEditApply = false;
    setQuickStatus('翻譯已啟用，現在可以到群組測試。');
    renderApplyPanel();
    refreshQuickActions();
    return true;
  }

  setStatus('設定已儲存，但 bot 尚未套用。', true);
  els.saveMsg.textContent = `已更新 .env，但 bot reload 失敗：${(data.reload && data.reload.error) || '未知錯誤'}`;
  setQuickStatus('套用失敗，請重試。', true);
  refreshQuickActions();
  return false;
}

function bindEvents() {
  document.getElementById('openGemini').addEventListener('click', () => {
    window.open('https://aistudio.google.com/app/apikey', '_blank');
  });

  startWaBtn.addEventListener('click', startWaConnection);
  refreshGroupsBtn.addEventListener('click', fetchGroupsAndRender);

  els.quickConnect.addEventListener('click', async () => {
    await startWaConnection();
    scrollToSection('section-connect');
  });

  els.quickGroups.addEventListener('click', async () => {
    if (!waReady) {
      setQuickStatus('請先完成 WhatsApp 連線。', true);
      scrollToSection('section-connect');
      return;
    }
    await fetchGroupsAndRender();
    scrollToSection('section-group');
  });

  els.quickEnable.addEventListener('click', async () => {
    await saveConfig();
    scrollToSection('section-apply');
  });

  els.addPairBtn.addEventListener('click', () => {
    pairManager.add();
    refreshQuickActions();
    renderApplyPanel();
  });

  document.getElementById('presetZhVi').addEventListener('click', () => {
    pairManager.addPreset(['zh-tw:vi', 'vi:zh-tw']);
    refreshQuickActions();
    renderApplyPanel();
  });

  document.getElementById('presetZhEn').addEventListener('click', () => {
    pairManager.addPreset(['zh-tw:en', 'en:zh-tw']);
    refreshQuickActions();
    renderApplyPanel();
  });

  document.getElementById('clearPairs').addEventListener('click', () => {
    pairManager.clearPairs();
    refreshQuickActions();
    renderApplyPanel();
  });

  els.pairSrc.addEventListener('change', () => {
    pairManager.onSelectorChange();
    refreshQuickActions();
  });

  els.pairDst.addEventListener('change', () => {
    pairManager.onSelectorChange();
    refreshQuickActions();
  });

  document.getElementById('save').addEventListener('click', async () => {
    await saveConfig();
  });

  if (els.editAgain) {
    els.editAgain.addEventListener('click', () => {
      forceEditApply = true;
      setQuickStatus('你可以修改設定，完成後再按「啟用翻譯」。');
      renderApplyPanel();
      refreshQuickActions();
    });
  }

  const watchInputs = [els.gemini, els.waAdmin, els.waGroup, els.sessionId];
  for (const input of watchInputs) {
    input.addEventListener('input', () => {
      renderApplyPanel();
      refreshQuickActions();
      updateSelectedGroupStatus();
    });
  }

  els.includeFromMe.addEventListener('change', () => {
    renderApplyPanel();
    refreshQuickActions();
  });

  if (els.groupSearch) {
    els.groupSearch.addEventListener('input', () => {
      refreshGroupFilter();
    });
  }
}

function connectEvents() {
  const stream = new EventSource('/api/events');
  stream.addEventListener('wa', (event) => {
    const data = JSON.parse(event.data);
    waReady = data.status === 'ready';
    waStarting = data.status === 'starting' || data.status === 'authenticated';

    if (data.error) setStatus(data.error, true);
    else if (data.status === 'waiting_qr') setStatus('請掃描 QR Code');
    else if (data.status === 'authenticated') setStatus('已驗證，初始化中...');
    else if (data.status === 'ready') setStatus('WhatsApp 已就緒');
    else if (data.status === 'starting') setStatus('啟動中...');
    else setStatus('尚未啟動');

    if (data.qrDataUrl) {
      els.waQr.src = data.qrDataUrl;
      els.waQr.style.display = 'block';
    } else {
      els.waQr.style.display = 'none';
    }

    if (data.adminId) {
      detectedAdminId = data.adminId;
      if (!els.waAdmin.value.trim()) els.waAdmin.value = detectedAdminId;
    }

    if (Array.isArray(data.groups)) renderGroups(data.groups);

    if (waReady) {
      setQuickStatus('WhatsApp 已連線，請選擇群組並啟用翻譯。');
    }

    refreshQuickActions();
    updateSelectedGroupStatus();
  });
}

async function loadConfig() {
  const res = await fetch('/api/env');
  const data = await res.json();
  els.gemini.value = '';
  const hasGemini = Boolean(data.GEMINI_API_KEYS_CONFIGURED);
  if (els.geminiHint) {
    if (hasGemini) {
      const masked = data.GEMINI_API_KEYS_MASKED ? `（目前：${data.GEMINI_API_KEYS_MASKED}）` : '';
      els.geminiHint.textContent = `已偵測到既有 API key，留空可沿用${masked}`;
    } else {
      els.geminiHint.textContent = '尚未設定 API key，請在此輸入後再儲存。';
    }
  }

  els.waAdmin.value = data.WHATSAPP_ADMIN_ID || '';
  els.waGroup.value = data.WHATSAPP_TRANSLATE_GROUP_ID || '';
  els.includeFromMe.checked = (data.WHATSAPP_TRANSLATE_INCLUDE_FROM_ME || 'true') !== 'false';
  els.sessionId.value = data.WHATSAPP_SESSION_CLIENT_ID || 'wa-translate';
  pairManager.load(data.TRANSLATE_PAIRS || 'zh-tw:vi,vi:zh-tw', data.DEFAULT_PAIR || 'vi:zh-tw');
  lastAppliedSignature = '';

  if (els.advancedApply) {
    els.advancedApply.open = !hasGemini;
  }
  if (!hasGemini) {
    setQuickStatus('首次使用請展開「進階設定」輸入 API key。');
    scrollToSection('section-apply');
  }

  updateSelectedGroupStatus();
  renderApplyPanel();
  refreshQuickActions();
}

loadConfig()
  .then(() => {
    bindEvents();
    connectEvents();
    bootstrapWaReadiness().catch(() => {});
  })
  .catch((err) => {
    setStatus(`讀取 .env 失敗：${err.message}`, true);
    setQuickStatus('讀取設定失敗，請重新整理。', true);
  });
