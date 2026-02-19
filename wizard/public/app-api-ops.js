(function () {
  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    return res.json();
  }

  async function fetchGroupsAndRender(ctx) {
    const { state, setStatus, setQuickStatus, refreshQuickActions, renderGroups } = ctx;
    if (!state.waReady || state.groupLoading) return false;
    state.groupLoading = true;
    refreshQuickActions();
    try {
      const data = await fetchJson('/api/wa/groups');
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
      state.groupLoading = false;
      refreshQuickActions();
    }
  }

  async function bootstrapWaReadiness(ctx) {
    const { state, renderGroups, setStatus, setQuickStatus, refreshQuickActions } = ctx;
    try {
      const data = await fetchJson('/api/wa/groups');
      if (!data.ok) return false;
      state.waReady = true;
      state.waStarting = false;
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

  async function startWaConnection(ctx) {
    const { state, setStatus, setQuickStatus, refreshQuickActions } = ctx;
    if (state.waStarting) return;
    state.waStarting = true;
    refreshQuickActions();
    setQuickStatus('正在建立連線，請用手機掃描 QR Code。');
    try {
      const data = await fetchJson('/api/wa/start', { method: 'POST' });
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
      state.waStarting = false;
      refreshQuickActions();
    }
  }

  async function saveConfig(ctx) {
    const {
      els,
      state,
      pairManager,
      setStatus,
      setQuickStatus,
      buildDraftPayload,
      payloadSignature,
      renderApplyPanel,
      refreshQuickActions
    } = ctx;

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
    const data = await fetchJson('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

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
      state.lastAppliedSignature = payloadSignature(payload);
      state.forceEditApply = false;
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

  async function loadConfig(ctx) {
    const { els, state, pairManager, setQuickStatus, scrollToSection, updateSelectedGroupStatus, renderApplyPanel, refreshQuickActions } = ctx;
    const data = await fetchJson('/api/env');
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
    state.lastAppliedSignature = '';

    if (els.advancedApply) els.advancedApply.open = !hasGemini;
    if (!hasGemini) {
      setQuickStatus('首次使用請展開「進階設定」輸入 API key。');
      scrollToSection('section-apply');
    }
    updateSelectedGroupStatus();
    renderApplyPanel();
    refreshQuickActions();
  }

  window.AppApiOps = {
    fetchGroupsAndRender,
    bootstrapWaReadiness,
    startWaConnection,
    saveConfig,
    loadConfig
  };
})();
