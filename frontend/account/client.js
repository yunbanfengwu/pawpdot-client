window.__ModuleLoader__.load({
  id: '@pawpdot/client-account',
  factory: require => {
    const { createElement: h, useEffect, useRef, useState, useSyncExternalStore } = require('react');
    const {
      Button, Input, Modal, Menu, IconCloseOutlineRegular, IconUserOutlineMedium, IconSettingsOutlineMedium,
    } = require('@deepseek-ai/dsh-client-ui-primitives');

    async function request(action, input) {
      const result = await window.pawpdotAccount.request(action, input);
      if (result.error) throw new Error(result.error);
      return result;
    }

    let session = { user: undefined, error: '' };
    let readingSession;
    const listeners = new Set();
    const subscribeSession = listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const useSession = () => useSyncExternalStore(subscribeSession, () => session);
    const accountName = user => user?.display_name || user?.username;

    function AccountAvatar({ name, url }) {
      const normalized = name?.trim().normalize('NFKC');
      const [imageFailed, setImageFailed] = useState(false);
      useEffect(() => { setImageFailed(false); }, [url]);
      const initials = normalized && (/^[a-z]/i.test(normalized)
        ? normalized.match(/[a-z]/gi).slice(0, 2).join('').toUpperCase()
        : Array.from(normalized)[0]);
      if (url && !imageFailed) return h('img', { className: 'paw-account-avatar paw-account-avatar-image', src: url,
        alt: '', referrerPolicy: 'no-referrer', onError: () => setImageFailed(true) });
      return h('span', { className: 'paw-account-avatar', 'data-initials': initials || undefined, 'aria-hidden': true },
        initials || h(IconUserOutlineMedium, { size: 16 }));
    }

    function publishSession(user, error = '') {
      session = { user, error };
      for (const listener of listeners) listener();
    }

    function refreshSession() {
      if (readingSession) return readingSession;
      const previous = session;
      readingSession = request('session').then(({ user }) => {
        if (session === previous) publishSession(user);
      }, failure => {
        if (session === previous) publishSession(previous.user, failure.message);
      }).finally(() => { readingSession = undefined; });
      return readingSession;
    }

    async function signOut() {
      await request('logout');
      publishSession(null);
    }

    function LoginDialog({ onClose, onSignedIn }) {
      const content = useRef(null);
      const flow = useRef(null);
      const submitting = useRef(false);
      const [registering, setRegistering] = useState(false);
      const [busy, setBusy] = useState(false);
      const [progress, setProgress] = useState('');
      const [canOpen, setCanOpen] = useState(false);
      const [error, setError] = useState('');
      const authorizing = Boolean(progress);

      useEffect(() => {
        content.current?.querySelector(authorizing ? '.paw-account-cancel' : 'input[name="username"]')?.focus();
      }, [authorizing]);

      useEffect(() => () => {
        if (flow.current) {
          flow.current = null;
          void request('deepseek/cancel').catch(() => {});
        }
      }, []);

      async function submit(event) {
        event.preventDefault();
        if (submitting.current || flow.current) return;
        const values = Object.fromEntries(new FormData(event.currentTarget));
        submitting.current = true;
        setBusy(true);
        setError('');
        try {
          const { user } = await request(registering ? 'register' : 'login', values);
          onSignedIn(user);
        } catch (failure) {
          setError(failure.message);
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }

      async function authorize() {
        if (submitting.current || flow.current) return;
        const attempt = flow.current = {};
        setBusy(true);
        setError('');
        setProgress('正在准备 DeepSeek 授权');
        try {
          await request('deepseek/start', { timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 });
          while (flow.current === attempt) {
            const result = await request('deepseek/status');
            if (flow.current !== attempt) return;
            if (result.phase === 'succeeded') {
              flow.current = null;
              onSignedIn(result.user);
              return;
            }
            if (['failed', 'expired', 'cancelled'].includes(result.phase)) {
              throw new Error('DeepSeek 授权已结束，请重新发起。');
            }
            if (result.canOpen && !attempt.opened) {
              attempt.opened = true;
              setCanOpen(true);
              setProgress('请在浏览器完成授权，然后返回 PawPdot。');
              await reopenAuthorization();
            }
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        } catch (failure) {
          if (flow.current !== attempt) return;
          await request('deepseek/cancel').catch(() => {});
          if (flow.current !== attempt) return;
          flow.current = null;
          resetAuthorization();
          setError(failure.message);
        }
      }

      async function reopenAuthorization() {
        setError('');
        try { await request('deepseek/open'); }
        catch (failure) { setError(failure.message); }
      }

      function resetAuthorization() {
        setProgress('');
        setCanOpen(false);
        setBusy(false);
      }

      async function cancelAuthorization() {
        if (!flow.current) return;
        flow.current = null;
        setCanOpen(false);
        setProgress('正在取消授权');
        try {
          await request('deepseek/cancel');
          const { user } = await request('session');
          if (user) onSignedIn(user);
        } catch (failure) {
          setError(failure.message);
        } finally {
          resetAuthorization();
        }
      }

      const close = () => { if (!submitting.current) onClose(); };
      const title = authorizing ? 'DeepSeek 授权' : registering ? '注册 PawPdot 账号' : '登录 PawPdot';
      const errorMessage = error && h('p', { className: 'paw-account-error', role: 'alert' }, error);
      return h(Modal, { open: true, headless: true, title, onClose: close, className: 'paw-account-dialog' },
        h('div', { ref: content, className: 'paw-account-content' },
          h('header', null,
            h('h2', null, title),
            h('button', { type: 'button', className: 'paw-account-close', 'aria-label': '关闭', onClick: close,
              disabled: busy && !authorizing }, h(IconCloseOutlineRegular, { size: 14 }))),
          h('form', { onSubmit: submit, hidden: authorizing },
            h('div', { className: 'paw-account-fields' },
              h('label', null, '用户名', h(Input, { name: 'username', autoComplete: 'username',
                minLength: 2, maxLength: 40, required: true, disabled: busy })),
              registering && h('label', null, '昵称（选填）', h(Input, { name: 'displayName', maxLength: 80,
                autoComplete: 'nickname', disabled: busy })),
              h('label', { key: registering ? 'new-password' : 'password' }, '密码', h(Input, { name: 'password', type: 'password',
                autoComplete: registering ? 'new-password' : 'current-password', minLength: 12, maxLength: 256,
                placeholder: registering ? '至少 12 位' : undefined, required: true, disabled: busy })),
              !authorizing && errorMessage),
            h('div', { className: 'paw-account-options' },
              h(Button, { type: 'submit', variant: 'primary', className: 'paw-account-primary', disabled: busy },
                busy && !authorizing ? '正在验证' : registering ? '注册并登录' : '登录'),
              h(Button, { type: 'button', variant: 'outline', className: 'paw-account-provider', disabled: busy, onClick: authorize },
                'DeepSeek 授权登录'),
              h('button', { type: 'button', className: 'paw-account-switch', disabled: busy, onClick: () => {
                setRegistering(!registering);
                setError('');
              } }, registering ? '返回登录' : '注册账号'))),
          authorizing && h('div', { className: 'paw-account-progress' },
            h('p', { role: 'status' }, progress), errorMessage,
            h('div', { className: 'paw-account-actions' },
              h(Button, { type: 'button', variant: 'outline', className: 'paw-account-cancel', disabled: !flow.current,
                onClick: cancelAuthorization }, '取消授权'),
              h(Button, { type: 'button', variant: 'primary', disabled: !canOpen, onClick: reopenAuthorization }, '打开浏览器')))));
    }

    function Account({ openSettings, settingsShortcut }) {
      const { user } = useSession();
      const [menu, setMenu] = useState(false);
      const [login, setLogin] = useState(false);
      const [error, setError] = useState('');
      const launcher = useRef(null);

      function closeLogin() {
        setLogin(false);
        requestAnimationFrame(() => launcher.current?.querySelector('.paw-account-trigger')?.focus());
      }

      async function select(id) {
        setMenu(false);
        setError('');
        if (id === 'settings') return openSettings();
        if (id === 'login') {
          launcher.current?.querySelector('.paw-account-trigger')?.focus();
          return setLogin(true);
        }
        try {
          await signOut();
        } catch (failure) {
          setError(failure.message);
        }
      }

      const name = accountName(user);
      return h('div', { ref: launcher, className: 'paw-account' },
        h(Menu, {
          open: menu, side: 'top', portal: true, autoFocus: true,
          anchor: h('button', { type: 'button', className: 'paw-account-trigger',
            'data-signed-in': name ? '' : undefined,
            'aria-label': name ? '账号：' + name : '账号菜单', 'aria-haspopup': 'menu', 'aria-expanded': menu,
            title: name || '账号菜单', onClick: () => setMenu(!menu) },
          name ? h(AccountAvatar, { name, url: user?.avatar_url }) : h(IconUserOutlineMedium, { size: 18 })),
          items: [
            { id: 'settings', label: '设置', icon: h(IconSettingsOutlineMedium, { size: 16 }),
              ...(settingsShortcut && { shortcut: settingsShortcut }) },
            { id: user ? 'logout' : 'login', label: user ? '退出登录' : '登录 / 注册', icon: h(IconUserOutlineMedium, { size: 16 }) },
          ],
          onClose: () => setMenu(false), onSelect: select,
        }),
        error && h('p', { className: 'paw-account-notice', role: 'alert' }, error),
        login && h(LoginDialog, { onClose: closeLogin, onSignedIn: account => { publishSession(account); closeLogin(); } }));
    }

    function AccountSettings() {
      const { user, error: sessionError } = useSession();
      const [login, setLogin] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');

      useEffect(() => { void refreshSession(); }, []);

      async function logOut() {
        setError('');
        setBusy(true);
        try { await signOut(); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
      }

      const name = accountName(user);
      const signedOut = user === null;
      const title = name || (signedOut ? '尚未登录' : sessionError ? '无法读取账号状态' : '正在读取账号状态');
      const description = user ? user.source === 'deepseek' ? 'DeepSeek 授权账号' : 'PawPdot 账号'
        : signedOut ? '支持账号密码和 DeepSeek 授权。' : '';
      const status = error || sessionError;
      return h('section', { className: 'paw-account-settings', 'aria-labelledby': 'paw-account-settings-title' },
        h('h2', { id: 'paw-account-settings-title' }, '账号'),
        h('div', { className: 'paw-account-settings-card' },
          h('div', { className: 'paw-account-identity' },
            h(AccountAvatar, { name, url: user?.avatar_url }),
            h('div', { className: 'paw-account-details' },
              h('strong', null, title),
              description && h('p', null, description),
              user?.source === 'local' && user.username !== name && h('p', null, '用户名：' + user.username))),
          user ? h(Button, { variant: 'outline', disabled: busy, onClick: logOut }, busy ? '正在退出' : '退出登录')
            : signedOut ? h(Button, { variant: 'primary', onClick: () => setLogin(true) }, '登录 / 注册')
              : sessionError && h(Button, { variant: 'outline', onClick: refreshSession }, '重试')),
        status && h('p', { className: 'paw-account-error', role: 'alert' }, status),
        login && h(LoginDialog, {
          onClose: () => setLogin(false),
          onSignedIn: account => { publishSession(account); setLogin(false); },
        }));
    }

    return { inject: ['slots'], apply(ctx) {
      ctx.effect(() => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = '/pawpdot/account.css';
        document.head.append(css);
        void refreshSession();
        window.addEventListener('focus', refreshSession);
        return () => { css.remove(); window.removeEventListener('focus', refreshSession); };
      });
      ctx.slots.inject('settings.launcher', () => ctx.slots.register({
        name: 'settings.launcher', id: 'pawpdot-account',
      }, Account));
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'pawpdot-account', order: -20, label: () => 'PawPdot 账号',
      }, AccountSettings));
    } };
  },
});
