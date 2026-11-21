// The source reader uses the exact app URL and storage origin, without starting the UI or its stores.
if (location.hash === '#profile-import-source' && !window.desktop) {
  Object.defineProperty(window, 'voxcueProfileSource', {
    value: import('./services/profileImportReader').then(({ createProfileImportReader }) =>
      createProfileImportReader(),
    ),
  });
} else if (!window.desktop && location.hash === '#legacy-upgrade-erase') {
  Object.defineProperty(window, 'voxcueLegacyErase', {
    value: import('./services/legacyBrowserData').then(
      ({ eraseLegacyBrowserData }) => eraseLegacyBrowserData,
    ),
  });
} else if (
  !window.desktop &&
  (location.hash === '#legacy-upgrade-source' || location.hash === '#legacy-upgrade-target')
) {
  const source = location.hash === '#legacy-upgrade-source';
  const handoff = new Promise<{ port: MessagePort; owner: string }>((resolve) => {
    function accept(event: MessageEvent) {
      if (
        event.source !== window ||
        event.data?.type !== 'voxcue:legacy-migration-port' ||
        typeof event.data.owner !== 'string' ||
        event.ports.length !== 1
      )
        return;
      window.removeEventListener('message', accept);
      resolve({ port: event.ports[0], owner: event.data.owner });
    }
    window.addEventListener('message', accept);
  });
  Object.defineProperty(window, 'voxcueLegacyMigration', {
    value: handoff.then(async ({ port, owner }) => {
      const { sendLegacyBrowserData, receiveLegacyBrowserData } =
        await import('./services/legacyBrowserData');
      try {
        if (source) await sendLegacyBrowserData(port, owner);
        else await receiveLegacyBrowserData(port, owner);
        return true;
      } finally {
        port.close();
      }
    }),
  });
} else {
  void import('./main');
}
