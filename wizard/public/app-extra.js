function renderGroups(groups) {
  els.groupList.innerHTML = '';
  allGroups = Array.isArray(groups) ? groups : [];
  const selectedGroupId = els.waGroup.value.trim();

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
    const isSelected = String(group.id || '') === selectedGroupId;
    const row = document.createElement('div');
    row.className = 'group';
    row.classList.toggle('selected', isSelected);

    const info = document.createElement('div');
    const name = document.createElement('div');
    const id = document.createElement('div');
    name.textContent = group.name;
    id.className = 'mono';
    id.textContent = group.id;
    info.appendChild(name);
    info.appendChild(id);

    const button = document.createElement('button');
    button.className = isSelected ? 'selected-btn' : 'ghost';
    button.type = 'button';
    button.textContent = isSelected ? '已選擇' : '使用';
    button.disabled = isSelected;
    button.addEventListener('click', () => {
      els.waGroup.value = group.id;
      updateSelectedGroupStatus();
      refreshQuickActions();
      setQuickStatus(`已選擇群組：${group.name}`);
      renderGroups(allGroups);
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
    groupsLoaded = true;
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
    groupsLoaded = true;
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
  els.saveMsg.style.display = 'block';

  try {
    const res = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(res);

    if (!res.ok || !data.ok) {
      els.saveMsg.classList.add('error');
      els.saveMsg.textContent = data.error || `儲存失敗（HTTP ${res.status}）`;
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
  } catch (err) {
    els.saveMsg.classList.add('error');
    els.saveMsg.textContent = `套用失敗：${err.message}`;
    setQuickStatus('網路或服務異常，請稍後重試。', true);
    return false;
  }
}
