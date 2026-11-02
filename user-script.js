/**
 * 萌百 → VS Code（小工具）
 *
 * 在条目页有个悬浮球（默认左下角，可拖动）：点一下抓当前条目源码，
 * 交给本机 Node 服务（127.0.0.1:8765），写进本地目录并用 VS Code 打开。
 *
 * 本工具由 AI 辅助生成，未经完整测试，不保证可用性。
 * 使用前请自行审阅代码，因使用造成的任何问题自负。
 *
 * 开源地址：https://github.com/你的账号/moegirl-vscode-open
 *
 * 用法：
 *   1. 在个人 common.js 里加载本页
 *   2. 本机跑配套的 server.mjs（Node 18+，监听 127.0.0.1:8765）
 *   3. 打开条目，点悬浮球；右键有更多操作（覆盖、目录、对比、状态）
 *
 * 限制：只在 Windows + Node.js 上测过；登录失效或网络受限时不可用；
 * 提交前务必确认源码完整。
 */
(function () {
  'use strict';

  if (window.__mgVscodeOpenLoaded) return;
  window.__mgVscodeOpenLoaded = true;

  var BRIDGE = 'http://127.0.0.1:8765';
  var TOKEN = 'change-me-please';
  var BUTTON_ID = 'mg-vscode-open';
  var MENU_ID = 'mg-vscode-open-menu';
  var POS_KEY = 'mgVscodeOpenPos';

  // 只在条目页（0）和用户页（2）出现
  var ns = mw.config.get('wgNamespaceNumber');
  if (ns !== 0 && ns !== 2) return;

  var busy = false;

  // ---------- 按钮 ----------
  var btn = document.createElement('div');
  btn.id = BUTTON_ID;
  btn.title = '点一下：把当前条目源码写进本地并用 VS Code 打开\n拖动可换位置，右键更多功能';
  btn.style.cssText = [
    'position:fixed',
    'left:16px',
    'top:16px',
    'z-index:2147483000',
    'display:flex',
    'align-items:center',
    'gap:6px',
    'padding:6px 10px',
    'border-radius:14px',
    'background:#1f6feb',
    'color:#fff',
    'font-size:12px',
    'line-height:1.2',
    'cursor:pointer',
    'user-select:none',
    'touch-action:none',
    'box-shadow:0 2px 8px rgba(0,0,0,.35)',
    'opacity:.88',
    'transition:opacity .15s',
  ].join(';');

  var dot = document.createElement('span');
  dot.style.cssText =
    'width:7px;height:7px;border-radius:50%;background:#8b949e;box-shadow:0 0 0 2px rgba(255,255,255,.25)';

  var label = document.createElement('span');
  label.textContent = 'VS Code';

  btn.appendChild(dot);
  btn.appendChild(label);

  // ---------- 位置：记忆 + 边界 ----------
  function clampPos(left, top) {
    var w = btn.offsetWidth || 90;
    var h = btn.offsetHeight || 28;
    var maxLeft = Math.max(4, window.innerWidth - w - 4);
    var maxTop = Math.max(4, window.innerHeight - h - 4);
    return {
      left: Math.min(Math.max(4, left), maxLeft),
      top: Math.min(Math.max(4, top), maxTop),
    };
  }

  function applyPos(left, top) {
    var p = clampPos(left, top);
    btn.style.left = p.left + 'px';
    btn.style.top = p.top + 'px';
  }

  function savePos() {
    try {
      localStorage.setItem(
        POS_KEY,
        JSON.stringify({
          left: parseInt(btn.style.left, 10) || 16,
          top: parseInt(btn.style.top, 10) || 16,
        }),
      );
    } catch (e) {
      /* 隐私模式可能写不了，忽略 */
    }
  }

  function restorePos() {
    var raw = null;
    try {
      raw = localStorage.getItem(POS_KEY);
    } catch (e) {
      raw = null;
    }
    if (raw) {
      try {
        var p = JSON.parse(raw);
        if (typeof p.left === 'number' && typeof p.top === 'number') {
          applyPos(p.left, p.top);
          return;
        }
      } catch (e) {
        /* 位置坏了就回默认 */
      }
    }
    // 默认左下角
    applyPos(16, window.innerHeight - (btn.offsetHeight || 28) - 16);
  }

  // ---------- 提示 ----------
  function notify(kind, message) {
    if (typeof mw !== 'undefined' && mw.notify) {
      mw.notify(message, { title: '萌百 → VS Code', type: kind === 'error' ? 'error' : undefined });
    } else if (kind === 'error') {
      console.error('[mg-vscode-open]', message);
    } else {
      console.log('[mg-vscode-open]', message);
    }
  }

  function setBusy(text) {
    busy = !!text;
    label.textContent = text || 'VS Code';
    btn.style.opacity = busy ? '0.6' : '0.88';
  }

  // ---------- 与萌百 API / 本机桥 ----------
  function currentTitle() {
    return mw.config.get('wgPageName') || decodeURIComponent(location.pathname.replace(/^\/+/, ''));
  }

  function fetchSource(title) {
    var api = new URL('/api.php', location.origin);
    api.searchParams.set('action', 'query');
    api.searchParams.set('prop', 'revisions');
    api.searchParams.set('rvprop', 'content');
    api.searchParams.set('rvslots', 'main');
    api.searchParams.set('format', 'json');
    api.searchParams.set('formatversion', '2');
    api.searchParams.set('titles', title);

    return fetch(api.toString(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (resp) {
        return resp.json();
      })
      .then(function (json) {
        if (json.error) {
          var hint = json.error.code === 'action-notallowed' ? '（没登录？先在萌百登录）' : '';
          throw new Error('API 返回 ' + json.error.code + '：' + (json.error.info || '') + hint);
        }
        var page = json.query && json.query.pages && json.query.pages[0];
        if (!page) throw new Error('没取到页面对象');
        if (page.missing) throw new Error('页面不存在');
        var rev = page.revisions && page.revisions[0];
        var content = rev && rev.slots && rev.slots.main && rev.slots.main.content;
        if (typeof content !== 'string') throw new Error('没解析出源码');
        return content;
      });
  }

  // 圆点颜色：任何一次桥请求的结果都立刻反映，不再等 30 秒轮询
  function setDot(ok) {
    dot.style.background = ok ? '#3fb950' : '#f85149';
  }

  function bridgeCall(path, opts) {
    var url = BRIDGE + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
    return fetch(url, opts || {})
      .then(function (resp) {
        return resp.json();
      })
      .then(function (json) {
        setDot(true);
        return json;
      })
      .catch(function (err) {
        setDot(false);
        throw err;
      });
  }

  function doOpen(force) {
    if (busy) return;
    setBusy('抓取中…');
    var title = currentTitle();

    fetchSource(title)
      .then(function (content) {
        setBusy('发送中…');
        return bridgeCall('/open', {
          method: 'POST',
          headers: { 'content-type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ title: title, content: content, force: !!force }),
        });
      })
      .then(function (json) {
        if (!json || !json.ok) throw new Error((json && json.error) || '本机桥返回失败');
        setBusy('');
        notify('info', json.message || '已写入：' + json.file);
      })
      .catch(function (err) {
        setBusy('');
        var msg = err && err.message ? err.message : String(err);
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
          msg =
            '连不上本机桥。先跑 node tools/vscode-open/server.mjs，' +
            '或浏览器拦了到 127.0.0.1 的请求（站点 CSP / 私有网络策略）。';
        }
        notify('error', msg);
      });
  }

  function openFolder() {
    bridgeCall('/open-folder', { method: 'POST' })
      .then(function (json) {
        if (!json || !json.ok) throw new Error((json && json.error) || '打开失败');
        notify('info', '已在 VS Code 打开素材目录：' + json.vault);
      })
      .catch(function (err) {
        notify('error', (err && err.message) || String(err));
      });
  }

  // ---------- 更多操作 ----------
  var recentCache = [];

  function loadRecent() {
    bridgeCall('/recent')
      .then(function (json) {
        if (json && json.ok && Array.isArray(json.items)) {
          recentCache = json.items.slice(0, 3);
        }
      })
      .catch(function () {
        /* 桥没开就不显示最近列表 */
      });
  }

  function compareLocal() {
    if (busy) return;
    setBusy('对比中…');
    var title = currentTitle();

    fetchSource(title)
      .then(function (content) {
        return bridgeCall('/compare', {
          method: 'POST',
          headers: { 'content-type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ title: title, content: content }),
        });
      })
      .then(function (json) {
        setBusy('');
        if (!json || !json.ok) throw new Error((json && json.error) || '对比失败');
        if (!json.exists) return notify('info', json.message || '本地还没有草稿，没有可比的内容');
        if (json.identical) return notify('info', '本地与线上完全一致');
        notify(
          'info',
          '本地比线上多 ' +
            json.localAdded +
            ' 行、少 ' +
            json.localRemoved +
            ' 行（' +
            json.localBytes +
            ' / ' +
            json.remoteBytes +
            ' 字节）',
        );
      })
      .catch(function (err) {
        setBusy('');
        notify('error', (err && err.message) || String(err));
      });
  }

  function copySource() {
    if (busy) return;
    setBusy('复制中…');
    var title = currentTitle();

    fetchSource(title)
      .then(function (content) {
        return navigator.clipboard.writeText(content).then(function () {
          return content.length;
        });
      })
      .then(function (len) {
        setBusy('');
        notify('info', '已复制源码 ' + len + ' 字符到剪贴板');
      })
      .catch(function (err) {
        setBusy('');
        notify('error', '复制失败：' + ((err && err.message) || String(err)));
      });
  }

  function openEditPage() {
    window.open(
      '/index.php?title=' + encodeURIComponent(currentTitle()) + '&action=edit',
      '_blank',
    );
  }

  function openRecent(item) {
    bridgeCall('/open-file', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ title: item.title }),
    })
      .then(function (json) {
        if (!json || !json.ok) throw new Error((json && json.error) || '打开失败');
        notify('info', '已打开：' + json.file);
      })
      .catch(function (err) {
        notify('error', (err && err.message) || String(err));
      });
  }

  function showStatus() {
    bridgeCall('/ping')
      .then(function (json) {
        dot.style.background = '#3fb950';
        notify('info', '本机桥在线，落盘目录：' + json.vault);
      })
      .catch(function () {
        dot.style.background = '#f85149';
        notify('error', '本机桥没连上（127.0.0.1:8765）');
      });
  }

  function pingOnce() {
    bridgeCall('/ping')
      .then(function () {
        dot.style.background = '#3fb950';
      })
      .catch(function () {
        dot.style.background = '#f85149';
      });
  }

  // ---------- 右键菜单 ----------
  var menu = null;

  function hideMenu() {
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    menu = null;
  }

  function menuItem(text, onClick) {
    var d = document.createElement('div');
    d.textContent = text;
    d.style.cssText =
      'padding:7px 14px;cursor:pointer;white-space:nowrap;font-size:13px;color:#e6edf3';
    d.addEventListener('mouseenter', function () {
      d.style.background = '#2d6cdf';
    });
    d.addEventListener('mouseleave', function () {
      d.style.background = 'transparent';
    });
    d.addEventListener('click', function (e) {
      e.stopPropagation();
      hideMenu();
      onClick();
    });
    return d;
  }

  function showMenu(x, y) {
    hideMenu();
    menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.style.cssText = [
      'position:fixed',
      'z-index:2147483001',
      'background:#161b22',
      'border:1px solid #30363d',
      'border-radius:8px',
      'padding:4px 0',
      'box-shadow:0 8px 24px rgba(0,0,0,.5)',
      'min-width:150px',
    ].join(';');

    menu.appendChild(menuItem('打开当前条目', function () { doOpen(false); }));
    menu.appendChild(menuItem('强制覆盖本地草稿', function () { doOpen(true); }));
    menu.appendChild(menuItem('对比本地 / 线上', compareLocal));
    menu.appendChild(menuItem('复制源码到剪贴板', copySource));
    menu.appendChild(menuItem('打开站内编辑页', openEditPage));
    menu.appendChild(menuItem('打开素材目录', openFolder));
    menu.appendChild(menuItem('本机桥状态', showStatus));

    if (recentCache.length) {
      recentCache.forEach(function (it) {
        menu.appendChild(menuItem('最近：' + it.title, function () { openRecent(it); }));
      });
    }

    document.body.appendChild(menu);

    // 防止菜单跑出视口
    var r = menu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - r.width - 8);
    var top = Math.min(y, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(4, left) + 'px';
    menu.style.top = Math.max(4, top) + 'px';
  }

  // 点别处就收起菜单
  document.addEventListener('click', function () {
    hideMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideMenu();
  });

  // ---------- 拖动 ----------
  var drag = null;

  btn.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    var r = btn.getBoundingClientRect();
    drag = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      left: r.left,
      top: r.top,
      moved: false,
    };
    try {
      btn.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 老浏览器忽略 */
    }
    btn.style.cursor = 'grabbing';
  });

  btn.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.sx;
    var dy = e.clientY - drag.sy;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    applyPos(drag.left + dx, drag.top + dy);
  });

  btn.addEventListener('pointerup', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var wasDragged = drag.moved;
    drag = null;
    btn.style.cursor = 'pointer';
    if (wasDragged) {
      savePos();
      hideMenu();
    } else if (e.button === 0) {
      doOpen(false);
    }
  });

  btn.addEventListener('pointercancel', function () {
    if (drag) {
      drag = null;
      btn.style.cursor = 'pointer';
    }
  });

  btn.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY);
  });

  // 窗口尺寸变化时把球拉回可见区
  window.addEventListener('resize', function () {
    applyPos(parseInt(btn.style.left, 10) || 16, parseInt(btn.style.top, 10) || 16);
  });

  // ---------- 挂载 ----------
  function mount() {
    if (document.getElementById(BUTTON_ID)) return;
    if (!document.body) return;
    document.body.appendChild(btn);
    restorePos();
    pingOnce();
    loadRecent();
    setInterval(pingOnce, 10000);
    // 页面从后台切回来时立刻探一次，别等下一轮
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) pingOnce();
    });
    window.addEventListener('focus', pingOnce);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
