// esbuild inlines .obj files as text (see the loader config in build.mjs), so
// to TypeScript the import is just a string. Deliberately NOT named
// bullhead.obj.d.ts: tsc would resolve './bullhead.obj' to that file directly
// and never consult this wildcard.
declare module '*.obj' {
  const src: string;
  export default src;
}
