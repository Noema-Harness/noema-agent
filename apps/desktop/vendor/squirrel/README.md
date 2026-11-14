# Vendored Squirrel build tools

`nuget.exe` is pinned here because the copy that ships with `electron-winstaller`
5.x is NuGet 2.8 (2015). Its `System.IO.Packaging` writer throws
`ObjectDisposedException: Cannot access a closed stream` when a package part
compresses to more than ~64 KB, which is always true for `app.asar` — so
`npm run make` failed at the Squirrel step on every release from 0.7.4 on.

NuGet 3.0 replaced that writer with `NuGet.Packaging`; this pinned 6.11.1 build
packs the same nuspec correctly. `apps/desktop/scripts/make.mjs` stages a vendor
directory that overlays this binary on top of `electron-winstaller`'s tools and
points MakerSquirrel at it. Replace the file only together with a verified
`npm run make:desktop` run.

Source: https://dist.nuget.org/win-x86-commandline/v6.11.1/nuget.exe
