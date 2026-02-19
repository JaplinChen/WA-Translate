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

const state = {
  detectedAdminId: '',
  waReady: false,
  groupLoading: false,
  waStarting: false,
  lastAppliedSignature: '',
  forceEditApply: false,
  allGroups: []
};

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
  return currentSignature === state.lastAppliedSignature && Boolean(state.lastAppliedSignature);
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

  els.quickConnect.disabled = state.waStarting;
  els.quickGroups.disabled = !state.waReady || state.groupLoading;
  els.quickEnable.disabled = !readyToApply;

  if (state.waStarting) {
    els.quickConnect.textContent = '連線中...';
  } else if (state.waReady) {
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
  state.allGroups = Array.isArray(groups) ? groups : [];

  const keyword = String(els.groupSearch ? els.groupSearch.value : '').trim().toLowerCase();
  const visibleGroups = !keyword
    ? state.allGroups
    : state.allGroups.filter((group) => {
      const name = String(group.name || '').toLowerCase();
      const id = String(group.id || '').toLowerCase();
      return name.includes(keyword) || id.includes(keyword);
    });
  if (state.allGroups.length === 0) {
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
  renderGroups(state.allGroups);
}

function renderApplyPanel() {
  if (!els.applyConfig || !els.applySummary || !els.applyDoneActions) return;
  const applied = isAppliedState();
  const completeView = applied && !state.forceEditApply;
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

window.AppContext = {
  els,
  state,
  pairManager,
  refreshGroupsBtn,
  startWaBtn,
  setStatus,
  setQuickStatus,
  pairPayloadOrNull,
  buildDraftPayload,
  payloadSignature,
  isAppliedState,
  updateSelectedGroupStatus,
  refreshQuickActions,
  scrollToSection,
  renderGroups,
  refreshGroupFilter,
  renderApplyPanel
};

window.AppRuntime.init(window.AppContext);
