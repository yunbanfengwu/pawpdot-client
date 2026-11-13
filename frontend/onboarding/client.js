window.__ModuleLoader__.load({
  id: '@pawpdot/client-onboarding',
  factory: require => {
    const { useLayoutEffect } = require('react');

    function SkipPreviewNotice({ complete }) {
      useLayoutEffect(() => { complete(); }, [complete]);
      return null;
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
          name: 'settings.onboarding', id: 'welcome-notice', priority: -100, order: -100,
        }, SkipPreviewNotice));
      },
    };
  },
});
