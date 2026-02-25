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
  quickPairs: document.getElementById('quickPairs'),
  quickApply: document.getElementById('quickApply'),
  quickPrev: document.getElementById('quickPrev'),
  quickNext: document.getElementById('quickNext')
};

let detectedAdminId = '';
let waReady = false;
let groupLoading = false;
let waStarting = false;
let lastAppliedSignature = '';
let forceEditApply = false;
let allGroups = [];
let currentQuickStep = 1;
let groupsLoaded = false;
const sectionMap = {
  1: 'section-connect',
  2: 'section-group',
  3: 'section-pairs',
  4: 'section-apply'
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

async function parseJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return { ok: false, error: '伺服器回傳非 JSON 格式資料。' };
  }
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
  const step1Done = waReady && groupsLoaded;
  const hasGroup = Boolean(els.waGroup.value.trim());
  const hasPairs = Boolean(pairPayloadOrNull());
  const readyToApply = hasGroup && hasPairs;
  const applied = isAppliedState();

  const stepDone = {
    1: step1Done,
    2: hasGroup,
    3: hasPairs,
    4: applied
  };

  if (currentQuickStep > 1 && !stepDone[1]) currentQuickStep = 1;
  if (currentQuickStep > 2 && !stepDone[2]) currentQuickStep = 2;
  if (currentQuickStep > 3 && !stepDone[3]) currentQuickStep = 3;

  els.quickConnect.disabled = waStarting;
  els.quickGroups.disabled = !step1Done || groupLoading;
  els.quickPairs.disabled = !hasGroup;
  els.quickApply.disabled = !readyToApply;

  const stepButtons = [
    [els.quickConnect, 1],
    [els.quickGroups, 2],
    [els.quickPairs, 3],
    [els.quickApply, 4]
  ];
  for (const [button, step] of stepButtons) {
    button.classList.toggle('step-active', currentQuickStep === step);
    button.classList.toggle('step-done', stepDone[step]);
  }

  els.quickConnect.textContent = step1Done ? '1 已完成連線' : waStarting ? '1 連線中...' : '1 連線 WhatsApp';
  els.quickGroups.textContent = hasGroup ? '2 群組已選擇' : '2 選擇群組';
  els.quickPairs.textContent = hasPairs ? '3 翻譯已設定' : '3 設定翻譯';
  els.quickApply.textContent = applied ? '4 已套用完成' : '4 套用到 BOT';

  const nextLabelMap = {
    1: '下一步：選擇群組',
    2: '下一步：設定翻譯',
    3: '下一步：套用到 BOT',
    4: applied ? '已完成' : '立即套用'
  };
  els.quickPrev.disabled = currentQuickStep <= 1;
  els.quickNext.disabled = (currentQuickStep === 1 && !step1Done) || (currentQuickStep === 2 && !hasGroup);
  if (currentQuickStep === 3) els.quickNext.disabled = !readyToApply;
  els.quickNext.textContent = nextLabelMap[currentQuickStep];
  if (currentQuickStep === 1 && !step1Done) {
    els.quickNext.textContent = '下一步：選擇群組（先完成連線與刷新）';
  }
  refreshStepOneButtons();
  updateVisibleSection();
}

function refreshStepOneButtons() {
  if (!startWaBtn || !refreshGroupsBtn) return;
  startWaBtn.textContent = waReady ? 'WhatsApp 已連線' : waStarting ? '連線中...' : '啟動 WhatsApp 連線';
  startWaBtn.disabled = waStarting;
  startWaBtn.classList.toggle('task-done', waReady);

  refreshGroupsBtn.textContent = groupLoading ? '刷新中...' : groupsLoaded ? '群組已刷新' : '刷新群組';
  refreshGroupsBtn.disabled = !waReady || groupLoading;
  refreshGroupsBtn.classList.toggle('task-done', groupsLoaded);
}

function updateVisibleSection() {
  for (const [step, sectionId] of Object.entries(sectionMap)) {
    const section = document.getElementById(sectionId);
    if (!section) continue;
    const visible = Number(step) === currentQuickStep;
    section.hidden = !visible;
    section.classList.toggle('active', visible);
  }
}

function jumpToStep(step) {
  currentQuickStep = step;

  if (step === 1) {
    refreshQuickActions();
    scrollToSection('section-connect');
    return;
  }
  if (step === 2) {
    if (!(waReady && groupsLoaded)) {
      setQuickStatus('請先完成 Step 1：連線 WhatsApp 並刷新群組。', true);
      currentQuickStep = 1;
      refreshQuickActions();
      scrollToSection('section-connect');
      return;
    }
    refreshQuickActions();
    scrollToSection('section-group');
    return;
  }
  if (step === 3) {
    if (!els.waGroup.value.trim()) {
      setQuickStatus('請先選擇群組。', true);
      currentQuickStep = 2;
      refreshQuickActions();
      scrollToSection('section-group');
      return;
    }
    refreshQuickActions();
    scrollToSection('section-pairs');
    return;
  }
  refreshQuickActions();
  scrollToSection('section-apply');
}

async function executeStep(step) {
  if (step === 1) {
    await startWaConnection();
    jumpToStep(1);
    return;
  }
  if (step === 2) {
    if (!(waReady && groupsLoaded)) {
      setQuickStatus('請先完成 Step 1：連線 WhatsApp 並刷新群組。', true);
      jumpToStep(1);
      return;
    }
    await fetchGroupsAndRender();
    jumpToStep(2);
    return;
  }
  if (step === 3) {
    jumpToStep(3);
    return;
  }
  await saveConfig();
  jumpToStep(4);
}

async function nextStep() {
  const next = Math.min(4, currentQuickStep + 1);
  await executeStep(next);
}

function prevStep() {
  const prev = Math.max(1, currentQuickStep - 1);
  jumpToStep(prev);
}

function scrollToSection(id) {
  const section = document.getElementById(id);
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
