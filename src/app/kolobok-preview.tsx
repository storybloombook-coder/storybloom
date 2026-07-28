// kolobok-preview.tsx — dev-only route to test-drive the Kolobok 3D scene
// (features/kolobok/) without touching the real home screen while it's
// still mid-build. Once the scene is far enough along, this is where
// index.tsx gets swapped to render MainScreen directly instead.
import { router, Stack, useIsFocused } from 'expo-router';
// features/kolobok is plain JS/JSX by its own CLAUDE.md (no TypeScript
// migration unless asked) -- untyped (implicit any) from Kolobook's side.
import { MainScreen } from '../../features/kolobok/src/MainScreen';

export default function KolobokPreviewScreen() {
  // router.push (below) keeps this screen mounted underneath whatever it
  // navigates to -- its Canvas would otherwise keep ticking/rendering the
  // whole time it's hidden (nothing else pauses it), so the scene visibly
  // "catches up" on return. `focused` tells Scene3D to freeze the frameloop
  // while this screen isn't the one on top, same mechanism as its existing
  // AppState background pause.
  const focused = useIsFocused();
  return (
    <>
      {/* animation: 'fade' -- a cross-dissolve rather than the app's usual
          slide, since this screen swaps the whole flat 2D menu for the 3D
          scene (and reverses to a fade back on the way out too, matching
          native-stack's push/pop symmetry) -- a slide reads oddly for a
          dimensionality change like this one. */}
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      {/* initialSceneMode="3d": this dev-only preview button is a straight
          shortcut into the scene -- MainScreen's own default (start flat,
          switch to 3d only after an async reduce-motion check resolves) is
          a safety behavior for a REAL production entry point; here it just
          flashed FlatMenu for a moment before the Canvas took over. */}
      <MainScreen
        onNavigate={(route: string) => {
          // '/' is the "2D" button's own "leave the 3D scene" request, not a
          // real destination to push -- popping back to the ALREADY-mounted
          // home screen (still holding its own state, e.g. the looping
          // background video) reads as returning, not opening a fresh copy,
          // and avoids stacking up a new index instance every round trip.
          // Every other route (add-book/create-story/library, from the
          // crossroads-stone menu) still pushes, per the note above.
          if (route === '/') router.back();
          else router.push(route as never);
        }}
        focused={focused}
        initialSceneMode="3d"
      />
    </>
  );
}
