module.exports = {
  appId: 'com.voxcue.desktop',
  productName: 'VoxCue',
  directories: { output: 'release/installer' },
  artifactName: 'VoxCue-Setup-${version}-${arch}.${ext}',
  publish: [
    {
      provider: 'github',
      owner: 'NCFXZ',
      repo: 'VoxCue',
      private: false,
      releaseType: 'release',
    },
  ],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'public/voxcue.ico' },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'VoxCue',
    differentialPackage: true,
    runAfterFinish: true,
    include: '.cache/installer-ui/installer.nsh',
  },
};
