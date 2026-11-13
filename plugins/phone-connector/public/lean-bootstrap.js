(() => {
  document.documentElement.dataset.teamseekLean = '1';
  const pendingQueue = [];
  window.__ModuleLoader__ = {
    mode: 'queue', pendingQueue,
    load(registration) { pendingQueue.push(registration); },
    create(options) {
      if (this.mode !== 'queue') throw Error('轻量页面已启动');
      const i = pendingQueue.findIndex(r => r.id === '@deepseek-ai/dsh-client-modules');
      if (i < 0) throw Error('原版模块加载器未就绪');
      const registration = pendingQueue.splice(i, 1)[0];
      const exports = registration.factory(name => { throw Error('未知启动依赖：' + name); });
      return exports.createClientModuleSystem(this, { id: registration.id, exports }, options);
    }
  };
})();
