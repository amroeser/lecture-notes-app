/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS hook, loaded by electron-builder */
/**
 * electron-builder afterPack hook: copies the Next.js standalone server into the app's resources.
 * extraResources always drops node_modules folders, but the standalone server needs its traced
 * node_modules. afterPack runs before code signing, so the copied files are covered by the signature.
 */
const { cpSync, existsSync } = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const source = path.join(context.packager.projectDir, 'dist-desktop', 'server');
  if (!existsSync(path.join(source, 'server.js'))) {
    throw new Error('dist-desktop/server is missing. Run `npm run desktop:build` first.');
  }
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
  const target = path.join(resources, 'server');
  cpSync(source, target, { recursive: true, verbatimSymlinks: true });
  if (!existsSync(path.join(target, 'node_modules', 'next', 'package.json'))) {
    throw new Error(`Server copy is incomplete: ${target}`);
  }
  console.log(`  • copied standalone server  to=${path.relative(context.packager.projectDir, target)}`);
};
