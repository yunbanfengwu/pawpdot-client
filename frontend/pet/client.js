window.__ModuleLoader__.load({
  id: '@pawpdot/client-pet',
  factory: require => {
    const { createElement: h, useEffect, useRef, useState } = require('react');
    const { createPortal } = require('react-dom');
    let channel;
    const openMarket = () => window.dispatchEvent(new Event('pawpdot:pet-market'));

    async function api(selected, signal) {
      const response = await fetch('/api/pawpdot/pet', selected === undefined ? { cache: 'no-store', signal } : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selected }), signal,
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw Error('宠物服务暂未就绪，请刷新页面');
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '宠物暂不可用');
      return result;
    }

    function usePets() {
      const [state, setState] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
      const [revision, setRevision] = useState(0);
      useEffect(() => {
        const controller = new AbortController();
        const refresh = () => setRevision(value => value + 1);
        window.addEventListener('pawpdot:pet-changed', refresh);
        api(undefined, controller.signal).then(value => { setState(value); setError(''); })
          .catch(error => { if (!controller.signal.aborted) setError(error.message); });
        return () => { controller.abort(); window.removeEventListener('pawpdot:pet-changed', refresh); };
      }, [revision]);
      async function adopt(selected) {
        setBusy(true); setError('');
        try {
          const result = await api(selected, AbortSignal.timeout(10000));
          setState(result);
          window.dispatchEvent(new Event('pawpdot:pet-changed')); channel?.postMessage('changed');
          return true;
        } catch (error) { setError(error.message); return false; }
        finally { setBusy(false); }
      }
      return { state, error, busy, adopt };
    }

    function Market({ close }) {
      const { state, error, busy, adopt } = usePets();
      const [preview, setPreview] = useState('toy-cat');
      const pet = state?.pets.find(pet => pet.id === preview);
      return h('div', { className: 'pp-pet-market' },
        h('header', null, h('div', null, h('h2', { id: 'pp-pet-title' }, '遇见你的伙伴'), h('p', null, '领养后，它会陪你生活，也陪你探索新的世界。')),
          h('button', { type: 'button', onClick: close, 'aria-label': '关闭宠物市场' }, '关闭')),
        error && h('p', { role: 'alert' }, error),
        state ? h('div', { className: 'pp-pet-market-body' },
          h('div', { className: 'pp-pet-list' }, state.pets.map(item => h('button', {
            key: item.id, type: 'button', onClick: () => setPreview(item.id), 'aria-pressed': preview === item.id,
          }, h('img', { src: item.image, alt: item.name, width: 140, height: 110 }),
          h('strong', null, item.name), h('span', null, item.description)))),
          h('section', { className: 'pp-pet-preview' },
            h('iframe', { key: preview, title: pet.name + '骨骼动作预览', src: '/pawpdot/pet/index.html?preview&pet=' + preview }),
            h('div', { className: 'pp-pet-market-actions' }, h('span', null, state.selected === preview ? '正在陪伴你' : pet.name),
              h('button', { type: 'button', className: 'pp-pet-primary', disabled: busy || state.selected === preview,
                onClick: async () => { if (await adopt(preview)) close(); } }, state.selected === preview ? '已领养' : busy ? '正在领养…' : '领养并使用'))))
          : h('p', { role: 'status' }, '正在读取宠物…'));
    }

    function MarketController() {
      const [open, setOpen] = useState(false);
      const dialog = useRef(null), trigger = useRef(null);
      useEffect(() => {
        const show = () => { trigger.current = document.activeElement; setOpen(true); };
        window.addEventListener('pawpdot:pet-market', show);
        return () => window.removeEventListener('pawpdot:pet-market', show);
      }, []);
      useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
      return open && createPortal(h('dialog', { className: 'pp-pet-dialog', ref: dialog, 'aria-labelledby': 'pp-pet-title',
        onClose: () => { setOpen(false); if (trigger.current?.isConnected) trigger.current.focus(); } },
      h(Market, { close: () => dialog.current?.close() })), document.body);
    }

    function PetStage() {
      const { state, error } = usePets();
      return h('section', { className: 'pp-pet-stage', 'aria-label': '我的宠物' },
        h('button', { type: 'button', className: 'pp-pet-open', onClick: openMarket }, '宠物市场 / 切换宠物'),
        error && h('p', { role: 'alert' }, error),
        state?.companion ? h('iframe', { title: state.companion.name, src: '/pawpdot/pet/index.html?pet=' + state.selected })
          : state && h('button', { type: 'button', className: 'pp-pet-primary', onClick: openMarket }, '领养一位伙伴'));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/pawpdot/pet/client.css'; document.head.append(style);
          channel = new BroadcastChannel('pawpdot-pet');
          channel.onmessage = () => window.dispatchEvent(new Event('pawpdot:pet-changed'));
          return () => { style.remove(); channel.close(); channel = undefined; };
        });
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'pawpdot-pet-market' }, MarketController));
        ctx.slots.inject('pawpdot.home.pet', () => ctx.slots.register({ name: 'pawpdot.home.pet', id: 'pawpdot-three-pet', priority: 0 }, PetStage));
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: '@pawpdot/client-pet' },
          () => h('button', { type: 'button', className: 'pp-pet-primary', onClick: openMarket }, '打开宠物市场')));
      },
    };
  },
});
