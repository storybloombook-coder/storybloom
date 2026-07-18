module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // React Compiler auto-memoizes based on an assumed-pure render
          // model. features/kolobok's whole architecture (see its
          // CLAUDE.md) deliberately violates that: useFrame callbacks
          // mutate a module-level `orbit` object directly for zero-
          // re-render, 60x/second updates -- exactly the kind of external
          // mutation the compiler can't see and isn't safe to memoize
          // around. Confirmed empirically: with the compiler on,
          // `orbit.angle += ...` inside CameraRig's useFrame silently
          // produced NaN after the first frame (camera at [NaN, y, NaN],
          // i.e. a fully blank Canvas) -- no error, no warning, just wrong
          // values. Excluding the whole package by path, rather than
          // sprinkling "use no memo" per file, means every new file added
          // in later phases is safe by default.
          'react-compiler': {
            sources: (filename) => !filename || !filename.replace(/\\/g, '/').includes('/features/kolobok/'),
          },
        },
      ],
    ],
    plugins: ['react-native-worklets/plugin'],
  };
};
