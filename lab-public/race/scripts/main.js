'use strict';

// 快捷键入口需要避开表单、按钮焦点和弹窗，防止空格键误触比赛操作。
function shouldIgnoreRaceShortcut(event) {
  const target = event.target;
  const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';

  return (
    event.repeat ||
    ['input', 'textarea', 'select', 'button'].includes(tagName) ||
    (target && target.isContentEditable) ||
    isAnyModalOpen()
  );
}

// 鼠标点击后移走按钮焦点，降低电脑端连续按空格时触发上一次按钮的概率。
function blurAfterPointerClick(event, node = event.currentTarget) {
  if (event.detail > 0 && node && typeof node.blur === 'function') {
    node.blur();
  }
}

// 事件绑定集中在入口文件，业务处理继续分散在 race/parts/storage/core 等模块。
function bindEvents() {
  el.registerBtn.addEventListener('click', (event) => {
    ensureRaceAudioReady();
    if (gameState.phase === 'idle') {
      registerRace();
    } else if (isPostRacePhase(gameState.phase)) {
      nextRace();
    }
    blurAfterPointerClick(event);
  });
  el.startBtn.addEventListener('click', (event) => {
    ensureRaceAudioReady();
    pressStart({ controlledBy: 'manual' });
    blurAfterPointerClick(event);
  });
  if (el.aiAssistRaceButton) {
    el.aiAssistRaceButton.addEventListener('click', (event) => {
      ensureRaceAudioReady();
      handleAiAssistRaceButtonClick();
      blurAfterPointerClick(event);
    });
  }
  el.saveBtn.addEventListener('click', (event) => {
    saveGame();
    blurAfterPointerClick(event);
  });
  el.loadBtn.addEventListener('click', (event) => {
    loadGame();
    blurAfterPointerClick(event);
  });
  if (el.downloadLocalDataBtn) {
    el.downloadLocalDataBtn.addEventListener('click', (event) => {
      downloadLocalData();
      blurAfterPointerClick(event);
    });
  }
  el.restartBtn.addEventListener('click', (event) => {
    restartGame();
    blurAfterPointerClick(event);
  });
  if (el.clearLocalDataBtn) {
    el.clearLocalDataBtn.addEventListener('click', (event) => {
      clearLocalData();
      blurAfterPointerClick(event);
    });
  }
  if (el.telemetryToggleBtn) {
    el.telemetryToggleBtn.addEventListener('click', (event) => {
      toggleTelemetryEnabled();
      blurAfterPointerClick(event);
    });
  }
  el.tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      setActivePage(tab.dataset.page);
      blurAfterPointerClick(event, tab);
    });
  });

  el.difficultyOpenButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      openDifficultyModal();
      blurAfterPointerClick(event);
    });
  });

  if (el.difficultyCloseBtn) {
    el.difficultyCloseBtn.addEventListener('click', (event) => {
      closeDifficultyModal();
      blurAfterPointerClick(event);
    });
  }

  if (el.difficultyModal) {
    el.difficultyModal.addEventListener('click', (event) => {
      if (event.target === el.difficultyModal) {
        closeDifficultyModal();
      }
    });
  }

  if (el.noticeModalCloseBtn) {
    el.noticeModalCloseBtn.addEventListener('click', (event) => {
      closeNoticeModal('dismiss');
      blurAfterPointerClick(event);
    });
  }

  if (el.noticeModalCancelBtn) {
    el.noticeModalCancelBtn.addEventListener('click', (event) => {
      closeNoticeModal('cancel');
      blurAfterPointerClick(event);
    });
  }

  if (el.noticeModalConfirmBtn) {
    el.noticeModalConfirmBtn.addEventListener('click', (event) => {
      closeNoticeModal('confirm');
      blurAfterPointerClick(event);
    });
  }

  if (el.noticeModal) {
    el.noticeModal.addEventListener('click', (event) => {
      if (event.target === el.noticeModal) {
        closeNoticeModal('dismiss');
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && el.noticeModal && !el.noticeModal.hidden) {
      closeNoticeModal('dismiss');
      return;
    }

    if (event.key === 'Escape' && el.difficultyModal && !el.difficultyModal.hidden) {
      closeDifficultyModal();
      return;
    }

    if (event.code !== 'Space' || shouldIgnoreRaceShortcut(event)) {
      return;
    }

    event.preventDefault();
    ensureRaceAudioReady();

    if (gameState.phase === 'idle') {
      registerRace();
      return;
    }

    if (
      ['countdown_red', 'countdown_yellow', 'countdown_green', 'racing'].includes(gameState.phase)
    ) {
      pressStart({ controlledBy: 'manual' });
      return;
    }

    if (['finished', 'false_start'].includes(gameState.phase)) {
      nextRace();
    }
  });

  if (el.difficultyChoices) {
    el.difficultyChoices.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-difficulty]');
      if (button && !button.disabled) {
        setDifficulty(button.dataset.difficulty);
        closeDifficultyModal();
        blurAfterPointerClick(event, button);
      }
    });
  }

  el.atlasFilters.forEach((button) => {
    button.addEventListener('click', (event) => {
      const nextFilter = button.dataset.atlasFilter || 'all';
      if (gameState.atlasFilter === nextFilter) {
        blurAfterPointerClick(event, button);
        return;
      }
      gameState.atlasFilter = nextFilter;
      renderAtlas();
      blurAfterPointerClick(event, button);
    });
  });
}

// 初始化顺序：绑定事件、渲染静态面板、尝试自动读档，最后开放成就检查和操作。
function init() {
  bindEvents();
  initRaceAudioToggle();
  updateSettingsControls();
  el.registerBtn.textContent = `报名比赛（${getEntryFee()} 元）`;
  resetCars();
  refreshShop();
  renderGarage();
  renderDifficulty();
  renderAtlas();
  renderProfile();
  setPhase('idle');
  setActivePage('race');
  setLights('none');
  updateStats();
  const startupLoadResult = autoLoadGameOnInit();
  gameState.ready = true;
  checkAchievements({ source: 'init', silent: true });
  addLog('横线赛车经营赛启动。');
  addLog(`${GAME_VERSION}：${GAME_VERSION_NOTE}`);
  if (startupLoadResult.status === 'loaded') {
    addLog('已自动加载上次存档。');
  } else if (startupLoadResult.status === 'missing') {
    addLog('未找到存档，已开始新游戏。');
  } else if (startupLoadResult.status === 'invalid') {
    addLog(`存档读取失败：${startupLoadResult.message}`);
    addLog('当前未自动覆盖原存档；自动保存已暂停，请点击“重开并清档”或手动保存覆盖。');
  } else if (startupLoadResult.status === 'checksum_mismatch') {
    addLog(`存档读取失败：${startupLoadResult.message}`);
    addLog('当前未自动覆盖原存档；请先尝试修复或清理本地数据。');
    if (typeof openSaveChecksumRecoveryModal === 'function') {
      openSaveChecksumRecoveryModal(startupLoadResult.saveData);
    }
  } else if (startupLoadResult.status === 'access_error') {
    addLog(`本地存档不可用：${startupLoadResult.message} 当前已开始新游戏。`);
  }
  addLog('电脑端可按空格键报名 / 起步 / 下一场。');
  addLog('先报名比赛，等绿灯后点“起步 / 踩油门”。红灯或黄灯点击会抢跑。');
  addLog('已加入轻量 beep 音效，可在档案页关闭。');
}

init();
