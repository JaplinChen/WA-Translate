(function () {
  function parsePairs(raw) {
    return (raw || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[a-z-]+:[a-z-]+$/i.test(value));
  }

  function uniquePairs(list) {
    return Array.from(new Set(list));
  }

  function pickLabel(selectEl, code) {
    const text = selectEl.querySelector(`option[value="${code}"]`)?.textContent || code;
    return text.split(' (')[0];
  }

  function createPairManager(elements) {
    const state = {
      pairs: [],
      defaultPair: ''
    };

    function setValidation(message = '') {
      if (!message) {
        elements.pairValidation.style.display = 'none';
        elements.pairValidation.textContent = '';
        return;
      }
      elements.pairValidation.style.display = 'block';
      elements.pairValidation.textContent = message;
    }

    function syncAddButton() {
      const source = elements.pairSrc.value;
      const target = elements.pairDst.value;
      const pair = `${source}:${target}`;

      if (!source || !target || source === target) {
        elements.addPairBtn.disabled = true;
        setValidation('來源與目標語言不能相同。');
        return;
      }
      if (state.pairs.includes(pair)) {
        elements.addPairBtn.disabled = true;
        setValidation('此翻譯方向已存在。');
        return;
      }

      elements.addPairBtn.disabled = false;
      setValidation('');
    }

    function renderList() {
      elements.pairList.innerHTML = '';

      if (state.pairs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'note';
        empty.textContent = '尚未設定語言對，請先加入至少一組翻譯方向。';
        elements.pairList.appendChild(empty);
        return;
      }

      for (const pair of state.pairs) {
        const [source, target] = pair.split(':');

        const row = document.createElement('div');
        row.className = 'pair-item';

        const main = document.createElement('div');
        main.className = 'pair-item-main';

        const label = document.createElement('div');
        label.className = 'pair-item-label';
        label.textContent = `${pickLabel(elements.pairSrc, source)} → ${pickLabel(elements.pairDst, target)}`;

        const code = document.createElement('div');
        code.className = 'pair-item-code';
        code.textContent = pair;

        main.appendChild(label);
        main.appendChild(code);

        const actions = document.createElement('div');
        actions.className = 'pair-actions';

        if (pair === state.defaultPair) {
          const tag = document.createElement('span');
          tag.className = 'pair-default-tag';
          tag.textContent = '目前預設';
          actions.appendChild(tag);
        }

        const defaultLabel = document.createElement('label');
        defaultLabel.className = 'pair-default';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'defaultPair';
        radio.checked = pair === state.defaultPair;
        radio.addEventListener('change', () => {
          state.defaultPair = pair;
          renderList();
        });

        const defaultText = document.createElement('span');
        defaultText.textContent = '預設';

        defaultLabel.appendChild(radio);
        defaultLabel.appendChild(defaultText);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'pair-delete';
        del.textContent = '刪除';
        del.addEventListener('click', () => {
          if (state.pairs.length <= 1) {
            setValidation('至少要保留一組翻譯方向。');
            return;
          }
          state.pairs = state.pairs.filter((item) => item !== pair);
          if (!state.pairs.includes(state.defaultPair)) state.defaultPair = state.pairs[0] || '';
          renderList();
          syncAddButton();
        });

        actions.appendChild(defaultLabel);
        actions.appendChild(del);

        row.appendChild(main);
        row.appendChild(actions);
        elements.pairList.appendChild(row);
      }
    }

    return {
      load(rawPairs, rawDefault) {
        state.pairs = uniquePairs(parsePairs(rawPairs || ''));
        state.defaultPair = String(rawDefault || '').toLowerCase();
        if (!state.pairs.includes(state.defaultPair)) state.defaultPair = state.pairs[0] || '';
        renderList();
        syncAddButton();
      },
      add() {
        const source = elements.pairSrc.value;
        const target = elements.pairDst.value;
        if (!source || !target || source === target) return;

        const pair = `${source}:${target}`;
        if (state.pairs.includes(pair)) return;

        state.pairs.push(pair);
        if (!state.defaultPair) state.defaultPair = pair;
        renderList();
        syncAddButton();
      },
      addPreset(pairs) {
        const incoming = uniquePairs(parsePairs((pairs || []).join(',')));
        for (const pair of incoming) {
          if (!state.pairs.includes(pair)) state.pairs.push(pair);
        }
        if (!state.defaultPair && state.pairs.length > 0) {
          state.defaultPair = state.pairs[0];
        }
        renderList();
        syncAddButton();
      },
      clearPairs() {
        if (state.pairs.length <= 1) {
          setValidation('目前只有一組翻譯方向，無法再清空。');
          return;
        }
        state.pairs = state.defaultPair ? [state.defaultPair] : [state.pairs[0]];
        state.defaultPair = state.pairs[0];
        setValidation('已清空其他語言對，保留目前預設方向。');
        renderList();
        syncAddButton();
      },
      onSelectorChange() {
        syncAddButton();
      },
      getPayload() {
        if (state.pairs.length === 0) {
          return { ok: false, error: '至少要有一組翻譯方向才能儲存。' };
        }
        if (!state.pairs.includes(state.defaultPair)) state.defaultPair = state.pairs[0];
        return {
          ok: true,
          translatePairs: state.pairs.join(','),
          defaultPair: state.defaultPair
        };
      }
    };
  }

  window.PairManager = {
    createPairManager
  };
})();
