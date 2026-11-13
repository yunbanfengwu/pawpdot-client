window.__ModuleLoader__.load({ id: 'teamseek-mobile-view', factory: require => {
  const React = require('react');
  function BrowserScreenshot({ block, renderFactorySlot, loadImage }) {
    const content = Array.isArray(block.content) ? block.content : [];
    const images = content.filter(part => part.type === 'image' && part.attachment).map(part => ({ attachment: part.attachment }));
    if (!images.length) return React.createElement('div', null,
      block.isError ? content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '正在操作浏览器…');
    return React.createElement('div', { 'data-teamseek-browser-shot': '', style: { padding: '8px 0' } },
      renderFactorySlot('conversation.images.content', { images, loadImage, align: 'start' }));
  }
  return { inject: ['modules', 'slots', 'sessions', 'uiSession', 'uiWorkspace', 'sidebarRight', 'remote', 'remote.session', 'remote.commands', 'locale'],
    apply(ctx) {
      ctx.slots.inject('tool.call.toolview', () => {
        for (const key of ['cloud_browser_open', 'cloud_browser_screenshot', 'cloud_browser_action', 'computer_screenshot']) ctx.slots.register({
          name: 'tool.call.toolview', key
        }, BrowserScreenshot);
      });
      const release = window.TeamSeekHarnessEmbed.install(ctx);
      return release;
    }
  };
} });
