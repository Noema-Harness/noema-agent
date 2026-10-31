/** Exercise the real Electron renderer; does not call a model or inspect user data. */
export async function verifyConversationNavigation(window) {
  const contents = window.webContents;
  const settle = () =>
    contents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))))',
    );
  const inspect = () =>
    contents.executeJavaScript(`(() => {
    const sidebar = document.querySelector('.conversation-sidebar');
    const panel = document.querySelector('.conversation-panel');
    const separator = document.querySelector('.navigation-resize-handle');
    const rect = sidebar.getBoundingClientRect();
    const handle = separator.getBoundingClientRect();
    const settings = [...document.querySelectorAll('[aria-label="连接与模型设置"]')]
      .filter(node => node.getBoundingClientRect().width > 0 && !node.closest('[inert]'));
    return {
      collapsed: document.querySelector('.social-body').classList.contains('navigation-collapsed'),
      width: Math.round(rect.width),
      handleX: handle.x + handle.width / 2,
      handleY: Math.min(handle.y + 150, handle.bottom - 10),
      value: Number(separator.getAttribute('aria-valuenow')),
      sidebarInert: sidebar.inert,
      panelInert: panel.inert,
      panelVisible: panel.getBoundingClientRect().width > 0,
      settings: settings.length,
      focused: document.activeElement.className,
      focusedLabel: document.activeElement.getAttribute('aria-label'),
      globalSearchOpen: Boolean(document.querySelector('[cmdk-input]')),
      sidebarOverflow: sidebar.scrollWidth > sidebar.clientWidth,
      dragging: document.querySelector('.social-body').classList.contains('navigation-resizing'),
      overflow: document.documentElement.scrollWidth > innerWidth,
      preference: JSON.parse(localStorage.getItem('noema.conversation-navigation.v3')),
    };
  })()`);
  const check = (condition, label, state) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(state)}`);
  };
  const key = async (value) => {
    await contents.executeJavaScript(`(() => {
      const handle = document.querySelector('.navigation-resize-handle');
      handle.focus();
      handle.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(value)}, bubbles:true}));
    })()`);
    await settle();
  };
  // did-finish-load confirms document loading, not React's asynchronous IPC boot.
  // Wait for the actual controls instead of assuming two animation frames suffice.
  await contents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (document.querySelector('.conversation-sidebar') &&
          document.querySelector('.conversation-panel') &&
          document.querySelector('.navigation-resize-handle')) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Navigation controls did not mount: ' + JSON.stringify({url:location.href,ready:document.readyState,text:document.body.innerText.slice(0,500)}));
  })()`);
  window.setSize(1280, 800);
  await settle();
  let state = await inspect();
  check(
    !state.collapsed && !state.sidebarInert && state.settings === 1,
    'Initial navigation and unique settings',
    state,
  );
  await key('End');
  for (let step = 0; step < 5; step++) await key('ArrowLeft');
  state = await inspect();
  check(
    state.width === 320 &&
      state.value === 320 &&
      state.preference.width === 320,
    'Keyboard resize persists width',
    state,
  );

  const drag = async (destination) => {
    const start = await inspect();
    const x = Math.round(start.handleX),
      y = Math.round(start.handleY);
    contents.sendInputEvent({ type: 'mouseMove', x, y });
    contents.sendInputEvent({
      type: 'mouseDown',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await settle();
    contents.sendInputEvent({
      type: 'mouseMove',
      x: destination,
      y,
      button: 'left',
    });
    await settle();
    contents.sendInputEvent({
      type: 'mouseUp',
      x: destination,
      y,
      button: 'left',
      clickCount: 1,
    });
    await settle();
  };
  await drag(360);
  state = await inspect();
  check(
    state.width === 360 && state.preference.width === 360,
    'Pointer resize',
    state,
  );
  await drag(20);
  state = await inspect();
  check(
    state.collapsed && state.sidebarInert && state.preference.width === 360,
    'Edge collapse retains expanded width',
    state,
  );
  check(
    state.focused.includes('navigation-reveal') && !state.overflow,
    'Collapsed focus and layout',
    state,
  );
  await contents.executeJavaScript(
    `document.querySelector('.navigation-reveal').click()`,
  );
  await settle();
  state = await inspect();
  check(
    state.width === 360 && !state.collapsed && !state.sidebarInert,
    'Restore width',
    state,
  );
  await key('Home');
  state = await inspect();
  check(
    state.collapsed && state.focused.includes('navigation-reveal'),
    'Keyboard collapse',
    state,
  );
  await contents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent('keydown', {key:'k', ctrlKey:true, bubbles:true}))`,
  );
  await settle();
  state = await inspect();
  check(
    state.collapsed &&
      state.globalSearchOpen &&
      state.focusedLabel === '搜索联系人、项目和消息',
    'Global search preserves the collapsed navigation preference',
    state,
  );
  await contents.executeJavaScript(
    `document.querySelector('[aria-label="关闭全局搜索"]').click()`,
  );
  await settle();
  await contents.executeJavaScript(
    `document.querySelector('.navigation-reveal').click()`,
  );
  await settle();
  await contents.executeJavaScript(
    `document.querySelector('[aria-label="搜索成员或项目"]').focus()`,
  );
  await settle();
  state = await inspect();
  check(
    !state.collapsed &&
      !state.globalSearchOpen &&
      state.focusedLabel === '搜索成员或项目',
    'Sidebar filtering remains a separate control',
    state,
  );

  window.setSize(680, 560);
  await settle();
  await contents.executeJavaScript(`(() => {
    if (document.querySelector('.conversation-sidebar').inert)
      document.querySelector('.navigation-reveal').click();
  })()`);
  await settle();
  state = await inspect();
  check(
    state.panelInert &&
      !state.sidebarInert &&
      !state.overflow &&
      state.settings === 1,
    'Narrow navigation access',
    state,
  );
  await contents.executeJavaScript(
    `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))`,
  );
  await settle();
  state = await inspect();
  check(
    !state.panelInert &&
      state.sidebarInert &&
      state.panelVisible &&
      !state.overflow,
    'Narrow Escape returns to chat',
    state,
  );
  await contents.executeJavaScript(
    `document.querySelector('.navigation-reveal').click()`,
  );
  await settle();
  state = await inspect();
  check(
    state.panelInert && !state.sidebarInert && state.settings === 1,
    'Narrow toolbar opens navigation',
    state,
  );
  window.setSize(1280, 800);
  await settle();
  state = await inspect();
  check(
    state.width === 360 &&
      !state.sidebarInert &&
      !state.panelInert &&
      !state.overflow,
    'Desktop width survives narrow mode',
    state,
  );
  return { checks: 11, width: state.width, preference: state.preference };
}
