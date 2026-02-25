function bindEvents() {
  document.getElementById('openGemini').addEventListener('click', () => {
    window.open('https://aistudio.google.com/app/apikey', '_blank');
  });

  startWaBtn.addEventListener('click', startWaConnection);
  refreshGroupsBtn.addEventListener('click', fetchGroupsAndRender);

  els.quickConnect.addEventListener('click', async () => {
    await executeStep(1);
  });

  els.quickGroups.addEventListener('click', async () => {
    await executeStep(2);
  });

  els.quickPairs.addEventListener('click', () => {
    jumpToStep(3);
  });

  els.quickApply.addEventListener('click', async () => {
    await executeStep(4);
  });

  els.quickPrev.addEventListener('click', () => {
    prevStep();
  });

  els.quickNext.addEventListener('click', async () => {
    await nextStep();
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
      if (input === els.waGroup) refreshGroupFilter();
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
    let data = null;
    try {
      data = JSON.parse(event.data);
    } catch (_) {
      setStatus('收到無效事件資料，請稍後重試。', true);
      setQuickStatus('狀態更新異常，請稍後重試。', true);
      return;
    }
    waReady = data.status === 'ready';
    if (!waReady) groupsLoaded = false;
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

    if (Array.isArray(data.groups)) {
      renderGroups(data.groups);
      groupsLoaded = true;
    }

    if (waReady) {
      setQuickStatus('WhatsApp 已連線，請選擇群組並啟用翻譯。');
    }

    refreshQuickActions();
    updateSelectedGroupStatus();
  });
  stream.addEventListener('error', () => {
    setStatus('與伺服器連線中斷，系統會自動重連。', true);
    setQuickStatus('狀態串流中斷，系統正在重連。', true);
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
