window.__ModuleLoader__.load({
  id: '@pawpdot/pet-home',
  factory: require => {
    const { createElement: h, useEffect, useRef } = require('react');
    const pageId = 'pawpdot-pet-home';

    function apply(ctx) {
      function World({ onWork, full = false }) {
        const frame = useRef(null), work = useRef(onWork);
        work.current = onWork;
        useEffect(() => {
          let animation;
          let previous = '';
          const root = frame.current?.closest('.pawpdot-home-frame') ?? document.body;
          const observed = new Set();
          const publish = () => {
            const iframe = frame.current;
            if (!iframe?.contentWindow) return;
            const area = iframe.getBoundingClientRect();
            if (!area.width || !area.height) return;
            const rects = [...root.querySelectorAll('[data-composer-seat], [data-scene-obstacle]')].map(node => {
              if (!observed.has(node)) { observed.add(node); resize.observe(node); }
              return node.getBoundingClientRect();
            }).filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > area.top && rect.top < area.bottom)
              .map(rect => ({ x: (rect.left - area.left) / area.width, y: (rect.top - area.top) / area.height,
                width: rect.width / area.width, height: rect.height / area.height }));
            const signature = JSON.stringify(rects);
            if (signature === previous) return;
            previous = signature;
            iframe.contentWindow.postMessage({ type: 'pawpdot:scene-obstacles', rects }, location.origin);
          };
          const schedule = () => { cancelAnimationFrame(animation); animation = requestAnimationFrame(publish); };
          const resize = new ResizeObserver(schedule);
          resize.observe(frame.current);
          const observer = new MutationObserver(schedule);
          observer.observe(root, { childList: true, subtree: true });
          const receive = event => {
            if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
            if (event.data?.type === 'pawpdot:scene-ready') { previous = ''; publish(); }
            if (event.data?.type === 'pawpdot:pet-market') window.dispatchEvent(new Event('pawpdot:pet-market'));
            if (event.data?.type === 'pawpdot:work') {
              if (work.current) void work.current(); else ctx.layout.selectPanel(null);
            }
            if (event.data?.type === 'pawpdot:expand-world') ctx.layout.selectPanel(full ? null : pageId);
          };
          window.addEventListener('message', receive);
          window.addEventListener('resize', schedule);
          root.addEventListener('scroll', schedule, true);
          const onWindowDrag = dragging => {
            iframe.contentWindow?.postMessage({ type: 'pawpdot:window-drag', dragging }, location.origin);
          };
          const onWindowResize = resizing => {
            iframe.contentWindow?.postMessage({ type: 'pawpdot:window-resize', resizing }, location.origin);
          };
          const stopWindowDrag = window.pawpdotWindowState?.onDrag?.(onWindowDrag);
          const stopWindowResize = window.pawpdotWindowState?.onResize?.(onWindowResize);
          publish();
          return () => {
            cancelAnimationFrame(animation); resize.disconnect(); observer.disconnect();
            window.removeEventListener('message', receive); window.removeEventListener('resize', schedule);
            root.removeEventListener('scroll', schedule, true);
            stopWindowDrag?.();
            stopWindowResize?.();
          };
        }, [full]);
        return h('div', { className: full ? 'pp-world-panel' : 'pp-world-home' }, h('iframe', {
          ref: frame, title: '宠物家园与旅行', src: '/pawpdot/pet-home/index.html' + (full ? '?full' : ''),
        }));
      }
      ctx.effect(() => {
        const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/pawpdot/pet-home/client.css';
        document.head.append(style); return () => style.remove();
      });
      ctx.slots.inject('pawpdot.home.pet', () => ctx.slots.register({ name: 'pawpdot.home.pet', id: 'pawpdot-pet-world', priority: -10 }, World));
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: pageId }, () => h(World, { full: true })));
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: '@pawpdot/pet-home' },
        () => h('button', { type: 'button', className: 'pp-pet-primary', onClick: () => ctx.layout.selectPanel(pageId) }, '进入宠物家园')));
    }
    return { inject: ['slots', 'layout'], apply };
  },
});
