const version = /^v(\d+)\.(\d+)\.(\d+)/.exec(process.version);
const major = version ? Number(version[1]) : 0;
const minor = version ? Number(version[2]) : 0;

if (major !== 24 || minor < 21) {
  console.error(
    `Noema desktop tests require Node.js 24.21 or newer within Node 24; found ${process.version}.`,
  );
  process.exitCode = 1;
}
