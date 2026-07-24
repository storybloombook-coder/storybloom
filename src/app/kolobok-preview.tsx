// kolobok-preview.tsx — dev-only route to test-drive the Kolobok 3D scene
// (features/kolobok/) without touching the real home screen while it's
// still mid-build. Once the scene is far enough along, this is where
// index.tsx gets swapped to render MainScreen directly instead.
import { router, Stack, useIsFocused } from 'expo-router';
// features/kolobok is plain JS/JSX by its own CLAUDE.md (no TypeScript
// migration unless asked) -- untyped (implicit any) from Storybloom's side.
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
      <Stack.Screen options={{ headerShown: false }} />
      {/* initialSceneMode="3d": this dev-only preview button is a straight
          shortcut into the scene -- MainScreen's own default (start flat,
          switch to 3d only after an async reduce-motion check resolves) is
          a safety behavior for a REAL production entry point; here it just
          flashed FlatMenu for a moment before the Canvas took over. */}
      <MainScreen
        onNavigate={(route: string) => router.push(route as never)}
        focused={focused}
        initialSceneMode="3d"
      />
    </>
  );
}
