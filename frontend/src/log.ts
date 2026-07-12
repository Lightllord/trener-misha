// Frontend log facade. Every line goes to the browser console AND, when running
// under Electron, is mirrored to a file (repo-root .temp/logs/frontend-<stamp>.log
// via the main process — see electron/preload.cjs + main.cjs) so it correlates
// with the backend log by wall-clock timestamp. The WS is deliberately NOT used
// as a log transport: it drops with the connection, exactly when we'd care most.
export function flog(scope: string, msg: string): void {
  const line = `${new Date().toISOString()} [fe] [${scope}] ${msg}`;
  console.log(line);
  window.desktopLog?.write(line);
}
