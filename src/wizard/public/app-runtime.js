(function () {
  function connectEvents(ctx) {
    const {
      els,
      state,
      setStatus,
      setQuickStatus,
      renderGroups,
      refreshQuickActions,
      updateSelectedGroupStatus
    } = ctx;

    const stream = new EventSource('/api/events');
    stream.addEventListener('wa', (event) => {
      const data = JSON.parse(event.data);
      state.waReady = data.status === 'ready';
      state.waStarting = data.status === 'starting' || data.status === 'authenticated';

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
        state.detectedAdminId = data.adminId;
        if (!els.waAdmin.value.trim()) els.waAdmin.value = state.detectedAdminId;
      }

      if (Array.isArray(data.groups)) renderGroups(data.groups);
      if (state.waReady) setQuickStatus('WhatsApp 已連線，請選擇群組並啟用翻譯。');
      refreshQuickActions();
      updateSelectedGroupStatus();
    });
  }

  function bindEvents(ctx) {
    const {
      els,
      state,
      pairManager,
      refreshGroupsBtn,
      startWaBtn,
      setQuickStatus,
      scrollToSection,
      renderApplyPanel,
      refreshQuickActions,
      updateSelectedGroupStatus,
      refreshGroupFilter
    } = ctx;

    document.getElementById('openGemini').addEventListener('click', () => {
      window.open('https://aistudio.google.com/app/apikey', '_blank');
    });

    startWaBtn.addEventListener('click', () => window.AppApiOps.startWaConnection(ctx));
    refreshGroupsBtn.addEventListener('click', () => window.AppApiOps.fetchGroupsAndRender(ctx));

    els.quickConnect.addEventListener('click', async () => {
      await window.AppApiOps.startWaConnection(ctx);
      scrollToSection('section-connect');
    });

    els.quickGroups.addEventListener('click', async () => {
      if (!state.waReady) {
        setQuickStatus('請先完成 WhatsApp 連線。', true);
        scrollToSection('section-connect');
        return;
      }
      await window.AppApiOps.fetchGroupsAndRender(ctx);
      scrollToSection('section-group');
    });

    els.quickEnable.addEventListener('click', async () => {
      await window.AppApiOps.saveConfig(ctx);
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
      await window.AppApiOps.saveConfig(ctx);
    });

    if (els.editAgain) {
      els.editAgain.addEventListener('click', () => {
        state.forceEditApply = true;
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

  async function init(ctx) {
    try {
      await window.AppApiOps.loadConfig(ctx);
      bindEvents(ctx);
      connectEvents(ctx);
      window.AppApiOps.bootstrapWaReadiness(ctx).catch(() => {});
    } catch (err) {
      ctx.setStatus(`讀取 .env 失敗：${err.message}`, true);
      ctx.setQuickStatus('讀取設定失敗，請重新整理。', true);
    }
  }

  window.AppRuntime = {
    init
  };
})();
